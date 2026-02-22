import { join } from 'node:path';
import { confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import { CadreConfigSchema } from '../config/schema.js';
import {
  atomicWriteJSON,
  ensureDir,
  exists,
  readFileOrNull,
  writeTextFile,
} from '../util/fs.js';
import { runPrompts } from './prompts.js';

export async function runInit(opts: { yes: boolean; repoPath?: string }): Promise<void> {
  const cwd = opts.repoPath ?? process.cwd();

  // Validate git repo
  if (!(await exists(join(cwd, '.git')))) {
    throw new Error(
      `Not a git repository: ${cwd}. Run cadre init from a git repo or use --repo-path.`,
    );
  }

  // Check for existing config
  const configPath = join(cwd, 'cadre.config.json');
  if (await exists(configPath)) {
    if (opts.yes) {
      console.log(chalk.yellow('Overwriting existing cadre.config.json'));
    } else {
      const overwrite = await confirm({
        message: chalk.yellow('cadre.config.json already exists. Overwrite?'),
        default: false,
      });
      if (!overwrite) {
        console.log(chalk.gray('Aborted.'));
        return;
      }
    }
  }

  // Gather answers via prompts
  const answers = await runPrompts({ yes: opts.yes });

  // Assemble and validate config
  const rawConfig = {
    projectName: answers.projectName,
    platform: answers.platform,
    repository: answers.repository,
    repoPath: answers.repoPath,
    baseBranch: answers.baseBranch,
    issues:
      answers.issueMode === 'ids'
        ? { ids: [] as number[] }
        : { query: { state: 'open' as const, limit: 10 } },
    commands: answers.commands,
  };

  const config = CadreConfigSchema.parse(rawConfig);

  // Write cadre.config.json
  await atomicWriteJSON(configPath, config);
  console.log(chalk.green(`✔ Wrote ${configPath}`));

  // Append .cadre/ to .gitignore
  const gitignorePath = join(cwd, '.gitignore');
  const existing = await readFileOrNull(gitignorePath);
  const entry = '.cadre/';
  if (existing === null || !existing.split('\n').some((l) => l.trim() === entry)) {
    const updated = existing === null ? `${entry}\n` : `${existing.endsWith('\n') ? existing : existing + '\n'}${entry}\n`;
    await writeTextFile(gitignorePath, updated);
    console.log(chalk.green(`✔ Appended ${entry} to .gitignore`));
  }

  // Create .github/agents/ directory
  const agentsDir = join(cwd, '.github', 'agents');
  await ensureDir(agentsDir);
  console.log(chalk.green(`✔ Created ${agentsDir}`));

  console.log(chalk.bold.green('\nCADRE initialized successfully!'));
}
