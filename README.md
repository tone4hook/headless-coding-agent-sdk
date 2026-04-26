# headless-coding-agent-sdk

TypeScript SDK that unifies headless coding-agent **CLI binaries**
behind one I/O schema. MVP targets:

- `claude` — Claude Code in headless mode (`claude -p`)
- `gemini` — Gemini CLI in headless mode (`gemini -p`)

This SDK wraps the CLIs only. It does **not** depend on any vendor JS
SDK (`@anthropic-ai/*`, `@google/generative-ai`). Auth is whatever the
installed CLI already has configured on your machine.

## Installation

This package is published to **GitHub Packages**, so installing it requires a
one-time auth setup.

1. Create a GitHub [Personal Access Token (classic)](https://github.com/settings/tokens)
   with the `read:packages` scope.
2. Add the following to `~/.npmrc` (or a project-level `.npmrc`), substituting
   your token:

   ```
   @tone4hook:registry=https://npm.pkg.github.com
   //npm.pkg.github.com/:_authToken=YOUR_GITHUB_TOKEN
   ```

3. Install:

   ```sh
   npm install @tone4hook/headless-coding-agent-sdk
   # plus the CLI(s) you plan to use:
   # npm install -g @anthropic-ai/claude-code
   # npm install -g @google/gemini-cli
   ```

## 60-second quickstart

```ts
import { createCoder } from '@tone4hook/headless-coding-agent-sdk';

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
  if (ev.type === 'stderr') console.error(`[stderr] ${ev.line}`);
}
```

### Token-by-token deltas (Claude)

Pass `streamPartialMessages: true` to receive each text chunk as
`{type:'message', role:'assistant', delta:true, text:<chunk>}`. The
final aggregated message is still emitted with `delta:false`, so
existing consumers that only read the final message keep working.

```ts
for await (const ev of thread.runStreamed('write a haiku', { streamPartialMessages: true })) {
  if (ev.type === 'message' && ev.role === 'assistant' && ev.delta) {
    process.stdout.write(ev.text ?? '');
  }
}
```

Gemini silently ignores the flag.

### Auth: forcing OAuth / keychain

Both CLIs prefer their OAuth/keychain credentials, but they fall back to
env-var keys when present (e.g. `ANTHROPIC_API_KEY`). To force the
CLI to use its keychain credentials regardless of inherited env, list
the offenders in `unsetEnv`:

```ts
const coder = createCoder('claude', {
  unsetEnv: [
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_VERTEX',
  ],
});
```

Empty-string values in `extraEnv` are preserved as legitimate values
rather than treated as deletes — `unsetEnv` is the explicit strip list.

### Custom tools (works on both adapters)

```ts
import { createCoder, tool } from '@tone4hook/headless-coding-agent-sdk';

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
import { createClaudeCoder } from '@tone4hook/headless-coding-agent-sdk/claude';
import { createGeminiCoder } from '@tone4hook/headless-coding-agent-sdk/gemini';
```

## Status

Pre-alpha. MVP feature set implemented; breaking API changes likely
before 1.0.
