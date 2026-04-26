/**
 * Buffered line splitter for Node readable streams.
 *
 * Yields complete lines as UTF-8 strings. Handles `\n` and `\r\n`.
 * If the stream ends mid-line, the final (unterminated) buffer is
 * yielded as one last string iff it is non-empty.
 */
export async function* chunkedToLines(
  readable: NodeJS.ReadableStream,
): AsyncIterable<string> {
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  for await (const chunk of readable) {
    const bytes =
      typeof chunk === 'string'
        ? Buffer.from(chunk, 'utf-8')
        : (chunk as Buffer);
    buf += decoder.decode(bytes, { stream: true });
    let newlineIdx: number;
    while ((newlineIdx = buf.indexOf('\n')) !== -1) {
      let line = buf.slice(0, newlineIdx);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      buf = buf.slice(newlineIdx + 1);
      yield line;
    }
  }
  buf += decoder.decode();
  if (buf.length > 0) {
    if (buf.endsWith('\r')) buf = buf.slice(0, -1);
    yield buf;
  }
}

/**
 * Merge two async iterables of lines, tagging each yielded item with its
 * source. Preserves arrival order across the two streams. Both iterators are
 * exhausted before the merged iterator returns.
 *
 * Used by adapters to interleave the CLI's stdout (stream-json events) and
 * stderr (live diagnostics surfaced as `stderr` events) into a single event
 * stream while still letting each line carry its origin.
 */
export async function* mergeStdoutStderr(
  stdout: AsyncIterable<string>,
  stderr: AsyncIterable<string>,
): AsyncIterable<{ src: 'stdout' | 'stderr'; line: string }> {
  const stdoutIt = stdout[Symbol.asyncIterator]();
  const stderrIt = stderr[Symbol.asyncIterator]();
  type Pending = Promise<{
    src: 'stdout' | 'stderr';
    result: IteratorResult<string>;
  }>;
  let stdoutP: Pending | null = stdoutIt
    .next()
    .then((result) => ({ src: 'stdout' as const, result }));
  let stderrP: Pending | null = stderrIt
    .next()
    .then((result) => ({ src: 'stderr' as const, result }));
  while (stdoutP || stderrP) {
    const racers: Pending[] = [];
    if (stdoutP) racers.push(stdoutP);
    if (stderrP) racers.push(stderrP);
    const winner = await Promise.race(racers);
    if (winner.src === 'stdout') {
      if (winner.result.done) {
        stdoutP = null;
      } else {
        yield { src: 'stdout', line: winner.result.value };
        stdoutP = stdoutIt
          .next()
          .then((result) => ({ src: 'stdout' as const, result }));
      }
    } else {
      if (winner.result.done) {
        stderrP = null;
      } else {
        yield { src: 'stderr', line: winner.result.value };
        stderrP = stderrIt
          .next()
          .then((result) => ({ src: 'stderr' as const, result }));
      }
    }
  }
}
