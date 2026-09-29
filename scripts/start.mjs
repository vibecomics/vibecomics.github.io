/**
 * `npm start`: the storage server and the dev server together, in one terminal. Ctrl-C (or either
 * one exiting) stops both.
 */
import { spawn } from 'node:child_process';

const scripts = ['http-storage', 'dev'];
const children = scripts.map((name) =>
  spawn('npm', ['run', name], { stdio: 'inherit', detached: true })
);

let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  // Each runs in its own process group, so the signal reaches what npm started too.
  for (const child of children) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      // already gone
    }
  }
  process.exitCode = code;
}

for (const child of children) child.on('exit', (code) => stop(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop(0));
