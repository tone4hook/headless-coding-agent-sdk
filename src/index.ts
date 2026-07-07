/**
 * Public API — headless-coding-agent-sdk
 *
 * Unified TypeScript SDK wrapping coding-agent CLIs in headless mode.
 * Subprocess-only; no vendor JS SDK dependencies.
 */

export { createCoder } from './factory.js';
export { createClaudeCoder } from './adapters/claude/index.js';
export { createCodexCoder } from './adapters/codex/index.js';
export { createCopilotCoder } from './adapters/copilot/index.js';
export { createPiCoder } from './adapters/pi/index.js';

export {
  tool,
  createToolRegistry,
  normalizeInputSchema,
} from './tools/define.js';
export type { ToolRegistry } from './tools/define.js';

export { HttpMcpBridge } from './tools/bridge.js';
export { shutdownSpawnedClis } from './transport/spawn.js';
export {
  installExitCleanup,
  trackForExitCleanup,
} from './transport/exitCleanup.js';
export type { InstallExitCleanupOptions } from './transport/exitCleanup.js';

export {
  CoderError,
  CliNotFoundError,
  CliVersionError,
  FeatureNotSupportedError,
  CliExitError,
} from './errors.js';
export type { ErrorCode } from './errors.js';

export type {
  Provider,
  ReasoningEffort,
  PromptInput,
  SharedStartOpts,
  RunOpts,
  RunResult,
  UsageStats,
  HeadlessCoder,
  ThreadHandle,
  CoderStreamEvent,
  CoderStreamEventType,
  EventIterator,
  ProviderExtras,
  ExtraFor,
  PermissionPolicy,
  PermissionRequest,
  PermissionDecision,
  ToolDefinition,
  ToolHandler,
  ToolInputSchema,
  ToolResult,
  ToolResultContent,
  ToolResultContentText,
  ToolResultContentImage,
  ToolResultContentResource,
  SimpleTypeSchema,
  JsonSchema,
  ParseCompatibleSchema,
} from './types.js';
