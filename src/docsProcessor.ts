"use strict";

import { Parent } from "unist";
import remark from "remark";
import visit from "unist-util-visit";
import find from "unist-util-find";
import is from "unist-util-is";
import u from "unist-builder";
import { DiffResult, DiffOutcome } from "openapi-diff";

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
};

const wrapOperationsWithDetails = () => (tree: Parent) => {
  visit(tree, { type: "heading", depth: 2 }, (node, index, parent) => {
    parent.children.splice(
      index + 2,
      0,
      u("html", "<details>\n<summary>Docs</summary>")
    );

    let nextIndex = parent.children
      .slice(index + 2)
      .findIndex((node) => is(node, { type: "heading", depth: 2 }));
    if (nextIndex === -1) {
      nextIndex = parent.children.length;
    } else {
      nextIndex += index + 2;
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

function process(contents: string, specs: any[], specsDiff: DiffOutcome) {
  return remark()
    .use(removeUnwantedNodes)
    .use(wrapOperationsWithDetails)
    .use(insertChangeNotifier, specs, specsDiff)
    .process(contents);
}

export {
  removeUnwantedNodes,
  wrapOperationsWithDetails,
  insertChangeNotifier,
  process,
};
