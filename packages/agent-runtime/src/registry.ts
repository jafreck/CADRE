import type { IsolationProvider } from './types.js';

export class ProviderRegistry {
  private readonly providers = new Map<string, IsolationProvider>();

  register(provider: IsolationProvider): void {
    this.providers.set(provider.name, provider);
  }

  /**
   * Resolves the active provider using precedence: CLI override > config > default ('host').
   */
  resolve(cliOverride?: string, configProvider?: string): IsolationProvider {
    const name = cliOverride ?? configProvider ?? 'host';
    const provider = this.providers.get(name);
    if (!provider) {
      throw new Error(
        `Unknown isolation provider "${name}". Registered providers: ${[...this.providers.keys()].join(', ') || '(none)'}.`
      );
    }
    return provider;
  }
}
