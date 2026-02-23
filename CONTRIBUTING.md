# Contributing to CADRE

Thank you for your interest in contributing!

## Setting Up the `NPM_TOKEN` Secret

This repository uses [semantic-release](https://github.com/semantic-release/semantic-release) to automate versioning and publishing to NPM. For automated publishing to work, a GitHub Actions secret named `NPM_TOKEN` must be configured.

### Creating an NPM Automation Token

1. Log in to [npmjs.com](https://www.npmjs.com).
2. Click your avatar in the top-right corner and choose **Access Tokens**.
3. Click **Generate New Token** → **Granular Access Token** (or **Classic Token** → **Automation**).
4. Give the token a descriptive name (e.g., `cadre-github-actions`).
5. Select the **Automation** token type (bypasses 2FA for CI environments).
6. Click **Generate Token** and copy the value immediately — it won't be shown again.

### Adding the Token to GitHub

1. Navigate to your fork or the repository on GitHub.
2. Go to **Settings** → **Secrets and variables** → **Actions**.
3. Click **New repository secret**.
4. Set **Name** to `NPM_TOKEN` and paste the token value into **Secret**.
5. Click **Add secret**.

The `release.yml` workflow will automatically use this secret when publishing a new release.

## Commit Message Format (Conventional Commits)

`semantic-release` determines the next version number and generates the changelog from commit messages. Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

| Prefix | Meaning | Version bump |
|---|---|---|
| `fix: <description>` | Bug fix | Patch (`1.0.0` → `1.0.1`) |
| `feat: <description>` | New feature | Minor (`1.0.0` → `1.1.0`) |
| `feat!: <description>` or any commit with `BREAKING CHANGE:` in the footer | Breaking change | Major (`1.0.0` → `2.0.0`) |

### Examples

```
fix: handle undefined input in parseConfig
feat: add support for custom agent timeouts
feat!: rename CLI entry point from cadre-run to cadre

BREAKING CHANGE: the `cadre-run` binary has been removed; use `cadre` instead.
```

Commits that don't match any of the above prefixes (e.g., `chore:`, `docs:`, `test:`, `refactor:`) will not trigger a release on their own.
