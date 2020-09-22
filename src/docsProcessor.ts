"use strict";

import { Parent, Node } from "unist";
import remark from "remark";
import visit from "unist-util-visit";
import find from "unist-util-find";
import is from "unist-util-is";
import u from "unist-builder";
import { DiffResult, DiffOutcome } from "openapi-diff";
import { Parser as xmlParser } from "tsxml";

const isHeading = (depth?: number, depthIsMax: boolean = false): any => {
  return (node: any) => {
    const isCorrectDepth = (nodeDepth: number) => {
      if (!depth) {
        return true;
      }
      if (depthIsMax) {
        return nodeDepth <= depth;
      } else {
        return nodeDepth === depth;
      }
    };

    if (node.type === "heading") {
      return isCorrectDepth(node.depth);
    } else if (node.type === "html") {
      const match = (node.value as string).match(/^<h(\d).*<\/h\d>$/m);
      if (match) {
        return isCorrectDepth(Number(match[1]));
      }
    }
  };
};

const removeUnwantedNodes = () => (tree: Parent) => {
  visit(tree, "html", (node, index, parent) => {
    if ((node.value as string).startsWith("<h1")) {
      parent.children.splice(index, 1);
      return [visit.SKIP, index];
    }
  });
  visit(tree, "blockquote", (node, index, parent) => {
    const text = find(node, { type: "text" });
    if (text && (text.value as string).startsWith("Scroll down for")) {
      parent.children.splice(index, 1);
      return [visit.SKIP, index];
    }
  });
  visit(tree, "heading", (node, index, parent) => {
    const text = find(node, { type: "text" });
    if (text && (text.value as string) === "Authentication") {
      parent.children.splice(index, 1);
      return [visit.SKIP, index];
    }
  });
};

const wrapOperationsWithDetails = () => (tree: Parent) => {
  visit(tree, isHeading(2), (node, index, parent) => {
    const offset = node.type === "heading" ? 2 : 1;

    parent.children.splice(
      index + offset,
      0,
      u("html", "<details>\n<summary>Docs</summary>")
    );

    let nextIndex = parent.children
      .slice(index + offset)
      .findIndex((node) => is(node, isHeading(2, true)));
    if (nextIndex > -1) {
      nextIndex += index + offset;
    } else {
      nextIndex = parent.children.length;
    }

    parent.children.splice(nextIndex, 0, u("html", "</details>"));
  });
};

function getOperationLocation(specs: any[], operationId: string) {
  for (const spec of specs) {
    for (const [route, operations] of Object.entries(spec.paths)) {
      for (const [method, operation] of Object.entries(operations)) {
        if (operation.operationId === operationId) {
          return ["paths", route, method].join(".");
        }
      }
    }
  }
}

function findMatchingDifference(
  diffs: DiffResult<any>[],
  operationLocation: string
) {
  if (!diffs) {
    return;
  }

  return diffs.some(
    (diff) =>
      diff.sourceSpecEntityDetails.some(({ location }) =>
        location.startsWith(operationLocation)
      ) ||
      diff.destinationSpecEntityDetails.some(({ location }) =>
        location.startsWith(operationLocation)
      )
  );
}

const insertChangeNotifier = (specs: any[], specsDiff: DiffOutcome) => (
  tree: Parent
) => {
  visit(tree, { type: "heading", depth: 2 }, (node, index, parent) => {
    const createNotifierNode = (message: string, emoji: string) =>
      u("paragraph", [
        u("text", `${emoji} `),
        u("strong", [u("text", message)]),
        u("text", ` ${emoji}`),
      ]);

    const idNode = (parent.children[index + 1] as Parent).children[0];
    const operationId = (idNode.value as string).match(/"opId(.*)"/)[1];
    const operationLocation = getOperationLocation(specs, operationId);

    let notifierNode;
    if (
      specsDiff.breakingDifferencesFound &&
      findMatchingDifference(specsDiff.breakingDifferences, operationLocation)
    ) {
      notifierNode = createNotifierNode("BREAKING CHANGES", "🚨");
    } else if (
      findMatchingDifference(
        specsDiff.nonBreakingDifferences,
        operationLocation
      ) ||
      findMatchingDifference(
        specsDiff.unclassifiedDifferences,
        operationLocation
      )
    ) {
      notifierNode = createNotifierNode("CHANGES", "⚠");
    }

    if (notifierNode) {
      parent.children.splice(index + 1, 0, notifierNode);
      return [visit.SKIP, index + 1];
    }
  });
};

const incrementHeadingDepth = () => async (tree: Parent) => {
  visit(tree, { type: "heading" }, (node) => {
    (node as any).depth++;
  });

  const promises: Promise<void>[] = [];
  const visitHtml = (node: Node) => {
    const nodeValue = (node as any).value as string;
    promises.push(
      xmlParser
        .parseStringToAst(nodeValue)
        .then((html) => {
          let changed = false;
          html.forEachChildNode((htmlNode) => {
            const match = htmlNode.tagName && htmlNode.tagName.match(/^h(\d)$/);
            if (match) {
              changed = true;
              htmlNode.tagName = `h${Number(match[1]) + 1}`;
            }
          });
          if (changed) {
            (node as any).value = html.toFormattedString();
          }
        })
        .catch(() => {})
    );
  };

  visit(tree, { type: "html" }, visitHtml);
  await Promise.allSettled(promises);
};

const insertHeader = (specPath: string, specsDiff: DiffOutcome) => (
  tree: Parent
) => {
  const header: any[] = [
    u("heading", { depth: 1 }, [u("text", "OpenAPI Review")]),
    u("blockquote", [u("strong", [u("text", `Spec: ${specPath}`)])]),
    u("heading", { depth: 2 }, [u("text", "OpenAPI Diff")]),
    u("blockquote", [
      u("paragraph", [
        u("text", "⚡ Powered by "),
        u("link", { url: "https://bitbucket.org/atlassian/openapi-diff" }, [
          u("text", "openapi-diff"),
        ]),
      ]),
    ]),
  ];

  if (specsDiff.breakingDifferencesFound) {
    header.push(
      u("paragraph", [
        u("text", "🚨 "),
        u("strong", [u("text", "BREAKING CHANGES")]),
        u("text", " 🚨"),
      ])
    );
  }

  const openapiDiffDocsUrl = "https://www.npmjs.com/package/openapi-diff";
  const changeClassifications = [
    {
      name: "Breaking",
      count: specsDiff.breakingDifferencesFound
        ? specsDiff.breakingDifferences.length
        : 0,
    },
    {
      name: "Non-breaking",
      count: specsDiff.nonBreakingDifferences
        ? specsDiff.nonBreakingDifferences.length
        : 0,
    },
    {
      name: "Unclassified",
      count: specsDiff.unclassifiedDifferences
        ? specsDiff.unclassifiedDifferences.length
        : 0,
    },
  ];

  header.push(
    u("table", [
      u("tableRow", [
        u("tableCell", [u("text", "Change Classification")]),
        u("tableCell", [u("text", "Count")]),
      ]),
      ...changeClassifications.map((classification) =>
        u("tableRow", [
          u("tableCell", [
            u(
              "link",
              {
                url: `${openapiDiffDocsUrl}#${classification.name.toLowerCase()}`,
              },
              [u("text", classification.name)]
            ),
          ]),
          u("tableCell", [u("text", classification.count)]),
        ])
      ),
    ]),
    u("html", "<details>\n<summary>Diff</summary>"),
    u("code", { lang: "json" }, JSON.stringify(specsDiff, null, 2)),
    u("html", "</details>"),
    u("heading", { depth: 2 }, [u("text", "OpenAPI Docs")]),
    u("blockquote", [
      u("paragraph", [
        u("text", "⚡ Powered by "),
        u("link", { url: "https://github.com/Mermade/widdershins" }, [
          u("text", "widdershins"),
        ]),
      ]),
    ])
  );

  tree.children.unshift(...header);
};

function process(
  contents: string,
  specs: any[],
  specsDiff: DiffOutcome,
  specPath: string
) {
  return remark()
    .use(removeUnwantedNodes)
    .use(wrapOperationsWithDetails)
    .use(insertChangeNotifier, specs, specsDiff)
    .use(incrementHeadingDepth as any)
    .use(insertHeader, specPath, specsDiff)
    .process(contents);
}

export {
  removeUnwantedNodes,
  wrapOperationsWithDetails,
  insertChangeNotifier,
  process,
};
