import { useState } from 'react';

/**
 * Tracks whether some async work (a network call) is in progress, so its button can show a spinner
 * and stay disabled until the call settles. Errors are passed on to the caller unchanged.
 */
export function useBusy() {
  const [busy, setBusy] = useState(false);

  async function run<T>(task: () => Promise<T>): Promise<T> {
    setBusy(true);
    try {
      return await task();
    } finally {
      setBusy(false);
    }
  }

  return { busy, run };
}
