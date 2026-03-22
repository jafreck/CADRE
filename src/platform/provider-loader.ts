import { ProviderRegistry } from '@cadre-dev/framework/runtime';
import { HostProvider } from '@cadre-dev/framework/runtime';
import { DockerProvider } from '@cadre-dev/runtime-provider-docker';
import { KataProvider, NerdctlKataAdapter, DockerKataAdapter } from '@cadre-dev/runtime-provider-kata';

export interface ProviderLoaderOptions {
  /** Docker image to use for Docker provider sessions. */
  dockerImage?: string;
  /** Worktree path to mount in Docker sessions. */
  worktreePath?: string;
  /** Kata-specific options. */
  kata?: {
    /** CLI backend: 'nerdctl' or 'docker'. */
    backend?: 'nerdctl' | 'docker';
    /** Container image for Kata sessions. */
    image?: string;
  };
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

  // Kata provider — lazy, backend selects CLI (nerdctl vs docker)
  registry.registerFactory('kata', () => {
    const image = options.kata?.image ?? 'alpine:3';
    const adapter = options.kata?.backend === 'docker'
      ? new DockerKataAdapter({ image })
      : new NerdctlKataAdapter({ image });
    return new KataProvider(adapter);
  });

  return registry;
}
