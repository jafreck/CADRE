# Cadre Architecture

**Cadre** (Coordinated Agent Development Runtime Engine) is a multi-phase, AI-agent pipeline that autonomously resolves GitHub/ADO issues by coordinating a fleet of specialized agents across a structured 5-phase workflow.

---

## 1. High-Level Component Architecture

```mermaid
graph TD
    CLI["CLI<br/>(index.ts · agents.ts · init.ts)"]

    subgraph Config
        CL["ConfigLoader"]
        Schema["CadreConfig Schema (Zod)"]
    end

    subgraph Runtime ["Core Runtime"]
        CR["CadreRuntime"]
        FO["FleetOrchestrator"]
        IO["IssueOrchestrator"]
        RRO["ReviewResponseOrchestrator"]
        PR["PhaseRegistry"]
        FCM["FleetCheckpointManager"]
        CM["CheckpointManager"]
        PRG["PhaseGates (x5)"]
    end

    subgraph Executors ["Phase Executors (1-5)"]
        APE["AnalysisPhaseExecutor (1)"]
        PPE["PlanningPhaseExecutor (2)"]
        IPE["ImplementationPhaseExecutor (3)"]
        IVE["IntegrationPhaseExecutor (4)"]
        PCE["PRCompositionPhaseExecutor (5)"]
    end

    subgraph Agents ["Agent Layer"]
        AB["AgentBackend (interface)"]
        CB["ClaudeBackend"]
        CPB["CopilotBackend"]
        AL["AgentLauncher"]
        CTX["ContextBuilder"]
        RP["ResultParser"]
        SQ["SessionQueue"]
    end

    subgraph Platform
        PP["PlatformProvider (interface)"]
        GHP["GitHubProvider"]
        ADOP["AzureDevOpsProvider"]
    end

    subgraph Git
        WM["WorktreeManager"]
        BC["Branch / Commit / PR helpers"]
    end

    subgraph Support
        CE["CostEstimator"]
        LOG["Logger"]
        NM["NotificationManager"]
        RW["ReportWriter"]
        FPW["FleetProgressWriter"]
    end

    CLI --> CL
    CLI --> CR
    CR --> FO
    CR --> RRO
    CR --> WM
    CR --> PP

    FO --> IO
    FO --> FCM
    IO --> PR
    IO --> CM
    IO --> PRG
    PR --> APE & PPE & IPE & IVE & PCE

    APE & PPE & IPE & IVE & PCE --> AL
    AL --> AB
    AB --> CB & CPB
    AL --> CTX & RP
    IPE --> SQ

    PP --> GHP & ADOP
    WM --> BC

    IO --> CE & LOG
    CR --> NM & RW & FPW
```

---

## 2. Per-Issue Pipeline Sequence

The standard pipeline runs all 5 phases sequentially. `--respond-to-reviews` re-runs phases 3–5 after resetting their checkpoint state.

```mermaid
sequenceDiagram
    participant U as User / CLI
    participant RT as CadreRuntime
    participant FO as FleetOrchestrator
    participant IO as IssueOrchestrator
    participant CM as CheckpointManager
    participant WM as WorktreeManager
    participant PG as PhaseGate
    participant EX as PhaseExecutor (1-5)
    participant AL as AgentLauncher
    participant PP as PlatformProvider

    U->>RT: cadre run --issue N
    RT->>PP: loadConfig + listIssues
    RT->>WM: createWorktree(issue)
    RT->>FO: run()
    FO->>IO: new IssueOrchestrator(issue)
    IO->>CM: load() / startPhase(1)

    loop Phase 1 – Analysis & Scouting
        IO->>EX: execute(PhaseContext)
        EX->>AL: launchAgent(issue-analyst)
        AL-->>EX: AgentResult
        EX->>AL: launchAgent(codebase-scout)
        AL-->>EX: AgentResult
        EX-->>IO: PhaseResult
        IO->>CM: completePhase(1, output)
    end

    IO->>PG: AnalysisToPlanningGate.validate()
    PG-->>IO: pass / warn / fail

    loop Phase 2 – Planning
        IO->>EX: execute(PhaseContext)
        EX->>AL: launchAgent(implementation-planner)
        AL-->>EX: AgentSession[] (cadre-json)
        EX-->>IO: PhaseResult
        IO->>CM: completePhase(2, output)
    end

    IO->>PG: PlanningToImplementationGate.validate()
    PG-->>IO: pass

    loop Phase 3 – Implementation (per session)
        IO->>EX: execute()
        EX->>AL: launchAgent(code-writer)
        AL-->>EX: result
        EX->>AL: launchAgent(test-writer)
        EX->>AL: launchAgent(code-reviewer)
        opt review issues found
            EX->>AL: launchAgent(fix-surgeon)
        end
        EX->>AL: launchAgent(whole-pr-reviewer)
        EX-->>IO: PhaseResult
        IO->>CM: completePhase(3, output)
    end

    IO->>PG: ImplementationToIntegrationGate.validate()

    loop Phase 4 – Integration Verification
        IO->>EX: execute()
        EX->>AL: launchAgent(integration-checker)
        EX-->>IO: PhaseResult
        IO->>CM: completePhase(4)
    end

    IO->>PG: IntegrationToPRGate.validate()

    loop Phase 5 – PR Composition
        IO->>EX: execute()
        EX->>AL: launchAgent(pr-composer)
        EX->>PP: createPullRequest()
        EX-->>IO: PhaseResult
        IO->>CM: completePhase(5)
    end

    IO-->>FO: IssueResult
    FO-->>RT: FleetResult
    RT->>U: Report + notifications
```

---

## 3. Agent Assignment by Phase

```mermaid
graph LR
    subgraph P1["Phase 1 · Analysis & Scouting"]
        A1["issue-analyst<br/><i>Requirements extraction,<br/>change classification,<br/>scope estimate</i>"]
        A2["codebase-scout<br/><i>File discovery,<br/>dependency mapping</i>"]
    end

    subgraph P2["Phase 2 · Planning"]
        A3["implementation-planner<br/><i>Emits AgentSession[] via<br/>cadre-json block</i>"]
        A3a["adjudicator<br/><i>(ambiguity resolution)</i>"]
    end

    subgraph P3["Phase 3 · Implementation (loops per session)"]
        A4["code-writer<br/><i>Write/edit source files</i>"]
        A5["test-writer<br/><i>Write/edit tests</i>"]
        A6["code-reviewer<br/><i>Review diff</i>"]
        A7["fix-surgeon<br/><i>Targeted fixes</i>"]
        A8["whole-pr-reviewer<br/><i>Full PR review<br/>(post-session)</i>"]
    end

    subgraph P4["Phase 4 · Integration Verification"]
        A9["integration-checker<br/><i>Build / test / lint</i>"]
        A10["fix-surgeon<br/><i>(remediation)</i>"]
    end

    subgraph P5["Phase 5 · PR Composition"]
        A11["pr-composer<br/><i>Title, body, labels</i>"]
    end

    A6 -- "issues found" --> A7
    A8 -- "issues found" --> A7
    A9 -- "failures found" --> A10

    style P1 fill:#e8f4e8,stroke:#4caf50
    style P2 fill:#e8f0fb,stroke:#5c85d6
    style P3 fill:#fff3e0,stroke:#ff9800
    style P4 fill:#fce4ec,stroke:#e91e63
    style P5 fill:#e0f7fa,stroke:#00bcd4
```

---

## 4. Core Class Relationships

```mermaid
classDiagram
    class CadreRuntime {
        -config RuntimeConfig
        -provider PlatformProvider
        -worktreeManager WorktreeManager
        +run() FleetResult
        +runReviewResponse() FleetResult
    }

    class FleetOrchestrator {
        -issues IssueDetail[]
        -checkpoint FleetCheckpointManager
        +run() FleetResult
        +runReviewResponse() FleetResult
        -processIssue(issue) IssueResult
    }

    class IssueOrchestrator {
        -issue IssueDetail
        -registry PhaseRegistry
        -checkpoint CheckpointManager
        -budget CostEstimator
        +run() IssueResult
        -executePhase(executor) PhaseResult
        -runGate(phaseId) pass|warn|fail
        -commitPhase(phase) void
    }

    class ReviewResponseOrchestrator {
        +REVIEW_RESPONSE_PHASES: number[]
        +run(issueNumbers?) ReviewResponseResult
    }

    class CheckpointManager {
        -statePath string
        +load(issueNumber) CheckpointState
        +startPhase(id) void
        +completePhase(id, output) void
        +startTask / completeTask / failTask()
        +resetPhases(ids) void
        +recordTokenUsage()
        +recordGateResult()
    }

    class FleetCheckpointManager {
        +load() FleetCheckpointState
        +setIssueStatus(number, status) void
        +recordTokenUsage(issue, tokens) void
    }

    class PhaseRegistry {
        -executors PhaseExecutor[]
        +register(executor) void
        +getAll() PhaseExecutor[]
    }

    class PhaseExecutor {
        <<interface>>
        +phaseId number
        +execute(ctx PhaseContext) PhaseResult
    }

    class AgentLauncher {
        -backend AgentBackend
        +init() void
        +launchAgent(invocation, worktreePath) AgentResult
        +validateAgentFiles(dir) string[]
    }

    class AgentBackend {
        <<interface>>
        +launch(invocation, worktreePath) AgentResult
    }

    class ClaudeBackend {
        +launch(invocation, worktreePath) AgentResult
    }

    class CopilotBackend {
        +launch(invocation, worktreePath) AgentResult
    }

    class PlatformProvider {
        <<interface>>
        +listIssues(params) IssueDetail[]
        +createPullRequest(params) PullRequestInfo
        +getPRReviews(number) PRReview[]
        +applyLabels(number, labels) void
    }

    class SessionQueue {
        -sessions AgentSession[]
        +next() AgentSession|null
        +complete(sessionId) void
        +fail(sessionId, err) void
        +isFinished() boolean
    }

    class CostEstimator {
        -budget number
        +record(tokens) void
        +isExceeded() boolean
        +estimate() CostEstimate
    }

    CadreRuntime --> FleetOrchestrator
    CadreRuntime --> ReviewResponseOrchestrator
    CadreRuntime --> PlatformProvider
    FleetOrchestrator --> IssueOrchestrator
    FleetOrchestrator --> FleetCheckpointManager
    IssueOrchestrator --> PhaseRegistry
    IssueOrchestrator --> CheckpointManager
    IssueOrchestrator --> CostEstimator
    PhaseRegistry --> PhaseExecutor
    PhaseExecutor <|.. AnalysisPhaseExecutor
    PhaseExecutor <|.. PlanningPhaseExecutor
    PhaseExecutor <|.. ImplementationPhaseExecutor
    PhaseExecutor <|.. IntegrationPhaseExecutor
    PhaseExecutor <|.. PRCompositionPhaseExecutor
    ImplementationPhaseExecutor --> SessionQueue
    AgentLauncher --> AgentBackend
    AgentBackend <|.. ClaudeBackend
    AgentBackend <|.. CopilotBackend
    PlatformProvider <|.. GitHubProvider
    PlatformProvider <|.. AzureDevOpsProvider
```

---

## 5. Artifact / Data Flow Through the Pipeline

Each phase produces structured JSON or Markdown artifacts consumed by the next gate and phase. The checkpoint tracks all of this durably.

```mermaid
flowchart LR
    ISSUE[("GitHub / ADO\nIssue #N")]

    subgraph Phase1["Phase 1 · Analysis"]
        P1A["issue-analyst"]
        P1B["codebase-scout"]
        P1O[/"analysis-report.json\nscout-report.json"/]
    end

    subgraph G12["Gate 1→2\nAmbiguity check"]
        GR12{"pass?"}
    end

    subgraph Phase2["Phase 2 · Planning"]
        P2["implementation-planner"]
        P2O[/"implementation-plan.md\n(cadre-json sessions[])"/]
    end

    subgraph G23["Gate 2→3\nSession schema check"]
        GR23{"pass?"}
    end

    subgraph Phase3["Phase 3 · Implementation (×sessions)"]
        P3A["code-writer"]
        P3B["test-writer"]
        P3C["code-reviewer"]
        P3D["fix-surgeon"]
        P3E["whole-pr-reviewer"]
        P3O[/"source diff\ntest files\nreview-result.json"/]
    end

    subgraph G34["Gate 3→4\nDiff present check"]
        GR34{"pass?"}
    end

    subgraph Phase4["Phase 4 · Integration"]
        P4["integration-checker"]
        P4O[/"integration-report.json"/]
    end

    subgraph G45["Gate 4→5\nIntegration clean"]
        GR45{"pass?"}
    end

    subgraph Phase5["Phase 5 · PR Composition"]
        P5["pr-composer"]
        P5O[/"pr-content.json\nPull Request (platform)"/]
    end

    subgraph CP["Checkpoint (per phase)"]
        CPS[("checkpoint.json\n- completedPhases\n- completedTasks\n- tokenUsage\n- gateResults")]
    end

    ISSUE --> P1A & P1B --> P1O
    P1O --> GR12
    GR12 -- pass --> P2 --> P2O
    GR12 -- "fail → ambiguity comment" --> ISSUE

    P2O --> GR23
    GR23 -- pass --> P3A --> P3B --> P3C
    P3C -- issues --> P3D
    P3D --> P3C
    P3C -- clean --> P3E
    P3E -- issues --> P3D
    P3E --> P3O

    P3O --> GR34
    GR34 -- pass --> P4 --> P4O

    P4O --> GR45
    GR45 -- pass --> P5 --> P5O

    P1O & P2O & P3O & P4O & P5O --> CPS
```

---

## 6. Checkpoint / Pipeline State Machine

`CheckpointManager` persists state to disk after every transition, enabling safe resume (`--resume`) and review-response rewind (`resetPhases([3,4,5])`).

```mermaid
stateDiagram-v2
    [*] --> idle : load checkpoint

    state "Phase N" as PhN {
        [*] --> phaseStarted : startPhase(N)

        state "Task Loop" as TL {
            [*] --> taskPending
            taskPending --> taskRunning   : startTask(id)
            taskRunning  --> taskComplete : completeTask(id)
            taskRunning  --> taskFailed   : failTask(id, err)
            taskFailed   --> taskRunning  : retry (attempts < max)
            taskFailed   --> taskBlocked  : attempts ≥ max → blockTask(id)
            taskComplete --> taskPending  : next task
            taskBlocked  --> [*]          : skip session
            taskComplete --> [*]          : all tasks done
        }

        phaseStarted --> TL
        TL --> gateValidation : PhaseResult emitted
        gateValidation --> phaseComplete : gate pass / warn
        gateValidation --> phaseFailed   : gate fail (critical)
        phaseComplete --> [*]
        phaseFailed   --> [*]
    }

    idle --> PhN         : phase not in completedPhases
    idle --> PhN_done    : phase in completedPhases (skip)
    PhN_done --> idle    : advance to next phase
    PhN --> idle         : advance

    state "Review-Response" as RR {
        [*] --> resetPhases : resetPhases([3,4,5])
        resetPhases --> PhN : re-run phases 3-5
    }

    idle --> RR          : --respond-to-reviews
```

---

## 7. Runtime Filesystem Layout

```mermaid
graph TD
    ROOT["~/.cadre/&lt;repo&gt;/"]

    ROOT --> WT["worktrees/"]
    ROOT --> AG["agents/   (templates)"]

    WT --> WTN["issue-&lt;N&gt;/   (git worktree)"]

    WTN --> GHA[".github/agents/\n*.agent.md"]
    WTN --> CADRE[".cadre/issues/&lt;N&gt;/"]

    CADRE --> CP["checkpoint.json\n  completedPhases[]\n  completedTasks[]\n  tokenUsage{}\n  gateResults{}"]
    CADRE --> AR["analysis-report.json"]
    CADRE --> SR["scout-report.json"]
    CADRE --> IP["implementation-plan.md"]
    CADRE --> IR["integration-report.json"]
    CADRE --> PRC["pr-content.json"]
    CADRE --> CTX["contexts/\n  &lt;agent&gt;-&lt;timestamp&gt;.json"]

    ROOT --> FCP["fleet-checkpoint.json\n  issueStatuses{}\n  tokenUsage{}\n  startedAt / completedAt"]
    ROOT --> FRP["fleet-report.json"]
    ROOT --> FP["fleet-progress.json"]

    style ROOT fill:#f5f5f5,stroke:#888
    style WT fill:#e8f4e8,stroke:#4caf50
    style CADRE fill:#fff3e0,stroke:#ff9800
    style AG fill:#e8f0fb,stroke:#5c85d6
```

---

## 8. Manifest-Driven Pipeline Configuration

`PHASE_MANIFEST` in `src/core/phase-registry.ts` is the **single source of truth** for all pipeline phase metadata. Rather than scattering phase registrations, gate assignments, and review-response membership across multiple files, every piece of per-phase configuration lives in one typed array entry.

### `PhaseManifestEntry` Fields

| Field | Type | Purpose |
|-------|------|---------|
| `phaseId` | `number` | 1-based phase number (execution order) |
| `name` | `string` | Human-readable phase label |
| `executorFactory` | `() => PhaseExecutor` | Factory that instantiates the phase executor |
| `gate` | `PhaseGate \| null` | Post-phase gate for output validation; `null` for the final phase |
| `critical` | `boolean` | If `true`, a gate failure aborts the issue pipeline |
| `commitType` | `string?` | Conventional-commit type for the per-phase git commit |
| `commitMessage` | `string?` | Commit message template; `{issueNumber}` is interpolated |
| `includeInReviewResponse` | `boolean` | Whether this phase runs in the `--respond-to-reviews` pipeline |

### Derived Constructs

All downstream constructs are computed from `PHASE_MANIFEST` at module load time — no imperative setup code is needed at call sites:

- **`buildRegistry()`** — iterates `PHASE_MANIFEST` in order, calls each `executorFactory()`, and appends the result to a new `PhaseRegistry`. `IssueOrchestrator` calls this once during construction instead of five individual `registry.register()` calls.

- **`buildGateMap()`** — iterates `PHASE_MANIFEST` and collects entries where `gate !== null` into a `Record<number, PhaseGate>` keyed by `phaseId`. `IssueOrchestrator` uses this map to look up the correct gate after each phase completes.

- **`REVIEW_RESPONSE_PHASES`** — a derived `readonly number[]` computed by filtering `PHASE_MANIFEST` on `includeInReviewResponse === true` and mapping to `phaseId`. `ReviewResponseOrchestrator` imports this constant directly instead of maintaining a separate, duplicated list.

```mermaid
flowchart TD
    M["PHASE_MANIFEST\n(PhaseManifestEntry[])"]

    M -->|"buildRegistry()"| R["PhaseRegistry\n(executors in order)"]
    M -->|"buildGateMap()"| G["Record&lt;number, PhaseGate&gt;"]
    M -->|"filter includeInReviewResponse"| RRP["REVIEW_RESPONSE_PHASES\nnumber[]"]

    R --> IO["IssueOrchestrator"]
    G --> IO
    RRP --> RRO["ReviewResponseOrchestrator"]
```

Adding a new phase requires only a single new object in `PHASE_MANIFEST`; all derived constructs update automatically.

---

## 9. IssueOrchestrator Service Decomposition

`IssueOrchestrator` is a **thin coordinator**: it constructs the four services below, wires their dependencies, and delegates to them. It contains no business logic of its own.

### Extracted Services

| Service | File | Responsibility |
|---------|------|---------------|
| `PhaseRunner` | `src/core/phase-runner.ts` | Single-phase execution and the gate-retry loop (execute → runGate → optional retry → abort on second failure) |
| `GateCoordinator` | `src/core/gate-coordinator.ts` | Gate validation, ambiguity gate merging for phase 1, gate-result recording on the checkpoint |
| `IssueBudgetGuard` | `src/core/issue-budget-guard.ts` | Per-issue token recording, budget-exceeded detection, and one-shot budget-warning notification dispatch |
| `IssueLifecycleNotifier` | `src/core/issue-lifecycle-notifier.ts` | Issue-started, phase-completed, issue-failed, and issue-completed notification events |

### Dependency Relationships

```mermaid
graph TD
    IO["IssueOrchestrator\n(thin coordinator)"]

    PR["PhaseRunner"]
    GC["GateCoordinator"]
    IBG["IssueBudgetGuard"]
    ILN["IssueLifecycleNotifier"]

    CM["CheckpointManager"]
    TT["TokenTracker"]
    NM["NotificationManager"]
    PW["IssueProgressWriter"]
    LOG["Logger"]

    IO --> PR
    IO --> GC
    IO --> IBG
    IO --> ILN

    PR --> GC
    PR --> CM
    PR --> PW
    PR --> TT
    PR --> LOG

    GC --> CM
    GC --> PW
    GC --> LOG

    IBG --> TT
    IBG --> NM
    IBG --> CM

    ILN --> NM
```

`PhaseRunner` holds a reference to `GateCoordinator` so that gate validation and the retry decision remain encapsulated away from the orchestrator loop. `IssueBudgetGuard` owns budget state (`_budgetExceeded`, `budgetWarningSent`) so that `IssueOrchestrator` never inspects raw token counts directly.

---

## Key Design Principles

| Principle | Implementation |
|-----------|---------------|
| **Resumability** | `CheckpointManager` persists every phase/task transition to disk; reruns skip completed phases |
| **Pluggable backends** | `AgentBackend` interface — swap Claude ↔ Copilot via config |
| **Pluggable platforms** | `PlatformProvider` interface — GitHub and Azure DevOps implementations |
| **Gate-driven quality** | Dedicated `PhaseGate` validates each phase's output before advancing |
| **Fleet parallelism** | `FleetOrchestrator` runs multiple issues concurrently up to `maxParallelIssues` |
| **Isolated worktrees** | Each issue gets its own `git worktree` — no cross-issue file conflicts |
| **Two-level planning** | Planner emits `AgentSession[]` (sessions → steps); `SessionQueue` drives phase 3 iteration |
| **Budget enforcement** | `CostEstimator` tracks token usage and raises `BudgetExceededError` when the configured limit is hit |
