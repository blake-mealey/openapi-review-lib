interface IGitClient {
  getPullRequestDiff(options: {
    owner: string;
    repo: string;
    number: string;
  }): Promise<string>;

  getFileContent(options: {
    path: string;
    owner: string;
    repo: string;
    ref: string;
  }): Promise<string>;

  createPullRequestComment(options: {
    owner: string;
    repo: string;
    number: string;
    comment: string;
  }): Promise<void>;
}

interface IIoManager {
  getInput(
    key: string,
    options?: {
      required?: boolean;
      default?: any;
    }
  ): any;
  setFailed(error: Error): void;
}

interface IPrVersion {
  repo: {
    owner: {
      login: string;
    };
    name: string;
  };
  ref: string;
}

interface IContext {
  pullRequest?: {
    base: IPrVersion;
    head: IPrVersion;
    number: string;
  };
}

export { IGitClient, IIoManager, IContext };
