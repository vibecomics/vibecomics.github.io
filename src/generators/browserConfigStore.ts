/** The image generator config in the browser: per-machine, so localStorage, not the project. Cached
 * and observable so components can react to it changing (see useGeneratorConfig).
 *
 * A config that names a workflow saved in ComfyUI keeps only that name in localStorage. The workflow
 * itself is fetched from the server once, when the page loads, and held in memory: until that
 * finishes (or if it fails) there's no usable config and `readGeneratorConfigProblem` says why. */
import { loadComfyWorkflow } from './comfyWorkflows';
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

const notify = () => listeners.forEach((listener) => listener());

let cached: GeneratorConfig | null = null;
let problem: string | null = null;
let loading = false;

/** Fetch the workflow a stored config names and make the full config available. */
function hydrate(stored: GeneratorConfig): void {
  const { baseUrl, workflowName } = stored.comfy;
  loading = true;
  loadComfyWorkflow(baseUrl, workflowName!)
    .then((workflow) => {
      // Ignore the result if the user saved a different config while this was loading.
      if (cached || parseStored()?.comfy.workflowName !== workflowName) return;
      cached = { ...stored, comfy: { ...stored.comfy, workflow } };
    })
    .catch((e: unknown) => {
      problem = `Couldn't load workflow "${workflowName}" from ComfyUI: ${e instanceof Error ? e.message : String(e)}`;
    })
    .finally(() => {
      loading = false;
      notify();
    });
}

const initial = parseStored();
if (initial?.comfy.workflowName && !initial.comfy.workflow) hydrate(initial);
else cached = initial;

/** The cached config: a stable reference until writeGeneratorConfig changes it. */
export function readGeneratorConfig(): GeneratorConfig | null {
  return cached;
}

/** Why a stored config isn't usable (its workflow is still loading, or couldn't be fetched), if so. */
export function readGeneratorConfigProblem(): string | null {
  return loading ? 'Loading the generator workflow from ComfyUI…' : problem;
}

export function writeGeneratorConfig(config: GeneratorConfig | null): void {
  try {
    if (!config) window.localStorage.removeItem(KEY);
    else if (config.comfy.workflowName) {
      const { workflow: _workflow, ...comfy } = config.comfy;
      window.localStorage.setItem(KEY, JSON.stringify({ ...config, comfy }));
    } else window.localStorage.setItem(KEY, JSON.stringify(config));
  } catch {
    // Private browsing or blocked site data: the config just won't persist across reloads.
  }
  cached = config;
  problem = null;
  notify();
}

/** Calls `listener` whenever the config or its load status changes. Returns an unsubscribe function. */
export function subscribeGeneratorConfig(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
