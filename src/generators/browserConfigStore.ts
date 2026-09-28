/** The image generator config in the browser: per-machine, so localStorage, not the project. Cached
 * and observable so components can react to it changing (see useGeneratorConfig). */
import type { GeneratorConfig } from './types';

const KEY = 'vibecomics.generatorConfig';
const listeners = new Set<() => void>();

function parseStored(): GeneratorConfig | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as GeneratorConfig) : null;
  } catch {
    return null;
  }
}

let cached = parseStored();

/** The cached config: a stable reference until writeGeneratorConfig changes it. */
export function readGeneratorConfig(): GeneratorConfig | null {
  return cached;
}

export function writeGeneratorConfig(config: GeneratorConfig | null): void {
  try {
    if (config) window.localStorage.setItem(KEY, JSON.stringify(config));
    else window.localStorage.removeItem(KEY);
  } catch {
    // Private browsing or blocked site data: the config just won't persist across reloads.
  }
  cached = config;
  listeners.forEach((listener) => listener());
}

/** Calls `listener` whenever writeGeneratorConfig changes the config. Returns an unsubscribe function. */
export function subscribeGeneratorConfig(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
