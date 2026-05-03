import { describe, expect, it } from 'vitest';
import { spawnCli, composeEnv, shutdownSpawnedClis } from '../src/transport/spawn.js';
import { chunkedToLines, mergeStdoutStderr } from '../src/transport/lines.js';
import { Readable } from 'node:stream';

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of iter) out.push(v);
  return out;
}

describe('chunkedToLines', () => {
  it('splits a single chunk into lines', async () => {
    const stream = Readable.from([Buffer.from('a\nb\nc\n', 'utf-8')]);
    expect(await collect(chunkedToLines(stream))).toEqual(['a', 'b', 'c']);
  });

  it('handles chunk boundaries mid-line', async () => {
    const stream = Readable.from([
      Buffer.from('he', 'utf-8'),
      Buffer.from('llo\nwor', 'utf-8'),
      Buffer.from('ld\n', 'utf-8'),
    ]);
    expect(await collect(chunkedToLines(stream))).toEqual(['hello', 'world']);
  });

  it('yields a trailing unterminated line', async () => {
    const stream = Readable.from([Buffer.from('a\nb', 'utf-8')]);
    expect(await collect(chunkedToLines(stream))).toEqual(['a', 'b']);
  });

  it('strips \\r in CRLF line endings', async () => {
    const stream = Readable.from([Buffer.from('a\r\nb\r\n', 'utf-8')]);
    expect(await collect(chunkedToLines(stream))).toEqual(['a', 'b']);
  });

  it('decodes multi-byte UTF-8 split across chunks', async () => {
    // 'é' is 0xc3 0xa9 — split the bytes across two chunks
    const stream = Readable.from([
      Buffer.from([0xc3]),
      Buffer.from([0xa9, 0x0a]),
    ]);
    expect(await collect(chunkedToLines(stream))).toEqual(['é']);
  });
});

describe('spawnCli', () => {
  it('yields each stdout line from the child', async () => {
    const cli = spawnCli({
      bin: process.execPath,
      args: ['-e', "console.log('a'); console.log('b'); console.log('c');"],
    });
    const lines = await collect(cli.lines);
    expect(lines).toEqual(['a', 'b', 'c']);
    const { exitCode } = await cli.done;
    expect(exitCode).toBe(0);
  });

  it('captures stderr separately', async () => {
    const cli = spawnCli({
      bin: process.execPath,
      args: ['-e', "process.stderr.write('oops\\n'); console.log('ok');"],
    });
    const [out, err] = await Promise.all([collect(cli.lines), collect(cli.stderr)]);
    expect(out).toEqual(['ok']);
    expect(err).toEqual(['oops']);
    expect((await cli.done).exitCode).toBe(0);
  });

  it('writes stdin and closes when provided', async () => {
    const cli = spawnCli({
      bin: process.execPath,
      args: [
        '-e',
        "let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>console.log('got:'+d.trim()));",
      ],
      stdin: 'hello\n',
    });
    expect(await collect(cli.lines)).toEqual(['got:hello']);
  });

  it('interrupt() sends SIGINT which terminates a default Node child', async () => {
    const cli = spawnCli({
      bin: process.execPath,
      args: ['-e', 'setInterval(()=>{}, 1000);'],
    });
    setTimeout(() => cli.interrupt(), 80);
    const { exitCode, signal } = await cli.done;
    // Node's default SIGINT handler exits with signal or non-zero code.
    expect(exitCode !== 0 || signal !== null).toBe(true);
  });

  it('second interrupt escalates to SIGTERM on a SIGINT-resistant child', async () => {
    const cli = spawnCli({
      bin: process.execPath,
      args: [
        '-e',
        "process.on('SIGINT', () => {}); setInterval(() => {}, 1000);",
      ],
    });
    setTimeout(() => {
      cli.interrupt(); // swallowed by the SIGINT handler
      setTimeout(() => cli.interrupt(), 50); // escalates to SIGTERM
    }, 80);
    const { signal } = await cli.done;
    expect(signal).toBe('SIGTERM');
  }, 8000);

  it('AbortSignal aborts the child before spawn when pre-aborted', () => {
    const ac = new AbortController();
    ac.abort();
    expect(() =>
      spawnCli({ bin: process.execPath, args: ['-e', '0'], signal: ac.signal }),
    ).toThrow(/already aborted/);
  });

  it('AbortSignal triggers interrupt on a running child', async () => {
    const ac = new AbortController();
    const cli = spawnCli({
      bin: process.execPath,
      args: ['-e', "setInterval(()=>{}, 1000);"],
      signal: ac.signal,
    });
    setTimeout(() => ac.abort(), 100);
    const { exitCode, signal } = await cli.done;
    expect(exitCode === null || exitCode !== 0 || signal !== null).toBe(true);
  });

  it('closes stdin when opts.stdin is undefined so children that read stdin can exit', async () => {
    // `cat` reads stdin until EOF. If spawnCli leaves stdin open when no
    // opts.stdin is provided, cat blocks forever. Closing stdin immediately
    // lets cat exit cleanly with code 0.
    const cli = spawnCli({ bin: 'cat' });
    const result = await Promise.race([
      cli.done,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('child did not exit — stdin left open')), 1000),
      ),
    ]);
    expect(result.exitCode).toBe(0);
  }, 1500);

  it('kill() sends SIGTERM immediately', async () => {
    const cli = spawnCli({
      bin: process.execPath,
      args: ['-e', "setInterval(()=>{}, 1000);"],
    });
    setTimeout(() => cli.kill(), 50);
    const { signal } = await cli.done;
    expect(signal).toBe('SIGTERM');
  });

  it('shutdownSpawnedClis interrupts all active children', async () => {
    const cli = spawnCli({
      bin: process.execPath,
      args: ['-e', 'setInterval(()=>{}, 1000);'],
    });
    await shutdownSpawnedClis('test');
    const { exitCode, signal } = await cli.done;
    expect(exitCode !== 0 || signal !== null).toBe(true);
  });
});

describe('composeEnv', () => {
  const parent = { FOO: 'foo', BAR: 'bar', BAZ: 'baz' } as NodeJS.ProcessEnv;

  it('returns a clone of the parent env when no extras or unsets', () => {
    const env = composeEnv(parent);
    expect(env).toEqual(parent);
    expect(env).not.toBe(parent);
  });

  it('overlays extraEnv on top of the parent', () => {
    const env = composeEnv(parent, { FOO: 'overridden', NEW: 'n' });
    expect(env.FOO).toBe('overridden');
    expect(env.NEW).toBe('n');
    expect(env.BAR).toBe('bar');
  });

  it('preserves empty-string extraEnv values verbatim (does NOT delete)', () => {
    const env = composeEnv(parent, { FOO: '' });
    expect(Object.prototype.hasOwnProperty.call(env, 'FOO')).toBe(true);
    expect(env.FOO).toBe('');
  });

  it('deletes parent keys listed in unsetEnv', () => {
    const env = composeEnv(parent, undefined, ['FOO']);
    expect('FOO' in env).toBe(false);
    expect(env.BAR).toBe('bar');
  });

  it('unsetEnv overrides a same-key extraEnv (delete wins)', () => {
    const env = composeEnv(parent, { FOO: 'overridden' }, ['FOO']);
    expect('FOO' in env).toBe(false);
  });

  it('skips no-op unsetEnv keys that are not present', () => {
    const env = composeEnv(parent, undefined, ['NOPE']);
    expect(env).toEqual(parent);
  });

  it('composed env reaches spawnCli children (parent key stripped)', async () => {
    const parentWithKey: NodeJS.ProcessEnv = {
      ...process.env,
      HCA_TEST_STRIP: 'should-be-gone',
    };
    const env = composeEnv(parentWithKey, undefined, ['HCA_TEST_STRIP']);
    const cli = spawnCli({
      bin: process.execPath,
      args: [
        '-e',
        "process.stdout.write(JSON.stringify({has: 'HCA_TEST_STRIP' in process.env}))",
      ],
      env,
    });
    let out = '';
    for await (const line of cli.lines) out += line;
    await cli.done;
    expect(JSON.parse(out)).toEqual({ has: false });
  });
});

describe('mergeStdoutStderr', () => {
  async function fromArray(items: string[], delayMs = 0): Promise<AsyncIterable<string>> {
    return (async function* () {
      for (const it of items) {
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
        yield it;
      }
    })();
  }

  it('yields all lines from both streams, tagged with src', async () => {
    const stdout = await fromArray(['a', 'b']);
    const stderr = await fromArray(['x', 'y']);
    const merged: { src: string; line: string }[] = [];
    for await (const item of mergeStdoutStderr(stdout, stderr)) merged.push(item);
    const stdoutLines = merged.filter((m) => m.src === 'stdout').map((m) => m.line);
    const stderrLines = merged.filter((m) => m.src === 'stderr').map((m) => m.line);
    expect(stdoutLines).toEqual(['a', 'b']);
    expect(stderrLines).toEqual(['x', 'y']);
    expect(merged).toHaveLength(4);
  });

  it('interleaves arrival order across the two streams', async () => {
    // stderr lands first because stdout is delayed
    const slow = (async function* () {
      await new Promise((r) => setTimeout(r, 30));
      yield 'late';
    })();
    const fast = (async function* () {
      yield 'early';
    })();
    const order: string[] = [];
    for await (const item of mergeStdoutStderr(slow, fast))
      order.push(`${item.src}:${item.line}`);
    expect(order).toEqual(['stderr:early', 'stdout:late']);
  });

  it('exhausts both iterators before returning', async () => {
    const stdout = await fromArray(['only-stdout']);
    const stderr = await fromArray([]);
    const merged: { src: string; line: string }[] = [];
    for await (const item of mergeStdoutStderr(stdout, stderr)) merged.push(item);
    expect(merged).toEqual([{ src: 'stdout', line: 'only-stdout' }]);
  });

  it('end-to-end via spawnCli: yields a stderr event live, before exit', async () => {
    const cli = spawnCli({
      bin: process.execPath,
      args: [
        '-e',
        "process.stderr.write('boom\\n'); setTimeout(()=>{process.stdout.write('ok\\n');process.exit(0)}, 10);",
      ],
    });
    const items: { src: string; line: string }[] = [];
    for await (const item of mergeStdoutStderr(cli.lines, cli.stderr)) items.push(item);
    await cli.done;
    expect(items).toContainEqual({ src: 'stderr', line: 'boom' });
    expect(items).toContainEqual({ src: 'stdout', line: 'ok' });
  });
});
