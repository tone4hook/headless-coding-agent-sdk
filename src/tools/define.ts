/**
 * Custom tool definition helpers.
 *
 * Users describe tools with one of three `inputSchema` forms:
 *  - Simple type record:  { latitude: 'number', longitude: 'number' }
 *  - Full JSON Schema:    { type: 'object', properties: {...}, required: [...] }
 *  - Parse-compatible:    any object with .parse(value), optionally
 *                         .toJsonSchema() (Zod is supported without a hard dep).
 *
 * Internally the SDK normalizes to JSON Schema before advertising tools over MCP.
 */

import type {
  JsonSchema,
  ParseCompatibleSchema,
  SimpleTypeSchema,
  ToolDefinition,
  ToolHandler,
  ToolInputSchema,
  ToolResult,
} from '../types.js';

export function tool<TArgs = unknown>(spec: {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  handler: ToolHandler<TArgs>;
}): ToolDefinition<TArgs> {
  return {
    name: spec.name,
    description: spec.description,
    inputSchema: spec.inputSchema,
    handler: spec.handler,
  };
}

function isJsonSchema(x: ToolInputSchema): x is JsonSchema {
  return (
    typeof x === 'object' &&
    x !== null &&
    (x as { type?: unknown }).type === 'object'
  );
}

function isParseCompatible(x: ToolInputSchema): x is ParseCompatibleSchema {
  return (
    typeof x === 'object' &&
    x !== null &&
    typeof (x as { parse?: unknown }).parse === 'function'
  );
}

function isSimpleTypeRecord(x: ToolInputSchema): x is SimpleTypeSchema {
  if (typeof x !== 'object' || x === null) return false;
  for (const value of Object.values(x)) {
    if (
      value !== 'string' &&
      value !== 'number' &&
      value !== 'boolean' &&
      value !== 'object' &&
      value !== 'array'
    ) {
      return false;
    }
  }
  return true;
}

export function normalizeInputSchema(schema: ToolInputSchema): JsonSchema {
  if (isJsonSchema(schema)) {
    return schema;
  }

  if (isParseCompatible(schema)) {
    // Prefer a .toJsonSchema() method if the user's validator exposes one
    // (zod-to-json-schema on Zod v3, Zod v4's .toJSONSchema, etc.). If not,
    // fall back to a permissive any-object schema — the CLI still runs the
    // tool and the handler is free to re-validate with the original parser.
    const maybe = schema as ParseCompatibleSchema & {
      toJSONSchema?: () => JsonSchema;
    };
    if (typeof maybe.toJsonSchema === 'function') {
      return maybe.toJsonSchema();
    }
    if (typeof maybe.toJSONSchema === 'function') {
      return maybe.toJSONSchema();
    }
    return { type: 'object', additionalProperties: true };
  }

  if (isSimpleTypeRecord(schema)) {
    const properties: Record<string, { type: string }> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(schema)) {
      properties[key] = { type: value };
      required.push(key);
    }
    return { type: 'object', properties, required };
  }

  // Unknown shape — treat as permissive object so the CLI can still route calls.
  return { type: 'object', additionalProperties: true };
}

export interface ToolRegistry {
  list(): ToolDefinition<any>[];
  get(name: string): ToolDefinition<any> | undefined;
  invoke(name: string, args: unknown): Promise<ToolResult>;
}

export function createToolRegistry(
  tools: ReadonlyArray<ToolDefinition<any>>,
): ToolRegistry {
  const byName = new Map<string, ToolDefinition<any>>();
  for (const t of tools) {
    if (byName.has(t.name)) {
      throw new Error(`Duplicate tool name: ${t.name}`);
    }
    byName.set(t.name, t);
  }

  return {
    list: () => Array.from(byName.values()),
    get: (name) => byName.get(name),
    invoke: async (name, args) => {
      const def = byName.get(name);
      if (!def) {
        throw new Error(`Unknown tool: ${name}`);
      }
      const parsed = parseArgs(def.inputSchema, args);
      return def.handler(parsed);
    },
  };
}

function parseArgs(schema: ToolInputSchema, args: unknown): unknown {
  // If the caller supplied a parse-compatible schema, run it so bad args
  // surface before the handler is invoked.
  if (isParseCompatible(schema)) {
    return schema.parse(args);
  }
  return args;
}
