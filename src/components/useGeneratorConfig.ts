import { useSyncExternalStore } from 'react';
import {
  readGeneratorConfig,
  readGeneratorConfigProblem,
  subscribeGeneratorConfig,
} from '../generators/browserConfigStore';

/** The image generator config, re-rendering when GeneratorSettings saves a new one. */
export function useGeneratorConfig() {
  return useSyncExternalStore(subscribeGeneratorConfig, readGeneratorConfig);
}

/** Why the saved generator config can't be used yet (its workflow is loading or failed to load). */
export function useGeneratorConfigProblem() {
  return useSyncExternalStore(subscribeGeneratorConfig, readGeneratorConfigProblem);
}
