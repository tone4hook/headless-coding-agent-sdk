# headless-coding-agent-sdk

TypeScript SDK that unifies headless coding-agent **CLI binaries**
behind one I/O schema. MVP targets:

- `claude` — Claude Code in headless mode (`claude -p`)
- `gemini` — Gemini CLI in headless mode (`gemini -p`)

This SDK wraps the CLIs only. It does **not** depend on any vendor JS
SDK (`@anthropic-ai/*`, `@google/generative-ai`). Auth is whatever the
installed CLI already has configured on your machine.

## Installation

```sh
npm install headless-coding-agent-sdk
# plus the CLI(s) you plan to use:
# npm install -g @anthropic-ai/claude-code
# npm install -g @google/gemini-cli
```

## 60-second quickstart

```ts
import { createCoder } from 'headless-coding-agent-sdk';

const coder = createCoder('claude'); // or 'gemini'
const thread = await coder.startThread();

const result = await thread.run('Say hi in three words.');
console.log(result.text);
console.log(thread.id); // persistent session UUID — use with resumeThread()

await thread.close();
```

### Streaming

```ts
for await (const ev of thread.runStreamed('plan a migration')) {
  if (ev.type === 'message' && ev.role === 'assistant') process.stdout.write(ev.text ?? '');
  if (ev.type === 'tool_use') console.error(`[tool] ${ev.name}`, ev.args);
}
```

### Custom tools (works on both adapters)

```ts
import { createCoder, tool } from 'headless-coding-agent-sdk';

const weather = tool({
  name: 'get_weather',
  description: 'Current temperature for coordinates',
  inputSchema: { latitude: 'number', longitude: 'number' },
  handler: async ({ latitude, longitude }: { latitude: number; longitude: number }) => ({
    content: [{ type: 'text', text: `72°F at ${latitude},${longitude}` }],
  }),
});

const coder = createCoder('claude', {
  tools: [weather],
  permissionMode: 'bypassPermissions',
});
```

Behind the scenes the SDK hosts a localhost MCP server per thread and
wires each CLI to it — Claude via `--mcp-config`, Gemini via an
ephemeral `GEMINI_CLI_HOME` with merged settings.

### Resume a prior session

```ts
const coder = createCoder('claude');
const thread = await coder.resumeThread(previousThreadId);
```

Both CLIs identify sessions by UUID.

### Structured output

```ts
const { json } = await thread.run('return {"name": "...", "age": N}', {
  outputSchema: { type: 'object', properties: { name: { type: 'string' }, age: { type: 'number' } }, required: ['name', 'age'] },
});
```

Claude validates server-side via `--json-schema`. Gemini best-efforts
via prompt injection; pass `strictSchema: true` to get a
`FeatureNotSupportedError` instead of best-effort.

## Design principle

The shared schema is not a lowest-common-denominator: features only one
CLI supports (permission modes, `--fork-session`, `--json-schema`, etc.)
remain accessible as optional fields. Adapters that don't honor a field
throw `FeatureNotSupportedError` at call time rather than silently
dropping it.

See [`.plan/findings.md`](./.plan/findings.md) for the full design and
[`docs/adapters.md`](./docs/adapters.md) for the per-adapter flag
coverage matrix.

## Subpath imports

```ts
import { createClaudeCoder } from 'headless-coding-agent-sdk/claude';
import { createGeminiCoder } from 'headless-coding-agent-sdk/gemini';
```

## Status

Pre-alpha. MVP feature set implemented; breaking API changes likely
before 1.0.
