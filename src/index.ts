#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig, applyOverrides } from './config/loader.js';
import { CadreRuntime } from './core/runtime.js';

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
  .action(async (opts) => {
    try {
      let config = await loadConfig(opts.config);
      config = applyOverrides(config, {
        resume: opts.resume,
        dryRun: opts.dryRun,
        issueIds: opts.issue?.map(Number),
        maxParallelIssues: opts.parallel,
        skipValidation: opts.skipValidation,
      });

      if (opts.dryRun) {
        console.log(chalk.green('✓ Configuration is valid'));
        console.log(JSON.stringify(config, null, 2));
        return;
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
