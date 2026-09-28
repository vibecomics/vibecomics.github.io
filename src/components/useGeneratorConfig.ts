import { useSyncExternalStore } from 'react';
import { readGeneratorConfig, subscribeGeneratorConfig } from '../generators/browserConfigStore';

/** The image generator config, re-rendering when GeneratorSettings saves a new one. */
export function useGeneratorConfig() {
  return useSyncExternalStore(subscribeGeneratorConfig, readGeneratorConfig);
}
