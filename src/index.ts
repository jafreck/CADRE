#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { runInit } from './cli/init.js';
import { loadConfig, applyOverrides } from './config/loader.js';
import { CadreRuntime } from './core/runtime.js';
import { AgentLauncher } from './core/agent-launcher.js';
import { registerAgentsCommand, scaffoldMissingAgentFiles } from './cli/agents.js';

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
  .option('--skip-validation', 'Skip pre-run validation checks')
  .option('--respond-to-reviews', 'Respond to pull request reviews instead of processing new issues')
  .action(async (opts) => {
    try {
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

      if (opts.respondToReviews) {
        console.log(chalk.cyan('🔁 Review-response mode active'));
      }

      if (opts.dryRun) {
        console.log(chalk.green('✓ Configuration is valid'));
        console.log(JSON.stringify(config, null, 2));
        return;
      }

      const backend = config.agent?.backend ?? 'copilot';
      const agentDir = config.agent?.copilot?.agentDir ?? config.copilot.agentDir;

      // Auto-scaffold any missing agent files from bundled templates before validating.
      const created = await scaffoldMissingAgentFiles(agentDir, backend);
      if (created.length > 0) {
        console.log(
          chalk.cyan(`ℹ  Auto-scaffolded ${created.length} missing agent file(s) from built-in templates:`),
        );
        for (const f of created) console.log(chalk.cyan(`   + ${f}`));
      }

      // Validate — any file that is still missing (e.g., unreadable template) is a hard error.
      const issues = await AgentLauncher.validateAgentFiles(agentDir, backend);
      if (issues.length > 0) {
        console.error(
          chalk.red(`❌ Agent validation failed — ${issues.length} issue(s) found:\n`) +
            issues.join('\n'),
        );
        console.error(
          chalk.yellow(`\nCheck that the agent template files exist under src/agents/templates/ and re-run.`),
        );
        process.exit(1);
      }

      const runtime = new CadreRuntime(config);
      const result = await runtime.run();

      process.exit(result.success ? 0 : 1);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Error: ${msg}`));
      process.exit(1);
    }
  });

// ─── status ───────────────────────────────────────────
program
  .command('status')
  .description('Show current pipeline status')
  .option('-c, --config <path>', 'Path to cadre.config.json', 'cadre.config.json')
  .option('-i, --issue <number>', 'Show status for specific issue', parseInt)
  .action(async (opts) => {
    try {
      const config = await loadConfig(opts.config);
      const runtime = new CadreRuntime(config);
      await runtime.status(opts.issue);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Error: ${msg}`));
      process.exit(1);
    }
  });

// ─── reset ────────────────────────────────────────────
program
  .command('reset')
  .description('Reset pipeline state (all or specific issue)')
  .option('-c, --config <path>', 'Path to cadre.config.json', 'cadre.config.json')
  .option('-i, --issue <number>', 'Reset specific issue', parseInt)
  .option('-p, --phase <number>', 'Reset from specific phase', parseInt)
  .action(async (opts) => {
    try {
      const config = await loadConfig(opts.config);
      const runtime = new CadreRuntime(config);
      await runtime.reset(opts.issue, opts.phase);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Error: ${msg}`));
      process.exit(1);
    }
  });

// ─── report ───────────────────────────────────────────
program
  .command('report')
  .description('Show a summary report of pipeline runs')
  .option('-c, --config <path>', 'Path to cadre.config.json', 'cadre.config.json')
  .option('-f, --format <format>', 'Output format (json for raw JSON)', 'human')
  .option('--history', 'List all historical run reports')
  .action(async (opts) => {
    try {
      const config = await loadConfig(opts.config);
      const runtime = new CadreRuntime(config);
      await runtime.report({ format: opts.format, history: opts.history });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Error: ${msg}`));
      process.exit(1);
    }
  });

// ─── worktrees ────────────────────────────────────────
program
  .command('worktrees')
  .description('List or prune CADRE-managed worktrees')
  .option('-c, --config <path>', 'Path to cadre.config.json', 'cadre.config.json')
  .option('--prune', 'Remove worktrees for completed issues')
  .action(async (opts) => {
    try {
      const config = await loadConfig(opts.config);
      const runtime = new CadreRuntime(config);
      if (opts.prune) {
        await runtime.pruneWorktrees();
      } else {
        await runtime.listWorktrees();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Error: ${msg}`));
      process.exit(1);
    }
  });

// ─── init ─────────────────────────────────────────────
program
  .command('init')
  .description('Initialize CADRE in the current repository')
  .option('-y, --yes', 'Accept all defaults without prompting')
  .option('--repo-path <path>', 'Path to git repository root (overrides cwd)')
  .action(async (opts) => {
    try {
      await runInit({ yes: !!opts.yes, repoPath: opts.repoPath });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Error: ${msg}`));
      process.exit(1);
    }
  });

// ─── agents ───────────────────────────────────────────
registerAgentsCommand(program);

// ─── validate ─────────────────────────────────────────
program
  .command('validate')
  .description('Run pre-flight validation checks against the configuration')
  .option('-c, --config <path>', 'Path to cadre.config.json', 'cadre.config.json')
  .action(async (opts) => {
    try {
      const config = await loadConfig(opts.config);
      const runtime = new CadreRuntime(config);
      const passed = await runtime.validate();
      process.exit(passed ? 0 : 1);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Error: ${msg}`));
      process.exit(1);
    }
  });

program.parse();
