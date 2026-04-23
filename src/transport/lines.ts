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
