export type {
  PlatformProvider,
  IssueDetail,
  IssueComment,
  PullRequestInfo,
  CreatePullRequestParams,
  ListPullRequestsParams,
  ListIssuesParams,
} from './provider.js';

export { GitHubProvider } from './github-provider.js';
export { AzureDevOpsProvider, type AzureDevOpsConfig } from './azure-devops-provider.js';

export { createPlatformProvider } from './factory.js';
