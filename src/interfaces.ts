interface IGitClient {
  getChangedFiles(options: {
    owner: string;
    repo: string;
    pullRequestId: string;
    paths: string[];
  }): Promise<string[]>;

  getFileContent(options: {
    path: string;
    owner: string;
    repo: string;
    ref: string;
  }): Promise<string>;

  createPullRequestComment(options: {
    owner: string;
    repo: string;
    pullRequestId: string;
    comment: string;
  }): Promise<void>;
}

interface IIoManager {
  setFailed(error: Error): void;
}

interface IPrVersion {
  repoOwner: string;
  repoName: string;
  ref: string;
}

interface IContext {
  pullRequest?: {
    base: IPrVersion;
    head: IPrVersion;
    id: string;
  };
  converterOptions?: any;
  specPaths: string[];
  failOnBreakingChanges?: boolean;
}

export { IGitClient, IIoManager, IContext };
