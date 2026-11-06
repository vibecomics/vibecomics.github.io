/** The image service config in the browser: per-machine, so localStorage, not the project. Cached
 * and observable so components can react to it changing (see useGeneratorConfig). */
import type { GeneratorConfig } from './types';

const KEY = 'vibecomics.generatorConfig';
const listeners = new Set<() => void>();

function parseStored(): GeneratorConfig | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as GeneratorConfig) : null;
    // A config saved by an older version (a ComfyUI workflow mapping) is no longer usable.
    return parsed?.provider === 'service' ? parsed : null;
  } catch {
    return null;
  }
}

const notify = () => listeners.forEach((listener) => listener());

let cached: GeneratorConfig | null = parseStored();

/** The cached config: a stable reference until writeGeneratorConfig changes it. */
export function readGeneratorConfig(): GeneratorConfig | null {
  return cached;
}

/** Kept for the hooks that report why a stored config isn't usable; there is nothing to load now. */
export function readGeneratorConfigProblem(): string | null {
  return null;
}

export function writeGeneratorConfig(config: GeneratorConfig | null): void {
  try {
    if (!config) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, JSON.stringify(config));
  } catch {
    // Private browsing or blocked site data: the config just won't persist across reloads.
  }
  cached = config;
  notify();
}

/** Calls `listener` whenever the config changes. Returns an unsubscribe function. */
export function subscribeGeneratorConfig(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
