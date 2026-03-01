export interface MountSpec {
  path: string;
  readOnly: boolean;
}

export interface UlimitSpec {
  type: string;
  soft: number;
  hard: number;
}

export interface ResourceLimits {
  cpuShares?: number;
  memoryMb?: number;
  pidsLimit?: number;
  ulimits?: UlimitSpec[];
  timeoutMs?: number;
}

export interface SecretBinding {
  name: string;
  value: string;
}

export type NetworkMode = 'none' | 'allowlist' | 'full';

export interface IsolationPolicy {
  mounts?: MountSpec[];
  networkMode?: NetworkMode;
  envAllowlist?: string[];
  secrets?: SecretBinding[];
  resources?: ResourceLimits;
}

export interface IsolationCapabilities {
  mounts: boolean;
  networkModes: NetworkMode[];
  envAllowlist: boolean;
  secrets: boolean;
  resources: boolean;
}

export interface ExecOptions {
  env?: Record<string, string>;
  cwd?: string;
  timeoutMs?: number;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}

export interface IsolationSession {
  sessionId: string;
  exec(command: string, args: string[], options?: ExecOptions): Promise<ExecResult>;
  destroy(): Promise<void>;
}

export interface IsolationProvider {
  name: string;
  capabilities(): IsolationCapabilities;
  createSession(policy: IsolationPolicy): Promise<IsolationSession>;
}
