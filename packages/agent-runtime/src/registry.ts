import type { IsolationProvider } from './types.js';

/** Lazy provider factory — called only when the provider is first resolved. */
export type ProviderFactory = () => IsolationProvider;

export class ProviderRegistry {
  private readonly providers = new Map<string, IsolationProvider>();
  private readonly factories = new Map<string, ProviderFactory>();

  /** Register a ready-to-use provider instance. */
  register(provider: IsolationProvider): void {
    this.providers.set(provider.name, provider);
  }

  /** Register a lazy factory that creates a provider on first resolve. */
  registerFactory(name: string, factory: ProviderFactory): void {
    this.factories.set(name, factory);
  }

  /** Check if a provider is registered (either directly or via factory). */
  has(name: string): boolean {
    return this.providers.has(name) || this.factories.has(name);
  }

  /** Return all registered provider names. */
  list(): string[] {
    return [...new Set([...this.providers.keys(), ...this.factories.keys()])];
  }

  /** Remove a provider by name. */
  unregister(name: string): void {
    this.providers.delete(name);
    this.factories.delete(name);
  }

  /**
   * Resolves the active provider using precedence: CLI override > config > default ('host').
   * Lazy factories are instantiated on first resolve.
   */
  resolve(cliOverride?: string, configProvider?: string): IsolationProvider {
    const name = cliOverride ?? configProvider ?? 'host';

    // Try direct registration first
    let provider = this.providers.get(name);
    if (provider) return provider;

    // Try lazy factory
    const factory = this.factories.get(name);
    if (factory) {
      provider = factory();
      this.providers.set(name, provider);
      this.factories.delete(name);
      return provider;
    }

    throw new Error(
      `Unknown isolation provider "${name}". Registered providers: ${this.list().join(', ') || '(none)'}.`
    );
  }
}
