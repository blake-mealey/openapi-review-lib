import { IGitClient, IContext, IIoManager } from "./interfaces";
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
    let shouldFail = this.context.failOnBreakingChanges;
    if (shouldFail === undefined || shouldFail === null) {
      shouldFail = true;
    }

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
    specsDiff: DiffOutcome,
    specPath: string
  ) {
    const converterOptions = {
      omitHeader: true,
      tocSummary: true,
      codeSamples: false,
      language_tabs: [],
      ...(this.context.converterOptions || {}),
    };
    let docs = await converter.convert(
      (specVersions.destinationSpec as any).spec,
      converterOptions
    );
    return (
      await processDocs(
        docs,
        Object.values(specVersions).map((spec) => (spec as any).spec),
        specsDiff,
        specPath
      )
    ).contents.toString();
  }

  private async processSpec(specPath: string) {
    console.log("processing", specPath);

    const specVersions = await this.getSpecVersions(
      specPath.replace(/^\.\//, "")
    );
    const specsDiff = await diffSpecs(specVersions);
    this.failOnBreakingChanges(specPath, specsDiff);

    const docs = await this.getSpecDocs(specVersions, specsDiff, specPath);

    await this.gitClient.createPullRequestComment({
      owner: this.context.pullRequest.base.repoOwner,
      repo: this.context.pullRequest.base.repoName,
      pullRequestId: this.context.pullRequest.id,
      comment: docs,
    });
  }

  public async run() {
    try {
      if (!this.context.pullRequest) {
        throw new Error("Missing PR context");
      }

      const changedSpecs = await this.gitClient.getChangedFiles({
        owner: this.context.pullRequest.base.repoOwner,
        repo: this.context.pullRequest.base.repoName,
        pullRequestId: this.context.pullRequest.id,
        paths: this.context.specPaths,
      });
      await Promise.all(changedSpecs.map((spec) => this.processSpec(spec)));
    } catch (error) {
      this.ioManager.setFailed(error);
    }
  }
}

export default OpenApiReview;
