import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import { registerAgentsCommand } from '../src/cli/agents.js';

/**
 * Build a minimal program that mirrors what src/index.ts does:
 * register the built-in commands and then call registerAgentsCommand.
 */
function buildProgram(): Command {
  const program = new Command();
  program.name('cadre').exitOverride();

  program
    .command('run')
    .description('Execute the CADRE pipeline for configured issues')
    .option('-c, --config <path>', 'Path to cadre.config.json', 'cadre.config.json')
    .option('-r, --resume', 'Resume from last checkpoint')
    .option('-d, --dry-run', 'Validate configuration without executing')
    .option('-i, --issue <numbers...>', 'Override: process specific issue numbers')
    .option('-p, --parallel <n>', 'Override: max parallel issues', parseInt)
    .option('--no-pr', 'Skip PR creation')
    .option('--respond-to-reviews', 'Respond to pull request reviews instead of processing new issues');
  program.command('status').description('Show current pipeline status');
  program.command('reset').description('Reset pipeline state');
  program.command('worktrees').description('List or prune CADRE-managed worktrees');

  registerAgentsCommand(program);

  return program;
}

describe('src/index.ts command registration', () => {
  it('should register the agents command at the top level', () => {
    const program = buildProgram();
    const commandNames = program.commands.map((c) => c.name());
    expect(commandNames).toContain('agents');
  });

  it('should preserve existing commands alongside agents', () => {
    const program = buildProgram();
    const commandNames = program.commands.map((c) => c.name());
    expect(commandNames).toContain('run');
    expect(commandNames).toContain('status');
    expect(commandNames).toContain('reset');
    expect(commandNames).toContain('worktrees');
  });

  it('should register agents with list subcommand', () => {
    const program = buildProgram();
    const agentsCmd = program.commands.find((c) => c.name() === 'agents');
    expect(agentsCmd).toBeDefined();
    const subNames = agentsCmd!.commands.map((c) => c.name());
    expect(subNames).toContain('list');
  });

  it('should register agents with scaffold subcommand', () => {
    const program = buildProgram();
    const agentsCmd = program.commands.find((c) => c.name() === 'agents');
    expect(agentsCmd).toBeDefined();
    const subNames = agentsCmd!.commands.map((c) => c.name());
    expect(subNames).toContain('scaffold');
  });

  it('should register agents with validate subcommand', () => {
    const program = buildProgram();
    const agentsCmd = program.commands.find((c) => c.name() === 'agents');
    expect(agentsCmd).toBeDefined();
    const subNames = agentsCmd!.commands.map((c) => c.name());
    expect(subNames).toContain('validate');
  });

  it('should register exactly list, scaffold, and validate under agents', () => {
    const program = buildProgram();
    const agentsCmd = program.commands.find((c) => c.name() === 'agents');
    expect(agentsCmd).toBeDefined();
    const subNames = agentsCmd!.commands.map((c) => c.name()).sort();
    expect(subNames).toEqual(['list', 'scaffold', 'validate']);
  });

  it('should register --no-pr option on the run command', () => {
    const program = buildProgram();
    const runCmd = program.commands.find((c) => c.name() === 'run');
    expect(runCmd).toBeDefined();
    const optionNames = runCmd!.options.map((o) => o.long);
    expect(optionNames).toContain('--no-pr');
  });

  it('should default pr to true when --no-pr is not provided', () => {
    const program = buildProgram();
    const runCmd = program.commands.find((c) => c.name() === 'run')!;
    runCmd.parseOptions([]);
    expect(runCmd.opts().pr).toBe(true);
  });

  it('should set pr to false when --no-pr is provided', () => {
    const program = buildProgram();
    const runCmd = program.commands.find((c) => c.name() === 'run')!;
    runCmd.parseOptions(['--no-pr']);
    expect(runCmd.opts().pr).toBe(false);
  });

  it('noPr value (!opts.pr) should be true when --no-pr is provided', () => {
    const program = buildProgram();
    const runCmd = program.commands.find((c) => c.name() === 'run')!;
    runCmd.parseOptions(['--no-pr']);
    const opts = runCmd.opts();
    expect(!opts.pr).toBe(true);
  });

  it('noPr value (!opts.pr) should be false when --no-pr is not provided', () => {
    const program = buildProgram();
    const runCmd = program.commands.find((c) => c.name() === 'run')!;
    runCmd.parseOptions([]);
    const opts = runCmd.opts();
    expect(!opts.pr).toBe(false);
  });

  it('should register --respond-to-reviews option on the run command', () => {
    const program = buildProgram();
    const runCmd = program.commands.find((c) => c.name() === 'run');
    expect(runCmd).toBeDefined();
    const optionNames = runCmd!.options.map((o) => o.long);
    expect(optionNames).toContain('--respond-to-reviews');
  });

  it('should set respondToReviews to true when --respond-to-reviews is provided', () => {
    const program = buildProgram();
    const runCmd = program.commands.find((c) => c.name() === 'run')!;
    runCmd.parseOptions(['--respond-to-reviews']);
    expect(runCmd.opts().respondToReviews).toBe(true);
  });

  it('should not set respondToReviews when --respond-to-reviews is not provided', () => {
    const program = buildProgram();
    const runCmd = program.commands.find((c) => c.name() === 'run')!;
    runCmd.parseOptions([]);
    expect(runCmd.opts().respondToReviews).toBeUndefined();
  });

  it('should accept --respond-to-reviews combined with --issue', () => {
    const program = buildProgram();
    const runCmd = program.commands.find((c) => c.name() === 'run')!;
    runCmd.parseOptions(['--respond-to-reviews', '--issue', '42', '97']);
    const opts = runCmd.opts();
    expect(opts.respondToReviews).toBe(true);
    expect(opts.issue).toEqual(['42', '97']);
  });
});
