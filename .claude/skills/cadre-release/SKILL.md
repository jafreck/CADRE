---
name: cadre-release
description: Publish a release of @cadre-dev/cadre and/or @cadre-dev/framework to npm. Use when the user asks to release, publish, bump version, or tag a new version of cadre or the framework package.
---

# Cadre Release Publishing

| Package | Version location | Trigger | Tag format |
|---------|-----------------|---------|------------|
| `@cadre-dev/cadre` | root `package.json` | GitHub Release via `publish.yml` | `v{VERSION}` |
| `@cadre-dev/framework` | `packages/framework/package.json` | Tag push via `publish-framework.yml` | `framework-v{VERSION}` |

## Release `@cadre-dev/cadre`

1. Bump version, create PR, merge:
   ```bash
   git checkout main && git pull && git checkout -b release/v{VERSION}
   # Update "version" in package.json and package-lock.json
   git add package.json package-lock.json
   git commit -m "chore: bump version to {VERSION}"
   git push -u origin release/v{VERSION}
   gh pr create --title "chore: release v{VERSION}" --body "Bump @cadre-dev/cadre to {VERSION}"
   # Wait for CI, then merge
   gh pr merge {PR_NUMBER} --squash
   ```

2. Verify version on main, then create GitHub Release:
   ```bash
   git checkout main && git pull
   git show HEAD:package.json | grep '"version"'  # Must show {VERSION}
   gh release create v{VERSION} --title "v{VERSION}" --generate-notes --target main
   ```

3. Monitor: `gh run list -L 3`

## Release `@cadre-dev/framework`

1. Bump version, create PR, merge:
   ```bash
   git checkout main && git pull && git checkout -b release/framework-v{VERSION}
   # Update "version" in packages/framework/package.json
   git add packages/framework/package.json
   git commit -m "chore: bump framework version to {VERSION}"
   git push -u origin release/framework-v{VERSION}
   gh pr create --title "chore: release framework v{VERSION}" --body "Bump @cadre-dev/framework to {VERSION}"
   gh pr merge {PR_NUMBER} --squash
   ```

2. Verify version on main, then tag:
   ```bash
   git checkout main && git pull
   git show HEAD:packages/framework/package.json | grep '"version"'  # Must show {VERSION}
   git tag framework-v{VERSION}
   git push origin framework-v{VERSION}
   ```

3. Monitor: `gh run list -L 3`

## Release both together

Combine version bumps into one PR. After merge:
```bash
git checkout main && git pull
git show HEAD:package.json | grep '"version"'
git show HEAD:packages/framework/package.json | grep '"version"'
# Both must match. Then:
git tag framework-v{VERSION} && git push origin framework-v{VERSION}
gh release create v{VERSION} --title "v{VERSION}" --generate-notes --target main
```

## Fixing a bad tag

```bash
git push origin :refs/tags/{TAG_NAME}
git tag -d {TAG_NAME}
# If there's a GitHub Release: gh release delete {TAG_NAME} --yes
# Fix version, commit, merge, pull, verify, re-tag
```
