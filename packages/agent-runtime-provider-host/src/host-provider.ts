import { randomUUID } from 'node:crypto';
import type { IsolationProvider, IsolationCapabilities, IsolationPolicy } from '@cadre/agent-runtime';
import { HostSession } from './host-session.js';

export class HostProvider implements IsolationProvider {
  readonly name = 'host';

  capabilities(): IsolationCapabilities {
    return {
      mounts: false,
      networkModes: ['full'],
      envAllowlist: false,
      secrets: false,
      resources: false,
    };
  }

  async createSession(_policy: IsolationPolicy): Promise<HostSession> {
    return new HostSession(randomUUID());
  }
}
