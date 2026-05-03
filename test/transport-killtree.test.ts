import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { spawnCli } from '../src/transport/spawn.js';

const isWindows = process.platform === 'win32';

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

describe.skipIf(isWindows)('detached spawn + tree-kill', () => {
  it('reaps grandchildren when parent is interrupted', async () => {
    // Parent shell that backgrounds a long sleep grandchild and prints its PID.
    const dir = join(tmpdir(), `hca-tk-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const script = join(dir, 'parent.sh');
    writeFileSync(
      script,
      `#!/bin/sh
sleep 30 &
echo "GRANDCHILD_PID=$!"
wait
`,
      { mode: 0o755 },
    );

    const cli = spawnCli({ bin: 'sh', args: [script] });
    let grandchildPid: number | undefined;
    const reader = (async () => {
      for await (const line of cli.lines) {
        const m = /GRANDCHILD_PID=(\d+)/.exec(line);
        if (m) {
          grandchildPid = Number(m[1]);
          break;
        }
      }
    })();
    await reader;

    expect(grandchildPid).toBeDefined();
    expect(pidAlive(grandchildPid!)).toBe(true);

    cli.kill();
    await cli.done.catch(() => undefined);

    // Give the OS a moment to reap.
    await new Promise((r) => setTimeout(r, 500));
    expect(pidAlive(grandchildPid!)).toBe(false);
  }, 10_000);
});
