# headless-coding-agent-sdk

TypeScript SDK that unifies headless coding-agent **CLI binaries** behind
one I/O schema. Supported CLIs:

- `claude` — Claude Code (`claude -p`)
- `gemini` — Gemini CLI (`gemini -p`)
- `codex` — OpenAI Codex CLI (`codex exec`)

Subprocess-only — no vendor JS SDK dependencies (`@anthropic-ai/*`,
`@google/generative-ai`, `@openai/*`). Auth is whatever the installed CLI
already has configured on your machine.

## Installation

Published to **GitHub Packages** — one-time auth setup required.

1. Create a GitHub [Personal Access Token (classic)](https://github.com/settings/tokens)
   with the `read:packages` scope.
2. Add to `~/.npmrc` (or a project-level `.npmrc`):

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
   # npm install -g @openai/codex
   ```

## 60-second quickstart

```ts
import { createCoder } from '@tone4hook/headless-coding-agent-sdk';

const coder = createCoder('claude'); // 'claude' | 'gemini' | 'codex'
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
`{type:'message', role:'assistant', delta:true, text:<chunk>}`. The final
aggregated message is still emitted with `delta:false`.

```ts
for await (const ev of thread.runStreamed('write a haiku', { streamPartialMessages: true })) {
  if (ev.type === 'message' && ev.role === 'assistant' && ev.delta) {
    process.stdout.write(ev.text ?? '');
  }
}
```

Gemini and Codex silently ignore the flag.

### Auth: forcing OAuth / keychain

CLIs prefer OAuth/keychain credentials but fall back to env-var keys when
present (e.g. `ANTHROPIC_API_KEY`). To force keychain regardless of inherited
env, list the offenders in `unsetEnv`:

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

Empty-string values in `extraEnv` are preserved as legitimate values;
`unsetEnv` is the explicit strip list.

### Custom tools (Claude and Gemini)

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

The SDK hosts a localhost MCP server per thread and wires each CLI to it —
Claude via `--mcp-config`, Gemini via an ephemeral `GEMINI_CLI_HOME`. Codex
does not yet support the MCP bridge and will throw
`FeatureNotSupportedError` if `tools` is set.

### Resume a prior session

```ts
const coder = createCoder('claude');
const thread = await coder.resumeThread(previousThreadId);
```

All three CLIs identify sessions by UUID.

### Structured output

```ts
const { json } = await thread.run('return {"name": "...", "age": N}', {
  outputSchema: { type: 'object', properties: { name: { type: 'string' }, age: { type: 'number' } }, required: ['name', 'age'] },
});
```

Claude and Codex validate server-side (`--json-schema` / `--output-schema`).
Gemini best-efforts via prompt injection; pass `strictSchema: true` to get
`FeatureNotSupportedError` instead of best-effort.

## Design principle

The shared schema is not a lowest-common-denominator: features only one CLI
supports stay accessible as optional fields. Adapters that don't honor a
field throw `FeatureNotSupportedError` at call time rather than silently
dropping it.

See [`docs/adapters.md`](./docs/adapters.md) for the per-adapter coverage
matrix.

## Subpath imports

```ts
import { createClaudeCoder } from '@tone4hook/headless-coding-agent-sdk/claude';
import { createGeminiCoder } from '@tone4hook/headless-coding-agent-sdk/gemini';
import { createCodexCoder } from '@tone4hook/headless-coding-agent-sdk/codex';
```

## Status

Pre-1.0. Three-adapter feature set implemented; breaking API changes
possible before 1.0.
