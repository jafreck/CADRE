#!/usr/bin/env node

export { WorktreeProvisioner } from './git/worktree-provisioner.js';
export { AgentFileSync } from './git/agent-file-sync.js';
export { WorktreeCleaner } from './git/worktree-cleaner.js';
export { DependencyBranchMerger } from './git/dependency-branch-merger.js';

import { Command } from 'commander';
import chalk from 'chalk';
import { runInit } from './cli/init.js';
import { loadConfig, applyOverrides } from './config/loader.js';
import { CadreRuntime } from './core/runtime.js';
import { AgentLauncher } from './core/agent-launcher.js';
import { registerAgentsCommand, scaffoldMissingAgents, refreshAgentsFromTemplates } from './cli/agents.js';
import { StatusService } from './core/status-service.js';
import { ResetService } from './core/reset-service.js';
import { ReportService } from './core/report-service.js';
import { WorktreeLifecycleService } from './core/worktree-lifecycle-service.js';
import { PreRunValidationSuite, gitValidator, agentBackendValidator, platformValidator, commandValidator, diskValidator } from './validation/index.js';
import { Logger } from './logging/logger.js';
import { createPlatformProvider } from './platform/factory.js';
import { withCommandHandler } from './cli/command-error-handler.js';

const program = new Command();

program
  .name('cadre')
  .description('Coordinated Agent Development Runtime Engine')
  .version('0.1.0');

// ─── run ──────────────────────────────────────────────
program
  .command('run')
  .description('Execute the CADRE pipeline for configured issues')
  .option('-c, --config <path>', 'Path to cadre.config.json', 'cadre.config.json')
  .option('-r, --resume', 'Resume from last checkpoint')
  .option('-d, --dry-run', 'Validate configuration without executing')
  .option('-i, --issue <numbers...>', 'Override: process specific issue numbers')
  .option('-p, --parallel <n>', 'Override: max parallel issues', parseInt)
  .option('--no-pr', 'Skip PR creation')
  .option('--respond-to-reviews', 'Address open PR review comments instead of starting a new pipeline')
  .option('--skip-agent-validation', 'Skip pre-flight agent file validation')
  .option('--skip-validation', 'Skip pre-run validation checks')
  .option('--no-autoscaffold', 'Skip auto-scaffolding of missing agent files')
  .option('--dag', 'Enable DAG-based dependency ordering of issues (overrides config)')
  .action(withCommandHandler(async (opts) => {
    let config = await loadConfig(opts.config);
    config = applyOverrides(config, {
      resume: opts.resume,
      dryRun: opts.dryRun,
      issueIds: opts.issue?.map(Number),
      maxParallelIssues: opts.parallel,
      skipValidation: opts.skipValidation,
      noPr: !opts.pr,
      respondToReviews: opts.respondToReviews,
    });

    // Enable DAG mode when --dag flag is provided
    if (opts.dag) {
      config = { ...config, dag: { ...config.dag, enabled: true } };
    }

    if (opts.dryRun) {
      console.log(chalk.green('✓ Configuration is valid'));
      console.log(JSON.stringify(config, null, 2));
      return;
    }

    if (!opts.skipAgentValidation) {
      const backend = config.agent.backend;
      const agentDir =
        backend === 'claude'
          ? config.agent.claude.agentDir
          : config.agent.copilot.agentDir;

      // Always refresh agentDir from bundled templates so worktree syncs pick
      // up template changes without requiring a manual `cadre agents scaffold`.
      await refreshAgentsFromTemplates(agentDir);

      let issues = await AgentLauncher.validateAgentFiles(agentDir);

      if (issues.length > 0) {
        const scaffoldableIssues = issues.filter((i) => i.includes('Missing:'));
        const nonScaffoldable = issues.filter((i) => !i.includes('Missing:'));

        if (opts.autoscaffold && scaffoldableIssues.length > 0) {
          const n = await scaffoldMissingAgents(agentDir);
          console.log(`ℹ️ Auto-scaffolded ${n} missing agent file(s) — continuing.`);
          issues = await AgentLauncher.validateAgentFiles(agentDir);
        }

        if (issues.length > 0) {
          console.error(
            chalk.red(`❌ Agent validation failed — ${issues.length} issue(s) found:\n`) +
              issues.join('\n'),
          );
          console.error(
            chalk.yellow(`\nRun 'cadre agents scaffold' to create missing files, or use --skip-agent-validation to bypass.`),
          );
          process.exit(1);
        }
      }
    }

    const runtime = new CadreRuntime(config);
    const result = await runtime.run();

    process.exit(result.success ? 0 : 1);
  }));

// ─── status ───────────────────────────────────────────
program
  .command('status')
  .description('Show current pipeline status')
  .option('-c, --config <path>', 'Path to cadre.config.json', 'cadre.config.json')
  .option('-i, --issue <number>', 'Show status for specific issue', parseInt)
  .action(withCommandHandler(async (opts) => {
    const config = await loadConfig(opts.config);
    const logger = new Logger({ source: 'fleet', logDir: `${config.stateDir}/logs`, level: 'info', console: true });
    const service = new StatusService(config, logger);
    await service.status(opts.issue);
  }));

// ─── reset ────────────────────────────────────────────
program
  .command('reset')
  .description('Reset pipeline state (all or specific issue)')
  .option('-c, --config <path>', 'Path to cadre.config.json', 'cadre.config.json')
  .option('-i, --issue <number>', 'Reset specific issue', parseInt)
  .option('-p, --phase <number>', 'Reset from specific phase', parseInt)
  .action(withCommandHandler(async (opts) => {
    const config = await loadConfig(opts.config);
    const logger = new Logger({ source: 'fleet', logDir: `${config.stateDir}/logs`, level: 'info', console: true });
    const service = new ResetService(config, logger);
    await service.reset(opts.issue, opts.phase);
  }));

// ─── report ───────────────────────────────────────────
program
  .command('report')
  .description('Show a summary report of pipeline runs')
  .option('-c, --config <path>', 'Path to cadre.config.json', 'cadre.config.json')
  .option('-f, --format <format>', 'Output format (json for raw JSON)', 'human')
  .option('--history', 'List all historical run reports')
  .action(withCommandHandler(async (opts) => {
    const config = await loadConfig(opts.config);
    const logger = new Logger({ source: 'fleet', logDir: `${config.stateDir}/logs`, level: 'info', console: true });
    const service = new ReportService(config, logger);
    await service.report({ format: opts.format, history: opts.history });
  }));

// ─── worktrees ────────────────────────────────────────
program
  .command('worktrees')
  .description('List or prune CADRE-managed worktrees')
  .option('-c, --config <path>', 'Path to cadre.config.json', 'cadre.config.json')
  .option('--prune', 'Remove worktrees for completed issues')
  .action(withCommandHandler(async (opts) => {
    const config = await loadConfig(opts.config);
    const logger = new Logger({ source: 'fleet', logDir: `${config.stateDir}/logs`, level: 'info', console: true });
    const provider = createPlatformProvider(config, logger);
    const service = new WorktreeLifecycleService(config, logger, provider);
    if (opts.prune) {
      await service.pruneWorktrees();
    } else {
      await service.listWorktrees();
    }
  }));

// ─── init ─────────────────────────────────────────────
program
  .command('init')
  .description('Initialize CADRE in the current repository')
  .option('-y, --yes', 'Accept all defaults without prompting')
  .option('--repo-path <path>', 'Path to git repository root (overrides cwd)')
  .action(withCommandHandler(async (opts) => {
    await runInit({ yes: !!opts.yes, repoPath: opts.repoPath });
  }));

// ─── agents ───────────────────────────────────────────
registerAgentsCommand(program);

// ─── validate ─────────────────────────────────────────
program
  .command('validate')
  .description('Run pre-flight validation checks against the configuration')
  .option('-c, --config <path>', 'Path to cadre.config.json', 'cadre.config.json')
  .action(withCommandHandler(async (opts) => {
    const config = await loadConfig(opts.config);
    const suite = new PreRunValidationSuite([
      gitValidator,
      agentBackendValidator,
      platformValidator,
      commandValidator,
      diskValidator,
    ]);
    const passed = await suite.run(config);
    process.exit(passed ? 0 : 1);
  }));

program.parse();
