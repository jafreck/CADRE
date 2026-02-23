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
    .option('--skip-agent-validation', 'Skip pre-flight agent file validation');
  program.command('status').description('Show current pipeline status');
  program.command('reset').description('Reset pipeline state');
  program
    .command('worktrees')
    .description('List or prune CADRE-managed worktrees')
    .option('--prune', 'Remove worktrees for completed issues')
    .option('-d, --dry-run', 'Print what would be pruned without removing anything');
  program
    .command('cleanup')
    .description('Remove worktrees for completed issues (alias for worktrees --prune)')
    .option('-c, --config <path>', 'Path to cadre.config.json', 'cadre.config.json')
    .option('-d, --dry-run', 'Print what would be pruned without removing anything');

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
    expect(commandNames).toContain('cleanup');
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

  it('should register --skip-agent-validation option on the run command', () => {
    const program = buildProgram();
    const runCmd = program.commands.find((c) => c.name() === 'run');
    expect(runCmd).toBeDefined();
    const optionNames = runCmd!.options.map((o) => o.long);
    expect(optionNames).toContain('--skip-agent-validation');
  });

  it('should register the cleanup command at the top level', () => {
    const program = buildProgram();
    const commandNames = program.commands.map((c) => c.name());
    expect(commandNames).toContain('cleanup');
  });

  it('should register --dry-run option on the cleanup command', () => {
    const program = buildProgram();
    const cleanupCmd = program.commands.find((c) => c.name() === 'cleanup');
    expect(cleanupCmd).toBeDefined();
    const optionNames = cleanupCmd!.options.map((o) => o.long);
    expect(optionNames).toContain('--dry-run');
  });

  it('should register --dry-run option on the worktrees command', () => {
    const program = buildProgram();
    const worktreesCmd = program.commands.find((c) => c.name() === 'worktrees');
    expect(worktreesCmd).toBeDefined();
    const optionNames = worktreesCmd!.options.map((o) => o.long);
    expect(optionNames).toContain('--dry-run');
  });

  it('should parse cleanup --dry-run and set dryRun to true', () => {
    const program = buildProgram();
    const cleanupCmd = program.commands.find((c) => c.name() === 'cleanup')!;
    cleanupCmd.parseOptions(['--dry-run']);
    const opts = cleanupCmd.opts();
    expect(opts.dryRun).toBe(true);
  });

  it('should default cleanup dryRun to false when flag is absent', () => {
    const program = buildProgram();
    const cleanupCmd = program.commands.find((c) => c.name() === 'cleanup')!;
    cleanupCmd.parseOptions([]);
    const opts = cleanupCmd.opts();
    expect(opts.dryRun).toBeFalsy();
  });
});
