import type {
  PlatformProvider,
  IssueDetail,
  IssueComment,
  PullRequestInfo,
  CreatePullRequestParams,
  ListPullRequestsParams,
  ListIssuesParams,
} from './provider.js';
import { Logger } from '../logging/logger.js';

/**
 * Configuration for connecting to Azure DevOps.
 */
export interface AzureDevOpsConfig {
  /** Azure DevOps organization name. */
  organization: string;
  /** Azure DevOps project name. */
  project: string;
  /** Optional repository name (defaults to project name). */
  repositoryName?: string;
  /** Authentication. */
  auth: {
    /** Personal Access Token. */
    pat: string;
  };
  /** API version (defaults to "7.1"). */
  apiVersion?: string;
}

/**
 * Azure DevOps implementation of PlatformProvider.
 *
 * Uses the Azure DevOps REST API to manage work items (issues) and pull requests.
 */
export class AzureDevOpsProvider implements PlatformProvider {
  readonly name = 'Azure DevOps';

  private readonly baseUrl: string;
  private readonly apiVersion: string;
  private readonly authHeader: string;
  private authenticated = false;

  constructor(
    private readonly adoConfig: AzureDevOpsConfig,
    private readonly logger: Logger,
  ) {
    this.baseUrl = `https://dev.azure.com/${adoConfig.organization}/${adoConfig.project}`;
    this.apiVersion = adoConfig.apiVersion ?? '7.1';

    // Azure DevOps uses Basic auth with PAT: base64(":PAT")
    const token = Buffer.from(`:${adoConfig.auth.pat}`).toString('base64');
    this.authHeader = `Basic ${token}`;
  }

  // ── Lifecycle ──

  async connect(): Promise<void> {
    // Validate credentials by fetching the project
    this.logger.info('Connecting to Azure DevOps', {
      data: {
        organization: this.adoConfig.organization,
        project: this.adoConfig.project,
      },
    });

    const ok = await this.checkAuth();
    if (!ok) {
      throw new Error(
        `Azure DevOps authentication failed for org "${this.adoConfig.organization}", project "${this.adoConfig.project}". Check your PAT.`,
      );
    }

    this.authenticated = true;
    this.logger.info('Connected to Azure DevOps');
  }

  async disconnect(): Promise<void> {
    this.authenticated = false;
    this.logger.info('Disconnected from Azure DevOps');
  }

  async checkAuth(): Promise<boolean> {
    try {
      const url = `https://dev.azure.com/${this.adoConfig.organization}/_apis/projects/${this.adoConfig.project}?api-version=${this.apiVersion}`;
      const response = await this.fetch(url);
      if (response.id) {
        this.logger.info(`Authenticated to project: ${response.name}`);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  // ── Issues (Work Items) ──

  async getIssue(issueNumber: number): Promise<IssueDetail> {
    this.ensureConnected();

    // Fetch work item with all fields
    const url =
      `https://dev.azure.com/${this.adoConfig.organization}/${this.adoConfig.project}/_apis/wit/workitems/${issueNumber}?$expand=all&api-version=${this.apiVersion}`;
    const wi = await this.fetch(url);

    // Fetch comments
    const commentsUrl =
      `https://dev.azure.com/${this.adoConfig.organization}/${this.adoConfig.project}/_apis/wit/workitems/${issueNumber}/comments?api-version=${this.apiVersion}-preview.4`;
    let comments: IssueComment[] = [];
    try {
      const commentsResponse = await this.fetch(commentsUrl);
      const rawComments = (commentsResponse.comments ?? []) as Array<Record<string, unknown>>;
      comments = rawComments.map(
        (c: Record<string, unknown>) => ({
          author:
            ((c.createdBy as Record<string, unknown>)?.displayName as string) ??
            'unknown',
          body: (c.text as string) ?? '',
          createdAt: (c.createdDate as string) ?? '',
        }),
      );
    } catch {
      this.logger.debug(`Could not fetch comments for work item ${issueNumber}`);
    }

    return this.parseWorkItem(wi, comments);
  }

  async listIssues(filters: ListIssuesParams): Promise<IssueDetail[]> {
    this.ensureConnected();

    // Build a WIQL query
    const conditions: string[] = [
      `[System.TeamProject] = '${this.adoConfig.project}'`,
    ];

    // Map state filter
    if (filters.state && filters.state !== 'all') {
      if (filters.state === 'open') {
        conditions.push(
          `[System.State] NOT IN ('Closed', 'Done', 'Resolved', 'Removed')`,
        );
      } else if (filters.state === 'closed') {
        conditions.push(
          `[System.State] IN ('Closed', 'Done', 'Resolved')`,
        );
      }
    }

    // Map labels (use Tags in Azure DevOps)
    if (filters.labels && filters.labels.length > 0) {
      for (const label of filters.labels) {
        conditions.push(`[System.Tags] Contains '${label}'`);
      }
    }

    // Map milestone to Iteration Path
    if (filters.milestone) {
      conditions.push(
        `[System.IterationPath] UNDER '${this.adoConfig.project}\\${filters.milestone}'`,
      );
    }

    // Map assignee
    if (filters.assignee) {
      conditions.push(`[System.AssignedTo] = '${filters.assignee}'`);
    }

    const wiql = `SELECT [System.Id] FROM WorkItems WHERE ${conditions.join(' AND ')} ORDER BY [System.Id] ASC`;
    const top = filters.limit ?? 30;

    const url =
      `https://dev.azure.com/${this.adoConfig.organization}/${this.adoConfig.project}/_apis/wit/wiql?api-version=${this.apiVersion}&$top=${top}`;
    const queryResult = await this.fetch(url, {
      method: 'POST',
      body: JSON.stringify({ query: wiql }),
    });

    const workItemIds: number[] = (
      queryResult.workItems as Array<{ id: number }>
    )?.map((wi) => wi.id) ?? [];

    if (workItemIds.length === 0) {
      return [];
    }

    // Batch fetch work items
    const batchUrl =
      `https://dev.azure.com/${this.adoConfig.organization}/${this.adoConfig.project}/_apis/wit/workitems?ids=${workItemIds.join(',')}&$expand=all&api-version=${this.apiVersion}`;
    const batchResult = await this.fetch(batchUrl);
    const items = (batchResult.value ?? []) as Array<Record<string, unknown>>;

    return items.map((wi) => this.parseWorkItem(wi, []));
  }

  async addIssueComment(issueNumber: number, body: string): Promise<void> {
    this.ensureConnected();

    const url =
      `https://dev.azure.com/${this.adoConfig.organization}/${this.adoConfig.project}/_apis/wit/workitems/${issueNumber}/comments?api-version=${this.apiVersion}-preview.4`;
    await this.fetch(url, {
      method: 'POST',
      body: JSON.stringify({ text: body }),
    });
  }

  // ── Pull Requests ──

  async createPullRequest(params: CreatePullRequestParams): Promise<PullRequestInfo> {
    this.ensureConnected();

    const repoName = this.adoConfig.repositoryName ?? this.adoConfig.project;
    const url =
      `https://dev.azure.com/${this.adoConfig.organization}/${this.adoConfig.project}/_apis/git/repositories/${repoName}/pullrequests?api-version=${this.apiVersion}`;

    const body: Record<string, unknown> = {
      sourceRefName: `refs/heads/${params.head}`,
      targetRefName: `refs/heads/${params.base}`,
      title: params.title,
      description: params.body,
    };

    if (params.draft) {
      body.isDraft = true;
    }

    const result = await this.fetch(url, {
      method: 'POST',
      body: JSON.stringify(body),
    });

    const prId = result.pullRequestId as number;
    const webUrl =
      `https://dev.azure.com/${this.adoConfig.organization}/${this.adoConfig.project}/_git/${repoName}/pullrequest/${prId}`;

    this.logger.info(`Created PR #${prId}: ${webUrl}`, {
      data: { prId, webUrl },
    });

    // Set labels (non-critical — log warnings on failure)
    if (params.labels && params.labels.length > 0) {
      const labelsUrl =
        `https://dev.azure.com/${this.adoConfig.organization}/${this.adoConfig.project}/_apis/git/repositories/${repoName}/pullrequests/${prId}/labels?api-version=${this.apiVersion}`;
      for (const label of params.labels) {
        try {
          await this.fetch(labelsUrl, {
            method: 'POST',
            body: JSON.stringify({ name: label }),
          });
        } catch (err) {
          this.logger.warn(`Failed to set label "${label}" on PR #${prId}: ${(err as Error).message}`);
        }
      }
    }

    // Add reviewers (non-critical — log warnings on failure)
    if (params.reviewers && params.reviewers.length > 0) {
      for (const reviewer of params.reviewers) {
        try {
          // Resolve reviewer identity GUID from unique name (email/alias)
          const identityUrl =
            `https://vssps.dev.azure.com/${this.adoConfig.organization}/_apis/identities?searchFilter=AccountName&filterValue=${encodeURIComponent(reviewer)}&api-version=${this.apiVersion}`;
          const identityResult = await this.fetch(identityUrl);
          const identities = (identityResult.value ?? []) as Array<Record<string, unknown>>;
          if (identities.length === 0) {
            this.logger.warn(`Could not resolve reviewer "${reviewer}" on PR #${prId}: no matching identity found`);
            continue;
          }
          const reviewerId = identities[0].id as string;
          const reviewerUrl =
            `https://dev.azure.com/${this.adoConfig.organization}/${this.adoConfig.project}/_apis/git/repositories/${repoName}/pullrequests/${prId}/reviewers/${reviewerId}?api-version=${this.apiVersion}`;
          await this.fetch(reviewerUrl, {
            method: 'PUT',
            body: JSON.stringify({ id: reviewerId, vote: 0 }),
          });
        } catch (err) {
          this.logger.warn(`Failed to add reviewer "${reviewer}" to PR #${prId}: ${(err as Error).message}`);
        }
      }
    }

    return {
      number: prId,
      url: webUrl,
      title: params.title,
      headBranch: params.head,
      baseBranch: params.base,
    };
  }

  async getPullRequest(prNumber: number): Promise<PullRequestInfo> {
    this.ensureConnected();

    const repoName = this.adoConfig.repositoryName ?? this.adoConfig.project;
    const url =
      `https://dev.azure.com/${this.adoConfig.organization}/${this.adoConfig.project}/_apis/git/repositories/${repoName}/pullrequests/${prNumber}?api-version=${this.apiVersion}`;

    const result = await this.fetch(url);

    return {
      number: result.pullRequestId as number,
      url: `https://dev.azure.com/${this.adoConfig.organization}/${this.adoConfig.project}/_git/${repoName}/pullrequest/${result.pullRequestId}`,
      title: (result.title as string) ?? '',
      headBranch: this.stripRefPrefix((result.sourceRefName as string) ?? ''),
      baseBranch: this.stripRefPrefix((result.targetRefName as string) ?? ''),
    };
  }

  async updatePullRequest(
    prNumber: number,
    updates: { title?: string; body?: string },
  ): Promise<void> {
    this.ensureConnected();

    const repoName = this.adoConfig.repositoryName ?? this.adoConfig.project;
    const url =
      `https://dev.azure.com/${this.adoConfig.organization}/${this.adoConfig.project}/_apis/git/repositories/${repoName}/pullrequests/${prNumber}?api-version=${this.apiVersion}`;

    const body: Record<string, unknown> = {};
    if (updates.title) body.title = updates.title;
    if (updates.body) body.description = updates.body;

    await this.fetch(url, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  async listPullRequests(
    filters?: ListPullRequestsParams,
  ): Promise<PullRequestInfo[]> {
    this.ensureConnected();

    const repoName = this.adoConfig.repositoryName ?? this.adoConfig.project;
    const params = new URLSearchParams({
      'api-version': this.apiVersion,
    });

    if (filters?.state) {
      // Azure DevOps PR status: active, completed, abandoned, all
      const statusMap: Record<string, string> = {
        open: 'active',
        closed: 'completed',
        all: 'all',
      };
      params.set(
        'searchCriteria.status',
        statusMap[filters.state] ?? 'active',
      );
    }

    if (filters?.head) {
      params.set(
        'searchCriteria.sourceRefName',
        `refs/heads/${filters.head}`,
      );
    }
    if (filters?.base) {
      params.set(
        'searchCriteria.targetRefName',
        `refs/heads/${filters.base}`,
      );
    }

    const url =
      `https://dev.azure.com/${this.adoConfig.organization}/${this.adoConfig.project}/_apis/git/repositories/${repoName}/pullrequests?${params.toString()}`;

    const result = await this.fetch(url);
    const prs = (result.value ?? []) as Array<Record<string, unknown>>;

    return prs.map((pr) => ({
      number: pr.pullRequestId as number,
      url: `https://dev.azure.com/${this.adoConfig.organization}/${this.adoConfig.project}/_git/${repoName}/pullrequest/${pr.pullRequestId}`,
      title: (pr.title as string) ?? '',
      headBranch: this.stripRefPrefix((pr.sourceRefName as string) ?? ''),
      baseBranch: this.stripRefPrefix((pr.targetRefName as string) ?? ''),
    }));
  }

  // ── Issue Linking ──

  issueLinkSuffix(issueNumber: number): string {
    return `AB#${issueNumber}`;
  }

  // ── Helpers ──

  private ensureConnected(): void {
    if (!this.authenticated) {
      throw new Error('AzureDevOpsProvider not connected — call connect() first');
    }
  }

  private stripRefPrefix(ref: string): string {
    return ref.replace(/^refs\/heads\//, '');
  }

  /**
   * Make an authenticated HTTP request to the Azure DevOps REST API.
   */
  private async fetch(
    url: string,
    init?: { method?: string; body?: string },
  ): Promise<Record<string, unknown>> {
    const response = await globalThis.fetch(url, {
      method: init?.method ?? 'GET',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: init?.body,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Azure DevOps API error: ${response.status} ${response.statusText} — ${text}`,
      );
    }

    return (await response.json()) as Record<string, unknown>;
  }

  /**
   * Parse an Azure DevOps work item into a normalized IssueDetail.
   */
  private parseWorkItem(
    wi: Record<string, unknown>,
    comments: IssueComment[],
  ): IssueDetail {
    const fields = (wi.fields ?? {}) as Record<string, unknown>;

    // Extract tags (Azure DevOps stores as semicolon-separated string)
    const tagsStr = (fields['System.Tags'] as string) ?? '';
    const labels = tagsStr
      ? tagsStr.split(';').map((t) => t.trim()).filter(Boolean)
      : [];

    // Assignee
    const assignedTo = fields['System.AssignedTo'] as
      | Record<string, unknown>
      | undefined;
    const assignees = assignedTo
      ? [(assignedTo.displayName as string) ?? (assignedTo.uniqueName as string) ?? '']
      : [];

    // Iteration path as milestone
    const iterationPath = fields['System.IterationPath'] as string | undefined;
    const milestone = iterationPath?.includes('\\')
      ? iterationPath.split('\\').pop()
      : iterationPath;

    // Map state
    const rawState = (fields['System.State'] as string) ?? '';
    const closedStates = ['Closed', 'Done', 'Resolved', 'Removed'];
    const state: 'open' | 'closed' = closedStates.includes(rawState)
      ? 'closed'
      : 'open';

    return {
      number: wi.id as number,
      title: (fields['System.Title'] as string) ?? '',
      body: (fields['System.Description'] as string) ?? '',
      labels,
      assignees,
      milestone,
      comments,
      state,
      createdAt: (fields['System.CreatedDate'] as string) ?? '',
      updatedAt: (fields['System.ChangedDate'] as string) ?? '',
      linkedPRs: [],
    };
  }
}
