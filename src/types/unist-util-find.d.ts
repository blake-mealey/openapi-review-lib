declare module "unist-util-find" {
  import { Node } from "unist";

  export default function find(parent: Node, test: any): Node;
}
