import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig, applyOverrides } from '../config/loader.js';
import { AGENT_DEFINITIONS } from '../agents/types.js';
import { withCommandHandler } from './command-error-handler.js';
import { exists, statOrNull } from '../util/fs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Resolve the bundled templates directory. */
function getTemplateDir(): string {
  return resolve(__dirname, '../agents/templates');
}

/**
 * Resolve the agent directory for the active (or overridden) backend.
 * Both Claude (.claude/agents/) and Copilot (.github/agents/) use plain
 * `{agentName}.md` files — the only difference is the root directory.
 */
function resolveAgentDir(
  config: Awaited<ReturnType<typeof loadConfig>>,
  overrideBackend?: string,
): string {
  const backend = overrideBackend ?? config.agent.backend;
  if (backend === 'claude') {
    return config.agent.claude.agentDir;
  }
  return config.agent.copilot.agentDir;
}

/**
 * Return the agent source file name. Agent instruction files in `agentDir` are
 * always stored as plain `{name}.md` (no frontmatter, no backend-specific suffix).
 * Frontmatter is injected at worktree-sync time for both backends; the `.agent.md`
 * suffix is additionally applied for the Copilot backend.
 */
export function agentFileName(name: string): string {
  return `${name}.md`;
}

/**
 * Copy agent templates to `agentDir`. When `overwrite` is true every file is
 * written unconditionally; when false existing destination files are skipped.
 * Returns the count of files written.
 */
async function copyAgentTemplates(
  agentDir: string,
  templateDir: string,
  overwrite: boolean,
): Promise<number> {
  let written = 0;

  for (const agent of AGENT_DEFINITIONS) {
    const srcPath = join(templateDir, agent.templateFile);
    const destPath = join(agentDir, agentFileName(agent.name));

    if (!(await exists(srcPath))) continue;
    if (!overwrite && (await exists(destPath))) continue;

    const content = await readFile(srcPath, 'utf-8');
    await mkdir(dirname(destPath), { recursive: true });
    await writeFile(destPath, content, 'utf-8');
    written++;
  }

  return written;
}

/**
 * Refresh all agent instruction files in `agentDir` from the bundled templates,
 * always overwriting existing files. Called on every `run` so that updates to
 * bundled templates are picked up without requiring a manual scaffold.
 *
 * Returns the count of files written.
 */
export async function refreshAgentsFromTemplates(
  agentDir: string,
  templateDir?: string,
): Promise<number> {
  return copyAgentTemplates(agentDir, templateDir ?? getTemplateDir(), true);
}

/**
 * Scaffold agent instruction files that are currently missing from `agentDir`.
 * Skips files that already exist; returns the count of files written.
 *
 * Files are stored as plain `{name}.md` regardless of backend.  Frontmatter is
 * injected by the worktree sync step at runtime for both backends.
 */
export async function scaffoldMissingAgents(
  agentDir: string,
  templateDir?: string,
): Promise<number> {
  return copyAgentTemplates(agentDir, templateDir ?? getTemplateDir(), false);
}

/**
 * Register the `agents` command group with `list`, `scaffold`, and `validate` subcommands.
 */
export function registerAgentsCommand(program: Command): void {
  const agents = program.command('agents').description('Manage CADRE agent instruction files');

  // ─── agents list ──────────────────────────────────────
  agents
    .command('list')
    .description('List all CADRE agents and their file status')
    .option('-c, --config <path>', 'Path to cadre.config.json', 'cadre.config.json')
    .option('--provider <name>', 'Override the isolation provider')
    .action(withCommandHandler(async (opts: { config: string; provider?: string }) => {
      let config = await loadConfig(opts.config);
      if (opts.provider != null) config = applyOverrides(config, { provider: opts.provider });
      const agentDir = resolve(resolveAgentDir(config));

      // Header row
      const col1 = 'Agent'.padEnd(30);
      const col2 = 'Ph'.padEnd(4);
      const col3 = 'Phase Name'.padEnd(28);
      const col4 = 'File';
      console.log(chalk.bold(`${col1}${col2}${col3}${col4}`));
      console.log('─'.repeat(72));

      for (const agent of AGENT_DEFINITIONS) {
        const filePath = join(agentDir, agentFileName(agent.name));
        const fileExists = await exists(filePath);
        const status = fileExists ? chalk.green('✅') : chalk.red('❌');
        const name = agent.name.padEnd(30);
        const phase = String(agent.phase).padEnd(4);
        const phaseName = agent.phaseName.padEnd(28);
        console.log(`${name}${phase}${phaseName}${status}`);
      }
    }));

  // ─── agents validate ──────────────────────────────────
  agents
    .command('validate')
    .description('Validate that all agent instruction files exist and are non-empty')
    .option('-c, --config <path>', 'Path to cadre.config.json', 'cadre.config.json')
    .option('--provider <name>', 'Override the isolation provider')
    .action(withCommandHandler(async (opts: { config: string; provider?: string }) => {
      let config = await loadConfig(opts.config);
      if (opts.provider != null) config = applyOverrides(config, { provider: opts.provider });
      const agentDir = resolve(resolveAgentDir(config));
      const issues: string[] = [];

      for (const agent of AGENT_DEFINITIONS) {
        const filePath = join(agentDir, agentFileName(agent.name));
        const fileStat = await statOrNull(filePath);
        if (fileStat === null) {
          issues.push(`  ❌ Missing: ${filePath}`);
        } else if (fileStat.size === 0) {
          issues.push(`  ❌ Empty:   ${filePath}`);
        }
      }

      if (issues.length === 0) {
        console.log(chalk.green(`✅ All ${AGENT_DEFINITIONS.length} agent files are valid.`));
        process.exit(0);
      } else {
        console.error(
          chalk.red(`❌ Validation failed — ${issues.length} issue(s) found:\n`) +
            issues.join('\n'),
        );
        console.error(
          chalk.yellow(
            `\nAgents are auto-scaffolded on 'cadre run'. Re-run to restore missing files.`,
          ),
        );
        process.exit(1);
      }
    }));
}
