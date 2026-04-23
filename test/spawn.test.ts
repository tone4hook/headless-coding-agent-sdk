import { describe, expect, it } from 'vitest';
import { spawnCli } from '../src/transport/spawn.js';
import { chunkedToLines } from '../src/transport/lines.js';
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

  it('kill() sends SIGTERM immediately', async () => {
    const cli = spawnCli({
      bin: process.execPath,
      args: ['-e', "setInterval(()=>{}, 1000);"],
    });
    setTimeout(() => cli.kill(), 50);
    const { signal } = await cli.done;
    expect(signal).toBe('SIGTERM');
  });
});
