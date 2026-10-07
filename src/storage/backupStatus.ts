/**
 * Live status of the one manual backup that can be running at a time, for BackupButton to show a
 * percentage and a details popup without threading progress through props. Same shape as the
 * generation queue (ai/generation.ts): a module-level store, written from App.tsx's backupTo dep as
 * the copy runs, read via useSyncExternalStore so the button re-renders on every tick.
 */
import type { BackupSummary } from './backup';

export interface BackupStatus {
  /** The destination connection's label, for the popup title. */
  label: string;
  state: 'running' | 'done' | 'error';
  done: number;
  total: number;
  /** Set once state is 'done'. */
  summary?: BackupSummary;
  /** Set once state is 'error'. */
  error?: string;
}

let status: BackupStatus | null = null;
const listeners = new Set<() => void>();

export function getBackupStatus(): BackupStatus | null {
  return status;
}

export function subscribeBackupStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setBackupStatus(next: BackupStatus | null): void {
  status = next;
  listeners.forEach((listener) => listener());
}
