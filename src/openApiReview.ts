import { IGitClient, IContext, IIoManager } from "./interfaces";
import { parse as parseDiff } from "what-the-diff";
import {
  diffSpecs,
  OpenApiDiffOptions,
  SpecOption,
  DiffOutcome,
} from "openapi-diff";
import { safeLoad as parseYaml } from "js-yaml";
import converter from "widdershins";
import { process as processDocs } from "./docsProcessor";

class OpenApiReview {
  constructor(
    private gitClient: IGitClient,
    private ioManager: IIoManager,
    private context: IContext
  ) {}

  private async getDiff() {
    const diff = await this.gitClient.getPullRequestDiff({
      owner: this.context.pullRequest.base.repoOwner,
      repo: this.context.pullRequest.base.repoName,
      pullRequestId: this.context.pullRequest.id,
    });
    return parseDiff(diff);
  }

  private didFileChange(diff: any, path: string): boolean {
    function makeRelative(str: string) {
      return str.replace(/^\w+\//, "./");
    }

    return diff.find(
      (file: { oldPath?: string; newPath?: string }) =>
        (file.oldPath && makeRelative(file.oldPath) === path) ||
        (file.newPath && makeRelative(file.newPath) === path)
    );
  }

  private async getChangedSpecs(): Promise<string[]> {
    const diff = await this.getDiff();

    let specPaths: string | string[] = this.ioManager.getInput("spec-paths", {
      required: true,
    });
    if (typeof specPaths === "string") {
      specPaths = [specPaths];
    }

    return specPaths.filter((specPath: string) => {
      return this.didFileChange(diff, specPath);
    });
  }

  private async getSpecVersions(path: string): Promise<OpenApiDiffOptions> {
    const getVersion = async (
      version: "base" | "head"
    ): Promise<SpecOption> => {
      const pr = this.context.pullRequest[version];
      const content = await this.gitClient.getFileContent({
        path,
        owner: pr.repoOwner,
        repo: pr.repoName,
        ref: pr.ref,
      });
      const spec: any = parseYaml(content);

      return {
        spec,
        content,
        location: `${version}/${path}`,
        format:
          "swagger" in spec
            ? "swagger2"
            : "openapi" in spec
            ? "openapi3"
            : null,
      } as SpecOption;
    };

    return {
      sourceSpec: await getVersion("base"),
      destinationSpec: await getVersion("head"),
    };
  }

  private failOnBreakingChanges(specPath: string, specsDiff: DiffOutcome) {
    const shouldFail = this.ioManager.getInput("fail-on-breaking-changes", {
      default: true,
    });

    if (specsDiff.breakingDifferencesFound && shouldFail) {
      this.ioManager.setFailed(
        new Error(
          `Breaking changes were found in ${specPath}:\n${JSON.stringify(
            specsDiff.breakingDifferences,
            null,
            2
          )}`
        )
      );
    }
  }

  private async getSpecDocs(
    specVersions: OpenApiDiffOptions,
    specsDiff: DiffOutcome
  ) {
    const converterOptions = {
      omitHeader: true,
      tocSummary: true,
      codeSamples: false,
      language_tabs: [],
      ...this.ioManager.getInput("converter-options", { default: {} }),
    };
    let docs = await converter.convert(
      (specVersions.destinationSpec as any).spec,
      converterOptions
    );
    return (
      await processDocs(
        docs,
        Object.values(specVersions).map((spec) => (spec as any).spec),
        specsDiff
      )
    ).contents;
  }

  private async processSpec(specPath: string) {
    console.log("processing", specPath);

    const specVersions = await this.getSpecVersions(
      specPath.replace(/^\.\//, "")
    );
    const specsDiff = await diffSpecs(specVersions);
    this.failOnBreakingChanges(specPath, specsDiff);

    const docs = await this.getSpecDocs(specVersions, specsDiff);

    const changesTable = {
      breaking: {
        link: "[Breaking](https://www.npmjs.com/package/openapi-diff#breaking)",
        count: specsDiff.breakingDifferencesFound
          ? specsDiff.breakingDifferences.length
          : 0,
      },
      nonBreaking: {
        link:
          "[Non-breaking](https://www.npmjs.com/package/openapi-diff#non-breaking)",
        count: specsDiff.nonBreakingDifferences
          ? specsDiff.nonBreakingDifferences.length
          : 0,
      },
      unclassified: {
        link:
          "[Unclassified](https://www.npmjs.com/package/openapi-diff#unclassified)",
        count: specsDiff.unclassifiedDifferences
          ? specsDiff.unclassifiedDifferences.length
          : 0,
      },
    };

    const comment = `
# OpenAPI Review

> **Spec: ${specPath}**

## OpenAPI Diff

> ⚡ Powered by [openapi-diff](https://bitbucket.org/atlassian/openapi-diff)

${specsDiff.breakingDifferencesFound ? "🚨 **BREAKING CHANGES** 🚨" : ""}

| Change Classification             | Count                              |
| --------------------------------- | ---------------------------------- |
| ${changesTable.breaking.link}     | ${changesTable.breaking.count}     |
| ${changesTable.nonBreaking.link}  | ${changesTable.nonBreaking.count}  |
| ${changesTable.unclassified.link} | ${changesTable.unclassified.count} |

<details>
<summary>Diff</summary>

\`\`\`json
${JSON.stringify(specsDiff, null, 2)}
\`\`\`
</details>

## OpenAPI Docs

> ⚡ Powered by [widdershins](https://github.com/Mermade/widdershins)

${docs}
`;

    await this.gitClient.createPullRequestComment({
      owner: this.context.pullRequest.base.repoOwner,
      repo: this.context.pullRequest.base.repoName,
      pullRequestId: this.context.pullRequest.id,
      comment,
    });
  }

  public async run() {
    try {
      if (!this.context.pullRequest) {
        throw new Error("Missing PR context");
      }

      const changedSpecs = await this.getChangedSpecs();
      await Promise.all(changedSpecs.map((spec) => this.processSpec(spec)));
    } catch (error) {
      this.ioManager.setFailed(error);
    }
  }
}

export default OpenApiReview;
