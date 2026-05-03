/**
 * Public API — headless-coding-agent-sdk
 *
 * Unified TypeScript SDK wrapping the `claude` and `gemini` CLI binaries
 * in headless mode. Subprocess-only; no vendor JS SDK dependencies.
 */

export { createCoder } from './factory.js';
export { createClaudeCoder } from './adapters/claude/index.js';
export { createGeminiCoder } from './adapters/gemini/index.js';

export {
  tool,
  createToolRegistry,
  normalizeInputSchema,
} from './tools/define.js';
export type { ToolRegistry } from './tools/define.js';

export { HttpMcpBridge } from './tools/bridge.js';

export {
  CoderError,
  CliNotFoundError,
  CliVersionError,
  FeatureNotSupportedError,
  CliExitError,
  GeminiBridgeNotLoadedError,
} from './errors.js';
export type { ErrorCode } from './errors.js';

export type {
  Provider,
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
