# Running Cadre in a Container

This guide explains how to build and run Cadre inside a Docker container, including volume configuration, authentication, resource limits, and the security model.

---

## Prerequisites

- **Docker** (v20.10+) — [Install Docker](https://docs.docker.com/get-docker/)
- **Docker Compose** (v2+) — included with Docker Desktop, or install separately via [Compose CLI plugin](https://docs.docker.com/compose/install/)
- A `cadre.config.json` configured for your project (see [Config Schema](./config-schema.md))
- A valid `GITHUB_TOKEN` (or Azure DevOps PAT) with repo access

---

## Building the Image

Build the Cadre container image using Docker Compose:

```bash
docker compose build
```

This runs a multi-stage build defined in the repository's `Dockerfile`:

1. **Build stage** — installs all dependencies and compiles TypeScript (`npm ci && npm run build`)
2. **Runtime stage** — starts from `node:20-slim` and installs only the runtime system packages (`git`, `openssh-client`, `ca-certificates`, `curl`) and production npm dependencies

---

## Volume Mounts

The `docker-compose.yml` defines three volume mounts that map host paths into the container:

| Host Path | Container Path | Purpose |
|-----------|---------------|---------|
| `./` (your repo) | `/workspace` | The target repository Cadre operates on |
| `./cadre.config.json` | `/config/cadre.config.json` (read-only) | Cadre configuration file |
| `cadre-state` (named volume) | `/state` | Persistent state: logs, checkpoints, worktrees |

The repo mount is a bind mount of the current directory. The state volume is a Docker named volume (`cadre-state`) that persists across container restarts.

### Customising volume mounts

To point at a different repository or config file, override the volumes in `docker-compose.yml`:

```yaml
volumes:
  - /path/to/your/repo:/workspace
  - /path/to/your/cadre.config.json:/config/cadre.config.json:ro
  - cadre-state:/state
```

---

## Configuration for Container Paths

Inside the container, paths differ from the host. Your `cadre.config.json` must use container-internal paths for `repoPath` and `stateDir`. Here is an example:

```json
{
  "projectName": "my-project",
  "platform": "github",
  "repository": "owner/repo",
  "repoPath": "/workspace",
  "stateDir": "/state",
  "baseBranch": "main",
  "issues": {
    "query": {
      "labels": ["cadre"],
      "state": "open",
      "limit": 5
    }
  },
  "commands": {
    "install": "npm install",
    "build": "npm run build",
    "test": "npm test"
  },
  "isolation": {
    "enabled": false,
    "provider": "host"
  }
}
```

Key path overrides for container use:

| Field | Container Value | Description |
|-------|----------------|-------------|
| `repoPath` | `/workspace` | Maps to the bind-mounted repository |
| `stateDir` | `/state` | Maps to the named state volume |
| `worktreeRoot` | *(optional)* | Defaults to `{stateDir}/worktrees/`; override only if needed |

---

## GITHUB_TOKEN Setup

Cadre requires a `GITHUB_TOKEN` environment variable to authenticate with GitHub. Pass it to the container via the `environment` section in `docker-compose.yml`:

```yaml
environment:
  - GITHUB_TOKEN=${GITHUB_TOKEN}
```

Set the token on the host before running:

```bash
# Option 1: Export directly
export GITHUB_TOKEN=ghp_your_token_here

# Option 2: Use gh CLI
export GITHUB_TOKEN=$(gh auth token)

# Then start cadre
docker compose up
```

Alternatively, create a `.env` file in the same directory as `docker-compose.yml`:

```env
GITHUB_TOKEN=ghp_your_token_here
```

> **Note:** Never commit `.env` files or tokens to source control.

---

## Security Model: Isolation Providers

### Default: `isolation.provider: "host"`

By default, Cadre uses the **host** isolation provider inside the container. This means agent processes run as direct child processes of the Cadre Node.js process — within the container boundary, but without any additional sandboxing layer.

This is the recommended default for container deployments because the Docker container itself provides filesystem and process isolation from the host machine. Agents can only access:

- The mounted repository at `/workspace`
- The state directory at `/state`
- The config file at `/config/cadre.config.json`
- Network access (as permitted by Docker networking)

See [Security Model](./security.md) for full details on isolation providers and policy profiles.

### Optional: Docker Socket Passthrough (Docker-in-Docker)

For advanced users who want Cadre to use `isolation.provider: "docker"` — where each agent session runs in its own nested Docker container — you must pass through the Docker socket from the host.

Uncomment the Docker socket volume in `docker-compose.yml`:

```yaml
volumes:
  - ./:/workspace
  - ./cadre.config.json:/config/cadre.config.json:ro
  - cadre-state:/state
  - /var/run/docker.sock:/var/run/docker.sock  # Enable Docker-in-Docker
```

Then update your `cadre.config.json` to use the Docker provider:

```json
{
  "isolation": {
    "enabled": true,
    "provider": "docker",
    "policyProfile": "default"
  }
}
```

> **⚠️ Security Warning:** Mounting the Docker socket gives the container full control over the host's Docker daemon. This is equivalent to root access on the host. Only use this in trusted environments (e.g., dedicated CI runners). See [Security Model § HostProvider](./security.md) and [Security Model § DockerProvider](./security.md) for threat model details.

---

## Resource Limits

The `docker-compose.yml` includes default resource limits to prevent runaway containers:

```yaml
deploy:
  resources:
    limits:
      memory: 4G
      cpus: '2.0'
```

| Resource | Default | Description |
|----------|---------|-------------|
| `memory` | `4G` | Maximum memory the container can use |
| `cpus` | `2.0` | Maximum CPU cores allocated |

### Customising resource limits

Edit the `deploy.resources.limits` section in `docker-compose.yml` to match your workload:

```yaml
deploy:
  resources:
    limits:
      memory: 8G    # Increase for large repos or many parallel agents
      cpus: '4.0'   # Increase for parallel issue processing
```

You can also set resource reservations (minimum guaranteed resources):

```yaml
deploy:
  resources:
    limits:
      memory: 8G
      cpus: '4.0'
    reservations:
      memory: 2G
      cpus: '1.0'
```

---

## Running Cadre

Start the container:

```bash
docker compose up
```

The entrypoint automatically runs:

```
node dist/index.js run -c /config/cadre.config.json
```

To run with a detached container:

```bash
docker compose up -d
docker compose logs -f cadre
```

To stop:

```bash
docker compose down
```

To rebuild after code changes:

```bash
docker compose build && docker compose up
```
