import { join } from 'node:path';
import chalk from 'chalk';
import { confirm } from '@inquirer/prompts';
import { CadreConfigSchema } from '../config/schema.js';
import { collectAnswers } from './prompts.js';
import { atomicWriteJSON, atomicWriteFile, exists, ensureDir, readFileOrNull } from '../util/fs.js';
import { scaffoldMissingAgents } from './agents.js';

export async function runInit(opts: { yes: boolean; repoPath?: string }): Promise<void> {
  const repoPath = opts.repoPath ?? process.cwd();

  // 1. Verify .git directory exists
  if (!(await exists(join(repoPath, '.git')))) {
    console.error(
      chalk.red(
        `Error: No .git directory found at "${repoPath}". Please run cadre init from the root of a git repository.`,
      ),
    );
    process.exit(1);
  }

  // 2. Check for existing cadre.config.json
  const configPath = join(repoPath, 'cadre.config.json');
  if (await exists(configPath)) {
    if (!opts.yes) {
      const overwrite = await confirm({
        message: 'cadre.config.json already exists. Overwrite?',
        default: false,
      });
      if (!overwrite) {
        console.log(chalk.yellow('Aborted.'));
        return;
      }
    } else {
      console.log(chalk.yellow('Overwriting existing cadre.config.json...'));
    }
  }

  // 3. Collect prompt answers (--yes skips non-essential prompts)
  const answers = await collectAnswers(opts.yes, opts.repoPath);

  // 4. Assemble CadreConfig
  const issuesConfig =
    answers.issueMode.mode === 'ids'
      ? { ids: [] }
      : { query: { state: answers.issueMode.state, limit: answers.issueMode.limit } };

  let githubConfig: { auth?: { token: string } | { appId: string; installationId: string; privateKeyFile: string } } | undefined;
  if (answers.platform === 'github') {
    if (answers.githubAuth) {
      githubConfig =
        answers.githubAuth.method === 'token'
          ? { auth: { token: answers.githubAuth.token } }
          : {
              auth: {
                appId: answers.githubAuth.appId,
                installationId: answers.githubAuth.installationId,
                privateKeyFile: answers.githubAuth.privateKeyFile,
              },
            };
    } else {
      // --yes mode: default to GITHUB_TOKEN
      githubConfig = { auth: { token: '${GITHUB_TOKEN}' } };
    }
  }

  const rawConfig = {
    projectName: answers.projectName,
    platform: answers.platform,
    repository: answers.repository,
    repoPath: answers.repoPath,
    baseBranch: answers.baseBranch,
    issues: issuesConfig,
    commands: answers.commands,
    ...(githubConfig !== undefined ? { github: githubConfig } : {}),
  };

  // 5. Validate
  const config = CadreConfigSchema.parse(rawConfig);

  // 6. Write cadre.config.json atomically
  await atomicWriteJSON(configPath, config);

  // 7. Append .cadre/ to .gitignore exactly once
  const gitignorePath = join(repoPath, '.gitignore');
  const gitignoreContent = (await readFileOrNull(gitignorePath)) ?? '';
  const alreadyIgnored = gitignoreContent.split('\n').some((line) => line.trim() === '.cadre/');
  if (!alreadyIgnored) {
    const separator = gitignoreContent && !gitignoreContent.endsWith('\n') ? '\n' : '';
    await atomicWriteFile(gitignorePath, `${gitignoreContent}${separator}.cadre/\n`);
  }

  // 8. Create .github/agents/ directory and scaffold missing agent files
  const agentDir = join(repoPath, '.github', 'agents');
  await ensureDir(agentDir);
  const scaffolded = await scaffoldMissingAgents(agentDir);

  // 9. Print success summary
  console.log('');
  if (scaffolded > 0) {
    console.log(chalk.blue(`ℹ️  Auto-scaffolded ${scaffolded} missing agent file(s)`));
    console.log('');
  }
  console.log(chalk.green('✓ cadre initialized successfully!'));
  console.log('');
  console.log(`  ${chalk.bold('Project:')}  ${config.projectName}`);
  console.log(`  ${chalk.bold('Platform:')} ${config.platform}`);
  console.log(`  ${chalk.bold('Repo:')}     ${config.repository}`);
  console.log(`  ${chalk.bold('Branch:')}   ${config.baseBranch}`);
  console.log('');
  console.log(`  ${chalk.dim('cadre.config.json')} written`);
  if (!alreadyIgnored) {
    console.log(`  ${chalk.dim('.gitignore')} updated (added .cadre/)`);
  }
  console.log(`  ${chalk.dim('.github/agents/')} created`);
  console.log('');
}
