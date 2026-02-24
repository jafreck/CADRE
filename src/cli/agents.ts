import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig } from '../config/loader.js';
import { AGENT_DEFINITIONS } from '../agents/types.js';
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
  const backend = overrideBackend ?? config.agent?.backend ?? 'copilot';
  if (backend === 'claude') {
    return config.agent?.claude.agentDir ?? '.claude/agents';
  }
  return config.agent!.copilot.agentDir;
}

/**
 * Scaffold agent instruction files that are currently missing from `agentDir`.
 * Skips files that already exist; returns the count of files written.
 *
 * Both backends use flat `${agent.name}.md` files — the only difference is the
 * parent directory (`.github/agents/` for copilot, `.claude/agents/` for claude),
 * which is already encoded in `agentDir` by the time this function is called.
 */
export async function scaffoldMissingAgents(
  agentDir: string,
  templateDir?: string,
): Promise<number> {
  const resolvedTemplateDir = templateDir ?? getTemplateDir();
  let written = 0;

  for (const agent of AGENT_DEFINITIONS) {
    const srcPath = join(resolvedTemplateDir, agent.templateFile);
    const fileName = `${agent.name}.md`;
    const destPath = join(agentDir, fileName);

    if (!(await exists(srcPath))) continue;
    if (await exists(destPath)) continue;

    const content = await readFile(srcPath, 'utf-8');
    await mkdir(dirname(destPath), { recursive: true });
    await writeFile(destPath, content, 'utf-8');
    written++;
  }

  return written;
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
    .action(async (opts: { config: string }) => {
      try {
        const config = await loadConfig(opts.config);
        const agentDir = resolve(resolveAgentDir(config));

        // Header row
        const col1 = 'Agent'.padEnd(30);
        const col2 = 'Ph'.padEnd(4);
        const col3 = 'Phase Name'.padEnd(28);
        const col4 = 'File';
        console.log(chalk.bold(`${col1}${col2}${col3}${col4}`));
        console.log('─'.repeat(72));

        for (const agent of AGENT_DEFINITIONS) {
          const filePath = join(agentDir, `${agent.name}.md`);
          const fileExists = await exists(filePath);
          const status = fileExists ? chalk.green('✅') : chalk.red('❌');
          const name = agent.name.padEnd(30);
          const phase = String(agent.phase).padEnd(4);
          const phaseName = agent.phaseName.padEnd(28);
          console.log(`${name}${phase}${phaseName}${status}`);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`Error: ${msg}`));
        process.exit(1);
      }
    });

  // ─── agents scaffold ──────────────────────────────────
  agents
    .command('scaffold')
    .description('Scaffold agent instruction files from built-in templates')
    .option('-c, --config <path>', 'Path to cadre.config.json', 'cadre.config.json')
    .option('-f, --force', 'Overwrite existing files')
    .option('-a, --agent <name>', 'Scaffold only the named agent')
    .option('-b, --backend <name>', 'Adapt filenames for a specific backend (e.g. claude)')
    .action(
      async (opts: { config: string; force?: boolean; agent?: string; backend?: string }) => {
        try {
          const config = await loadConfig(opts.config);
          const agentDir = resolve(resolveAgentDir(config, opts.backend));
          const templateDir = getTemplateDir();

          const toScaffold = opts.agent
            ? AGENT_DEFINITIONS.filter((a) => a.name === opts.agent)
            : [...AGENT_DEFINITIONS];

          if (opts.agent && toScaffold.length === 0) {
            console.error(chalk.red(`Unknown agent: ${opts.agent}`));
            process.exit(1);
          }

          for (const agent of toScaffold) {
            const srcPath = join(templateDir, agent.templateFile);
            const destPath = join(agentDir, `${agent.name}.md`);

            if (!(await exists(srcPath))) {
              console.warn(chalk.yellow(`⚠ Template not found: ${srcPath}`));
              continue;
            }

            if (!opts.force && (await exists(destPath))) {
              console.log(chalk.gray(`  skip  ${destPath}`));
              continue;
            }

            const content = await readFile(srcPath, 'utf-8');
            await mkdir(dirname(destPath), { recursive: true });
            await writeFile(destPath, content, 'utf-8');
            const action = opts.force ? 'overwrite' : 'create ';
            console.log(chalk.green(`  ${action} ${destPath}`));
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(chalk.red(`Error: ${msg}`));
          process.exit(1);
        }
      },
    );

  // ─── agents validate ──────────────────────────────────
  agents
    .command('validate')
    .description('Validate that all agent instruction files exist and are non-empty')
    .option('-c, --config <path>', 'Path to cadre.config.json', 'cadre.config.json')
    .action(async (opts: { config: string }) => {
      try {
        const config = await loadConfig(opts.config);
        const agentDir = resolve(resolveAgentDir(config));
        const issues: string[] = [];

        for (const agent of AGENT_DEFINITIONS) {
          const filePath = join(agentDir, `${agent.name}.md`);
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
              `\nRun 'cadre agents scaffold' to create missing files from built-in templates.`,
            ),
          );
          process.exit(1);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`Error: ${msg}`));
        process.exit(1);
      }
    });
}
