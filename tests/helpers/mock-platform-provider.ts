import type {
  CreatePullRequestParams,
  IssueDetail,
  ListIssuesParams,
  ListPullRequestsParams,
  PRComment,
  PRReview,
  PlatformProvider,
  PullRequestInfo,
  ReviewThread,
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
  private _appliedLabels: string[] = [];

  constructor(issueDetail?: Partial<IssueDetail>) {
    this.issueDetail = { ...DEFAULT_ISSUE, ...issueDetail };
  }

  get appliedLabels(): string[] {
    return [...this._appliedLabels];
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

  async findOpenPR(_issueNumber: number, _branch: string): Promise<PullRequestInfo | null> {
    return null;
  }

  async listPRReviewComments(_prNumber: number): Promise<ReviewThread[]> {
    return [];
  }

  async listPRComments(_prNumber: number): Promise<PRComment[]> {
    return [];
  }

  async listPRReviews(_prNumber: number): Promise<PRReview[]> {
    return [];
  }

  async ensureLabel(_labelName: string, _color?: string): Promise<void> {}

  async applyLabels(_prNumber: number, labels: string[]): Promise<void> {
    for (const label of labels) {
      if (!this._appliedLabels.includes(label)) {
        this._appliedLabels.push(label);
      }
    }
  }

  issueLinkSuffix(issueNumber: number): string {
    return `Closes #${issueNumber}`;
  }
}
