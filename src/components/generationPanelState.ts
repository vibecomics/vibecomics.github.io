import { useSyncExternalStore } from 'react';

// Module-level (not React state) because the toggle button lives in the navbar while the panel
// itself is rendered as a flex sibling of the tab content, in EditorScreen — two separate parts of
// the tree that need the same open/closed flag without threading it through everything between them.
let open = false;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

export function setGenerationPanelOpen(value: boolean): void {
  if (open === value) return;
  open = value;
  notify();
}

export function toggleGenerationPanel(): void {
  setGenerationPanelOpen(!open);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useGenerationPanelOpen(): boolean {
  return useSyncExternalStore(subscribe, () => open);
}
