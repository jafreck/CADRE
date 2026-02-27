import { join } from 'node:path';
import type { RuntimeConfig } from '../config/loader.js';
import type { FleetResult } from './fleet-orchestrator.js';
import type { PlatformProvider } from '../platform/provider.js';
import { createPlatformProvider } from '../platform/factory.js';
import { Logger } from '../logging/logger.js';
import { createNotificationManager } from '../notifications/manager.js';
import { DogfoodProvider } from '../notifications/dogfood-provider.js';
import { GitHubAPI } from '../github/api.js';
import { StatusService } from './status-service.js';
import { ResetService } from './reset-service.js';
import { ReportService } from './report-service.js';
import { WorktreeLifecycleService } from './worktree-lifecycle-service.js';
import { RunCoordinator } from './run-coordinator.js';

/**
 * Top-level CadreRuntime — thin facade that delegates to focused services.
 */
export class CadreRuntime {
  private readonly logger: Logger;
  private readonly provider: PlatformProvider;
  private readonly statusService: StatusService;
  private readonly resetService: ResetService;
  private readonly reportService: ReportService;
  private readonly worktreeLifecycleService: WorktreeLifecycleService;
  private readonly runCoordinator: RunCoordinator;

  constructor(private readonly config: RuntimeConfig) {
    this.logger = new Logger({
      source: 'fleet',
      logDir: join(config.stateDir, 'logs'),
      level: 'info',
      console: true,
    });

    this.provider = createPlatformProvider(config, this.logger);

    const notifications = createNotificationManager(config);

    if (config.dogfood?.enabled) {
      const dogfoodApi = new GitHubAPI(config.repository, this.logger);
      const dogfoodProvider = new DogfoodProvider(dogfoodApi, {
        maxIssuesPerRun: config.dogfood.maxIssuesPerRun,
        labels: config.dogfood.labels,
        titlePrefix: config.dogfood.titlePrefix,
      });
      notifications.addProvider(dogfoodProvider);
    }

    this.statusService = new StatusService(config, this.logger);
    this.resetService = new ResetService(config, this.logger);
    this.reportService = new ReportService(config, this.logger);
    this.worktreeLifecycleService = new WorktreeLifecycleService(config, this.logger, this.provider);
    this.runCoordinator = new RunCoordinator(config, this.logger, this.provider, notifications);
  }

  async validate(): Promise<boolean> {
    return this.runCoordinator.validate();
  }

  async run(): Promise<FleetResult> {
    return this.runCoordinator.run();
  }

  async status(issueNumber?: number): Promise<void> {
    return this.statusService.status(issueNumber);
  }

  async reset(issueNumber?: number, fromPhase?: number): Promise<void> {
    return this.resetService.reset(issueNumber, fromPhase);
  }

  async report(options: { format?: 'json'; history?: boolean } = {}): Promise<void> {
    return this.reportService.report(options);
  }

  async listWorktrees(): Promise<void> {
    return this.worktreeLifecycleService.listWorktrees();
  }

  async pruneWorktrees(): Promise<void> {
    return this.worktreeLifecycleService.pruneWorktrees();
  }

  emptyResult(): FleetResult {
    return {
      success: true,
      issues: [],
      prsCreated: [],
      failedIssues: [],
      codeDoneNoPR: [],
      totalDuration: 0,
      tokenUsage: { total: 0, byIssue: {}, byAgent: {}, byPhase: {}, recordCount: 0 },
    };
  }
}
