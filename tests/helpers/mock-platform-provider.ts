import type {
  CreatePullRequestParams,
  IssueDetail,
  ListIssuesParams,
  ListPullRequestsParams,
  PlatformProvider,
  PullRequestInfo,
} from '../../src/platform/provider.js';

const DEFAULT_ISSUE: IssueDetail = {
  number: 1,
  title: 'Mock Issue',
  body: 'Mock issue body',
  labels: [],
  assignees: [],
  comments: [],
  state: 'open',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  linkedPRs: [],
};

export class MockPlatformProvider implements PlatformProvider {
  readonly name = 'Mock';

  private readonly issueDetail: IssueDetail;

  constructor(issueDetail?: Partial<IssueDetail>) {
    this.issueDetail = { ...DEFAULT_ISSUE, ...issueDetail };
  }

  async connect(): Promise<void> {}

  async disconnect(): Promise<void> {}

  async checkAuth(): Promise<boolean> {
    return true;
  }

  async getIssue(_issueNumber: number): Promise<IssueDetail> {
    return { ...this.issueDetail, number: _issueNumber };
  }

  async listIssues(_filters: ListIssuesParams): Promise<IssueDetail[]> {
    return [];
  }

  async addIssueComment(_issueNumber: number, _body: string): Promise<void> {}

  async createPullRequest(params: CreatePullRequestParams): Promise<PullRequestInfo> {
    return {
      number: 1,
      url: `https://github.com/mock/repo/pull/1`,
      title: params.title,
      headBranch: params.head,
      baseBranch: params.base,
    };
  }

  async getPullRequest(prNumber: number): Promise<PullRequestInfo> {
    return {
      number: prNumber,
      url: `https://github.com/mock/repo/pull/${prNumber}`,
      title: 'Mock PR',
      headBranch: 'feature-branch',
      baseBranch: 'main',
    };
  }

  async updatePullRequest(
    _prNumber: number,
    _updates: { title?: string; body?: string },
  ): Promise<void> {}

  async listPullRequests(_filters?: ListPullRequestsParams): Promise<PullRequestInfo[]> {
    return [];
  }

  issueLinkSuffix(issueNumber: number): string {
    return `Closes #${issueNumber}`;
  }
}
