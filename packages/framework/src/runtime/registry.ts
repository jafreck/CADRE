import type {
  IsolationCapabilities,
  IsolationProvider,
  IsolationProviderHealthCheckResult,
} from './types.js';

/** Lazy provider factory — called only when the provider is first resolved. */
export type ProviderFactory = () => IsolationProvider;

export interface ProviderRegistration {
  name: string;
  provider?: IsolationProvider;
  factory?: ProviderFactory;
}

export interface ProviderDescriptor {
  name: string;
  registeredAs: 'instance' | 'factory';
  capabilities?: IsolationCapabilities;
}

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

  /** Ergonomic registration helper for instance/factory records. */
  registerProvider(registration: ProviderRegistration): void {
    if (registration.provider) {
      this.providers.set(registration.name, registration.provider);
      return;
    }
    if (registration.factory) {
      this.factories.set(registration.name, registration.factory);
      return;
    }
    throw new Error(`Provider registration "${registration.name}" must include either a provider or factory.`);
  }

  /** Batch register provider instances and/or factories. */
  registerProviders(registrations: readonly ProviderRegistration[]): void {
    for (const registration of registrations) {
      this.registerProvider(registration);
    }
  }

  /** Check if a provider is registered (either directly or via factory). */
  has(name: string): boolean {
    return this.providers.has(name) || this.factories.has(name);
  }

  /** Return all registered provider names. */
  list(): string[] {
    return [...new Set([...this.providers.keys(), ...this.factories.keys()])];
  }

  /** Return descriptor objects for discovery and diagnostics. */
  describe(): ProviderDescriptor[] {
    const names = this.list();
    return names
      .map((name) => {
        const provider = this.providers.get(name);
        return {
          name,
          registeredAs: provider ? 'instance' : 'factory',
          capabilities: provider?.capabilities(),
        } as ProviderDescriptor;
      })
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  /** Remove a provider by name. */
  unregister(name: string): void {
    this.providers.delete(name);
    this.factories.delete(name);
  }

  clear(): void {
    this.providers.clear();
    this.factories.clear();
  }

  /** Returns capabilities for a provider if already registered/resolvable. */
  getCapabilities(name: string): IsolationCapabilities | undefined {
    if (!this.has(name)) {
      return undefined;
    }
    const provider = this.resolve(name);
    return provider.capabilities();
  }

  /** Runs optional provider health checks. Providers without a hook are treated as healthy. */
  async healthCheck(name: string): Promise<IsolationProviderHealthCheckResult> {
    const provider = this.resolve(name);
    if (!provider.healthCheck) {
      return { healthy: true, message: `Provider "${name}" does not define healthCheck()` };
    }
    return provider.healthCheck();
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
