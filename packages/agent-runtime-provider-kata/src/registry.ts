import { KataProvider } from "./kata-provider.js";
import type { KataAdapter } from "./kata-provider.js";

/**
 * Factory function for creating a KataProvider.
 * Accepts an optional custom KataAdapter for testing or alternative runtimes.
 */
export function createKataProvider(adapter?: KataAdapter): KataProvider {
  return new KataProvider(adapter);
}
