import { join, resolve, isAbsolute } from 'node:path';
import { Command } from 'commander';
import chalk from 'chalk';
import { AGENT_DEFINITIONS } from '../agents/definitions.js';
import { loadConfig } from '../config/loader.js';
import { exists, writeTextFile, readFileOrNull } from '../util/fs.js';

function defaultTemplate(agentName: string): string {
  return `# ${agentName}

You are the ${agentName} agent in the CADRE (Coordinated Agent Development Runtime Engine) system.

## Role

<!-- Describe the agent's role and responsibilities here -->

## Instructions

<!-- Provide detailed instructions for this agent -->

## Output Format

<!-- Describe the expected output format -->
`;
}

function resolveAgentDir(agentDir: string, repoPath: string): string {
  if (isAbsolute(agentDir)) return agentDir;
  return resolve(repoPath, agentDir);
}

export function registerAgentsCommand(program: Command): void {
  const agents = program
    .command('agents')
    .description('Manage CADRE agent template files');

  // ─── list ───────────────────────────────────────────
  agents
    .command('list')
    .description('List all agents and their template file status')
    .option('-c, --config <path>', 'Path to cadre.config.json', 'cadre.config.json')
    .action(async (opts) => {
      try {
        const config = await loadConfig(opts.config);
        const agentDir = resolveAgentDir(config.copilot.agentDir, config.repoPath);

        const rows = await Promise.all(
          AGENT_DEFINITIONS.map(async (def) => {
            const filePath = join(agentDir, def.templateFile);
            const fileExists = await exists(filePath);
            return { def, fileExists };
          }),
        );

        for (const { def, fileExists } of rows) {
          const indicator = fileExists ? chalk.green('✓') : chalk.red('✗');
          console.log(
            `${indicator}  ${def.name.padEnd(24)} phase ${def.phase}  ${def.phaseName}`,
          );
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`Error: ${msg}`));
        process.exit(1);
      }
    });

  // ─── scaffold ────────────────────────────────────────
  agents
    .command('scaffold')
    .description('Write default template files for missing agents')
    .option('-c, --config <path>', 'Path to cadre.config.json', 'cadre.config.json')
    .option('-f, --force', 'Overwrite existing template files')
    .option('-a, --agent <name>', 'Scaffold only this agent')
    .option('--backend <backend>', 'Backend to use (accepted, no-op for non-claude backends)')
    .action(async (opts) => {
      try {
        const config = await loadConfig(opts.config);
        const agentDir = resolveAgentDir(config.copilot.agentDir, config.repoPath);

        let targets = [...AGENT_DEFINITIONS];
        if (opts.agent) {
          targets = targets.filter((d) => d.name === opts.agent);
          if (targets.length === 0) {
            console.error(chalk.red(`Unknown agent: ${opts.agent}`));
            process.exit(1);
          }
        }

        for (const def of targets) {
          const filePath = join(agentDir, def.templateFile);
          const fileExists = await exists(filePath);

          if (fileExists && !opts.force) {
            console.log(chalk.yellow(`skip  ${def.templateFile} (already exists)`));
            continue;
          }

          const content = defaultTemplate(def.name);
          await writeTextFile(filePath, content);
          const action = fileExists ? 'overwrite' : 'create';
          console.log(chalk.green(`${action}  ${def.templateFile}`));
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`Error: ${msg}`));
        process.exit(1);
      }
    });

  // ─── validate ────────────────────────────────────────
  agents
    .command('validate')
    .description('Validate that all agent template files exist and are non-empty')
    .option('-c, --config <path>', 'Path to cadre.config.json', 'cadre.config.json')
    .action(async (opts) => {
      try {
        const config = await loadConfig(opts.config);
        const agentDir = resolveAgentDir(config.copilot.agentDir, config.repoPath);

        const problems: string[] = [];

        for (const def of AGENT_DEFINITIONS) {
          const filePath = join(agentDir, def.templateFile);
          const content = await readFileOrNull(filePath);
          if (content === null) {
            problems.push(`  missing: ${def.templateFile}`);
          } else if (content.trim().length === 0) {
            problems.push(`  empty:   ${def.templateFile}`);
          }
        }

        if (problems.length === 0) {
          console.log(chalk.green(`✓ All ${AGENT_DEFINITIONS.length} agent templates are valid`));
          process.exit(0);
        } else {
          console.error(chalk.red(`✗ ${problems.length} agent template(s) have issues:`));
          for (const p of problems) {
            console.error(chalk.red(p));
          }
          process.exit(1);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`Error: ${msg}`));
        process.exit(1);
      }
    });
}
