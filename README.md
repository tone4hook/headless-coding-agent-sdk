# headless-coding-agent-sdk

TypeScript SDK that unifies headless coding-agent **CLI binaries** behind
one I/O schema. Supported CLIs:

- `claude` — Claude Code (`claude -p`)
- `codex` — OpenAI Codex CLI (`codex exec`)
- `copilot` — GitHub Copilot CLI (`copilot -p`)
- `pi` — Pi coding agent (`pi --mode json --print`)

Subprocess-only — no vendor JS SDK dependencies. Auth is whatever the
installed CLI already has configured on your machine.

## Installation

Published to **GitHub Packages** — one-time auth setup required.

1. Create a GitHub [Personal Access Token (classic)](https://github.com/settings/tokens)
   with the `read:packages` scope.
2. Add to `~/.npmrc` (or a project-level `.npmrc`):

   ```text
   @tone4hook:registry=https://npm.pkg.github.com
   //npm.pkg.github.com/:_authToken=YOUR_GITHUB_TOKEN
   ```

3. Install:

   ```sh
   npm install @tone4hook/headless-coding-agent-sdk
   # plus the vendor CLI(s) you plan to use and authenticate:
   # claude, codex, copilot, pi
   ```

## Quickstart

```ts
import { createCoder } from '@tone4hook/headless-coding-agent-sdk';

const coder = createCoder('claude'); // 'claude' | 'codex' | 'copilot' | 'pi'
const thread = await coder.startThread();

const result = await thread.run('Say hi in three words.');
console.log(result.text);
console.log(thread.id); // persistent session id when the CLI reports one

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

### Custom Tools

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

The SDK hosts a localhost MCP server per thread and wires supported CLIs to
it: Claude via `--mcp-config`, Codex via temporary `-c mcp_servers.*`
config overrides, and Copilot via `--additional-mcp-config @tempfile`.
Pi custom SDK tools intentionally throw `FeatureNotSupportedError` until Pi
exposes a documented MCP/SDK bridge for this transport.

### Resume

```ts
const coder = createCoder('codex');
const thread = await coder.resumeThread(previousThreadId);
const latest = await coder.resumeLatest();
```

Each adapter maps this to the closest native headless resume mode.

### Structured Output

```ts
const { json } = await thread.run('return {"name": "...", "age": N}', {
  outputSchema: {
    type: 'object',
    properties: { name: { type: 'string' }, age: { type: 'number' } },
    required: ['name', 'age'],
  },
});
```

Claude and Codex validate natively (`--json-schema` / `--output-schema`).
Copilot and Pi use prompt-injected best effort; pass `strictSchema: true`
to get `FeatureNotSupportedError` instead of best-effort behavior.

## Design Principle

The shared schema is not a lowest-common-denominator: features only one CLI
supports stay accessible as optional fields. Adapters that don't honor a
field throw `FeatureNotSupportedError` at call time rather than silently
dropping it.

The v1 transport is deliberately subprocess-based. The `AdapterSpec` seam
keeps shared lifecycle/env/stall/MCP handling in one place while each
provider owns argv, environment, and JSONL translation. Vendor SDKs,
Copilot ACP, and Pi RPC remain future transport options.

See [`docs/adapters.md`](./docs/adapters.md) for the per-adapter coverage
matrix.

## Subpath Imports

```ts
import { createClaudeCoder } from '@tone4hook/headless-coding-agent-sdk/claude';
import { createCodexCoder } from '@tone4hook/headless-coding-agent-sdk/codex';
import { createCopilotCoder } from '@tone4hook/headless-coding-agent-sdk/copilot';
import { createPiCoder } from '@tone4hook/headless-coding-agent-sdk/pi';
```

## Status

Pre-1.0. Four-adapter feature set implemented; breaking API changes remain
possible before 1.0.
