# headless-coding-agent-sdk

TypeScript SDK that unifies headless coding-agent **CLI binaries**
behind one I/O schema. MVP targets:

- `claude` — Claude Code in headless mode (`claude -p`)
- `gemini` — Gemini CLI in headless mode (`gemini -p`)

This SDK wraps the CLIs only. It does not depend on any vendor JS SDK
(`@anthropic-ai/*`, `@google/generative-ai`). Auth is whatever the
installed CLI already has configured on your machine.

Design, decisions, and open items: [`.plan/findings.md`](./.plan/findings.md)
Execution plan: [`.plan/task_plan.md`](./.plan/task_plan.md)

> Status: pre-alpha — under active construction.
