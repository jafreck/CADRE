import { ProviderRegistry } from '@cadre/agent-runtime';
import { HostProvider } from '@cadre/agent-runtime-provider-host';
import { DockerProvider } from '@cadre/agent-runtime-provider-docker';
import { KataProvider } from '@cadre/agent-runtime-provider-kata';

export interface ProviderLoaderOptions {
  /** Docker image to use for Docker provider sessions. */
  dockerImage?: string;
  /** Worktree path to mount in Docker sessions. */
  worktreePath?: string;
}

/**
 * Creates a ProviderRegistry pre-loaded with all built-in providers.
 *
 * - `host` is always registered eagerly (zero-config).
 * - `docker` and `kata` are registered as lazy factories since they may
 *   require configuration or external dependencies.
 */
export function createProviderRegistry(options: ProviderLoaderOptions = {}): ProviderRegistry {
  const registry = new ProviderRegistry();

  // Host provider is always available (no config needed)
  registry.register(new HostProvider());

  // Docker provider — lazy, requires image config
  registry.registerFactory('docker', () => {
    if (!options.dockerImage) {
      throw new Error(
        'Docker provider requires a "dockerImage" configuration. ' +
        'Set isolation.dockerImage in cadre.config.json.',
      );
    }
    return new DockerProvider({
      image: options.dockerImage,
      worktreePath: options.worktreePath,
    });
  });

  // Kata provider — lazy
  registry.registerFactory('kata', () => new KataProvider());

  return registry;
}
