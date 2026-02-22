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

  program.command('run').description('Execute the CADRE pipeline for configured issues');
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
});
