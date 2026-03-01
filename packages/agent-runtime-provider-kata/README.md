# @cadre/agent-runtime-provider-kata

Kata Containers isolation provider for cadre agent runtimes.

`KataProvider` implements the `IsolationProvider` contract, running each agent session inside a lightweight VM-backed Kata Containers sandbox. Use it when you need hardware-level workload isolation (separate kernel + VM boundary) beyond what Linux namespace-based containers offer.

---

## When to use KataProvider

- You need **hardware virtualisation isolation** (each session runs in its own micro-VM).
- Your threat model requires **kernel-level isolation** between sessions.
- You operate on infrastructure where Kata Containers is already deployed (e.g., bare-metal Kubernetes nodes with the Kata runtime class configured).

If you only need container-level isolation, use the Docker provider instead.

---

## Host prerequisites

| Requirement | Details |
|---|---|
| **Kata runtime binary** | `kata-runtime` (or `containerd-shim-kata-v2`) must be installed and on `PATH`. Install via [kata-containers releases](https://github.com/kata-containers/kata-containers/releases) or your distro package manager. |
| **Compatible Linux kernel** | Kernel ≥ 5.10 recommended. The host kernel must support KVM (`/dev/kvm` accessible to the process). |
| **Hardware virtualisation** | Intel VT-x or AMD-V must be enabled in BIOS/UEFI and exposed to the host (bare-metal or nested-virt with KVM passthrough). |
| **containerd** | containerd ≥ 1.6 with the Kata runtime class registered (`io.containerd.kata.v2`). |

> **macOS / Windows hosts:** Kata Containers is not supported on non-Linux hosts. The provider will fall back to `StubKataAdapter` (no-op) during testing.

---

## Supported IsolationPolicy fields

| Field | Type | Description |
|---|---|---|
| `memory` | `number` | Memory limit in bytes passed to the VM. |
| `cpu` | `number` | CPU quota (cores or millicores) passed to the VM. |
| `networkIsolation` | `boolean` | Enforce network isolation inside the sandbox. |
| `readOnlyRootfs` | `boolean` | Mount the container root filesystem as read-only. |

### Unsupported fields → CapabilityMismatchError

Any `IsolationPolicy` field **not listed above** (including arbitrary extra fields) will cause `KataProvider` to throw a `CapabilityMismatchError` immediately during `startSession`. There is **no silent downgrade** — the error message names each unsupported field so the caller can act on it.

```ts
import { CapabilityMismatchError } from "@cadre/agent-runtime-provider-kata";

try {
  await provider.startSession({ memory: 512_000_000, seccomp: "strict" });
} catch (err) {
  if (err instanceof CapabilityMismatchError) {
    console.error("Unsupported fields:", err.unsupportedPolicies); // ["seccomp"]
  }
}
```

---

## Installation

```sh
npm install @cadre/agent-runtime-provider-kata
```

---

## Usage

### Basic (stub adapter — no Kata runtime required)

```ts
import { KataProvider } from "@cadre/agent-runtime-provider-kata";

const provider = new KataProvider(); // uses StubKataAdapter by default

const sessionId = await provider.startSession({
  memory: 512_000_000,      // 512 MB
  cpu: 1,
  networkIsolation: true,
  readOnlyRootfs: false,
});

const result = await provider.exec(sessionId, ["echo", "hello"]);
console.log(result.stdout); // "hello"

await provider.stopSession(sessionId);
await provider.destroySession(sessionId);
```

### With a real Kata adapter

Implement the `KataAdapter` interface and pass it to the constructor:

```ts
import { KataProvider, type KataAdapter, type KataSessionConfig } from "@cadre/agent-runtime-provider-kata";

class MyKataAdapter implements KataAdapter {
  async createSandbox(id: string, cfg: KataSessionConfig) { /* ... */ }
  async execInSandbox(id: string, cmd: string[]) { return { exitCode: 0, stdout: "", stderr: "" }; }
  async stopSandbox(id: string) { /* ... */ }
  async destroySandbox(id: string) { /* ... */ }
}

const provider = new KataProvider(new MyKataAdapter());
```

### Config-driven wiring (cadre.config.json)

```json
{
  "isolation": {
    "provider": "kata",
    "kata": {
      "runtimePath": "/usr/local/bin/kata-runtime"
    }
  }
}
```

See [`docs/config-schema.md`](../../docs/config-schema.md) for the full isolation config reference.

---

## Known limitations

- **Linux only.** Kata Containers requires `/dev/kvm`; macOS and Windows are not supported.
- **No nested-virt by default.** Cloud VMs typically require explicit nested virtualisation enablement; check your cloud provider docs.
- **Stub adapter is a no-op.** The bundled `StubKataAdapter` performs no actual isolation — use it for unit tests only.
- **IsolationProvider contract is provisional.** The interface in `src/types.ts` is a local placeholder until the shared contract from issue #271 lands. Expect a breaking change when the upstream package is available.
