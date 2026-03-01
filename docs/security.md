# Cadre Security Model

This document describes the isolation architecture introduced in Cadre's provider-based execution model, including threat model assumptions, the default `IsolationPolicy`, provider capabilities, known residual risks, and migration guidance for existing users.

---

## 1. Threat Model Assumptions

Cadre runs AI-generated code in agent sessions. The isolation model is designed to limit the blast radius of a misbehaving or compromised agent. The following assumptions inform the threat model.

### 1.1 HostProvider

- **No sandbox boundary.** Agent processes run directly on the host OS as the same user that started Cadre. Any code executed by the agent has full access to the user's filesystem, environment, and network.
- **Trusted agents only.** HostProvider is suitable when the agent commands are fully trusted and the host environment is not considered a security boundary (e.g., a developer's local machine, a dedicated CI runner with no sensitive lateral access).
- **No resource limits enforced.** CPU, memory, process count, and network access are unrestricted beyond what the OS enforces by default.

### 1.2 DockerProvider

- **Container boundary.** Each agent session runs inside a dedicated Docker container that is created at session start and destroyed at session end.
- **Filesystem isolation.** Only explicitly declared mounts (via `IsolationPolicy.mounts`) and the worktree mount (`/workspace`) are accessible inside the container. The rest of the host filesystem is not visible.
- **Network isolation.** The network mode is controlled by `IsolationPolicy.networkMode`. Setting it to `none` prevents all outbound and inbound network access. `allowlist` and `full` modes both use a bridge network (see §4.3 for residual risks).
- **Environment variable isolation.** Only environment variables explicitly listed in `IsolationPolicy.envAllowlist` are forwarded into the container. All other host variables are withheld.
- **Resource limits.** CPU shares, memory, PID count, ulimits, and execution timeouts are enforced via Docker's resource-limiting flags when specified in `IsolationPolicy.resources`.
- **Secret handling.** Secret bindings (`IsolationPolicy.secrets`) are currently injected as environment variables inside the container. They are not written to disk. Secrets are not logged.

---

## 2. Default `IsolationPolicy` Profile (`'default'`)

When `isolation.policyProfile` is set to `'default'` (or omitted), the following effective policy is applied:

| Attribute | Default Value |
|-----------|--------------|
| `mounts` | `[]` (no extra mounts; worktree is mounted at `/workspace` by DockerProvider) |
| `networkMode` | `'full'` |
| `envAllowlist` | `[]` (no host env vars forwarded unless explicitly listed) |
| `secrets` | `[]` (no secret bindings) |
| `resources.cpuShares` | unset (unlimited) |
| `resources.memoryMb` | unset (unlimited) |
| `resources.pidsLimit` | unset (unlimited) |
| `resources.ulimits` | `[]` |
| `resources.timeoutMs` | unset (no timeout) |

> **Note:** The `'default'` profile is intentionally permissive on network and resource limits so that it works out of the box. For hardened deployments, define a stricter profile in `cadre.config.json` and set `isolation.policyProfile` to point to it.

---

## 3. Provider Capability Matrix

The table below lists which `IsolationPolicy` attributes are enforced by each provider. Attempting to use an unsupported attribute with a provider that cannot enforce it will raise a capability negotiation error (unless `allowFallbackToHost` is set to `true`, in which case the mismatch is logged and execution falls back to HostProvider).

| Policy Attribute | HostProvider | DockerProvider |
|-----------------|:------------:|:--------------:|
| `mounts` | ❌ | ✅ |
| `networkMode: 'none'` | ❌ | ✅ |
| `networkMode: 'allowlist'` | ❌ | ⚠️ (bridge; see §4.3) |
| `networkMode: 'full'` | ✅ (implicit) | ✅ |
| `envAllowlist` | ❌ | ✅ |
| `secrets` | ❌ | ❌ (planned) |
| `resources` (CPU/memory/pids/ulimits/timeout) | ❌ | ✅ |

**Legend:**
- ✅ Fully supported and enforced
- ❌ Not supported; capability negotiation fails if policy requires this attribute
- ⚠️ Partially supported; see noted caveat

---

## 4. Known Residual Risks

### 4.1 HostProvider Has No Isolation

When using `HostProvider`, the agent process inherits the full host environment. There is **no filesystem, network, or resource isolation**. Any code the agent executes can read or write any file the Cadre process can access, make arbitrary network connections, and consume unlimited resources.

**Mitigation:** Use `DockerProvider` for any scenario where agent-generated code should not be trusted unconditionally.

### 4.2 Docker on macOS Uses a Linux VM

On macOS, Docker runs containers inside a lightweight Linux VM (e.g., Docker Desktop or Lima). This means:

- The "host" filesystem paths visible inside the container are paths within the VM, not the macOS host filesystem directly.
- Volume mounts (`-v`) still work correctly because Docker translates macOS paths into VM paths, but the mount boundary is the VM, not the macOS kernel.
- An escaped container on macOS would land in the VM, not directly on the macOS host. However, the VM shares access to the mounted directories, so worktree contents remain accessible from the VM.
- Resource limits (CPU, memory) are enforced against the VM's allocation, not the full macOS host resources.

**Mitigation:** Be aware that container escape on macOS leads to VM access, not direct macOS host access. Still treat container escape as a security incident.

### 4.3 `networkMode: 'allowlist'` Is Not a True Allowlist

The `'allowlist'` network mode is currently implemented as a bridge network (`--network bridge`), which provides outbound internet access to any destination. **True egress filtering (e.g., iptables rules, network policies) is not yet implemented.**

**Mitigation:** Use `networkMode: 'none'` if outbound network access must be completely blocked. Treat `'allowlist'` as equivalent to `'full'` until fine-grained egress filtering is implemented.

### 4.4 Host Network Access When HostProvider Is Active

Even if `isolation.enabled: true` is set in config, if `isolation.provider` is `'host'` or if `allowFallbackToHost: true` triggers a fallback, agents run on the host network with unrestricted access.

**Mitigation:** Set `allowFallbackToHost: false` (the default) and ensure `provider` is set to `'docker'` for hardened deployments.

### 4.5 Secrets Injected as Environment Variables

Secret bindings are currently passed into containers as environment variables via `-e KEY=VALUE` flags on `docker run`. Environment variables are visible to all processes inside the container, may be captured in process listings, and can leak through subprocess execution.

**Mitigation:** Use secrets with a narrow scope and short lifetime. Avoid injecting long-lived credentials as secrets. Future versions will support volume-mounted secret files with tighter access control.

### 4.6 Capability Negotiation Failure-Mode

If a required policy attribute is unsupported by the configured provider, Cadre raises an error and aborts the session. It does **not** silently downgrade or skip the constraint. This is intentional: silent downgrade would create a false sense of security.

The only exception is `allowFallbackToHost: true`, which must be explicitly set by the operator. When set, a capability mismatch is logged at `warn` level and execution proceeds on the host provider.

---

## 5. Configuration Reference

Add an `isolation` block to `cadre.config.json` to control the isolation model:

```jsonc
{
  "isolation": {
    // Enable the isolation provider. Default: false (HostProvider, no isolation).
    "enabled": true,

    // Which provider to use: "host" | "docker". Default: "host".
    "provider": "docker",

    // Named policy profile to apply. Default: "default".
    "policyProfile": "default",

    // Allow fallback to HostProvider if the configured provider fails capability
    // negotiation. Setting this to true weakens isolation guarantees.
    // Default: false.
    "allowFallbackToHost": false,

    // Docker-specific options (required when provider is "docker").
    "dockerOptions": {
      // Docker image to use for agent sessions (required).
      "image": "node:20-slim",
      // Extra arguments appended to `docker run` (optional).
      "extraArgs": []
    }
  }
}
```

**Provider resolution precedence:** CLI override (`--provider <name>`) > `isolation.provider` in config > default (`'host'`).

---

## 6. Migration Notes for Existing Users

### 6.1 What Changes When Isolation Is Enabled

Before the isolation provider model was introduced, Cadre spawned agent processes directly on the host using `spawnProcess` from `@cadre/command-diagnostics`. This behavior is now encapsulated in **HostProvider**, which is the default when `isolation.enabled` is `false` or when no `isolation` block is present.

**No behavior change is required for existing users.** If you do not add an `isolation` block to `cadre.config.json`, Cadre continues to spawn agents on the host exactly as before.

### 6.2 Opting Into Isolation

To opt into containerized execution:

1. Add `"isolation": { "enabled": true, "provider": "docker", "dockerOptions": { "image": "your-image" } }` to `cadre.config.json`.
2. Ensure Docker is installed and running on the machine where Cadre executes.
3. Verify that your agent image contains the tools the agents need (e.g., `git`, `node`, language runtimes, CLI tools).
4. Review the environment variables your agents require and add them to a custom policy profile's `envAllowlist`.

### 6.3 Upgrading from Direct-Spawn to Provider-Based Execution

If you have automation or scripts that previously relied on the direct-spawn behavior (e.g., passing raw environment variables, relying on host filesystem paths), note:

- With DockerProvider, agent processes run inside a container. Host filesystem paths are not available unless explicitly mounted via `IsolationPolicy.mounts`.
- Host environment variables are not forwarded unless listed in `envAllowlist`.
- Network access inside the container depends on `networkMode`. If your agents make outbound HTTP calls (e.g., to fetch dependencies), ensure `networkMode` is set to `'full'` or `'allowlist'`.

### 6.4 Rolling Back

To revert to direct host execution at any time, set `"isolation": { "enabled": false }` in `cadre.config.json` or remove the `isolation` block entirely. The HostProvider is always registered and available as the fallback.
