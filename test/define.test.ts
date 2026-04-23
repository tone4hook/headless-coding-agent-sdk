import { describe, it, expect } from 'vitest';
import {
  createToolRegistry,
  normalizeInputSchema,
  tool,
} from '../src/tools/define.js';
import type { JsonSchema } from '../src/types.js';

describe('tool()', () => {
  it('returns a ToolDefinition preserving fields', () => {
    const t = tool({
      name: 'echo',
      description: 'echo back',
      inputSchema: { text: 'string' },
      handler: async ({ text }: { text: string }) => ({
        content: [{ type: 'text', text }],
      }),
    });
    expect(t.name).toBe('echo');
    expect(t.description).toBe('echo back');
    expect(t.inputSchema).toEqual({ text: 'string' });
  });
});

describe('normalizeInputSchema()', () => {
  it('expands a simple type record into JSON Schema with all keys required', () => {
    const s = normalizeInputSchema({ name: 'string', age: 'number' });
    expect(s).toEqual({
      type: 'object',
      properties: { name: { type: 'string' }, age: { type: 'number' } },
      required: ['name', 'age'],
    });
  });

  it('passes a JSON Schema object through unchanged', () => {
    const input: JsonSchema = {
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a'],
    };
    expect(normalizeInputSchema(input)).toBe(input);
  });

  it('calls .toJsonSchema() on parse-compatible values that expose it', () => {
    const schema = {
      parse: (x: unknown) => x,
      toJsonSchema: () => ({
        type: 'object' as const,
        properties: { ok: { type: 'boolean' } },
      }),
    };
    expect(normalizeInputSchema(schema)).toEqual({
      type: 'object',
      properties: { ok: { type: 'boolean' } },
    });
  });

  it('calls .toJSONSchema() on parse-compatible values (Zod v4-style)', () => {
    const schema = {
      parse: (x: unknown) => x,
      toJSONSchema: () => ({
        type: 'object' as const,
        properties: { flag: { type: 'boolean' } },
      }),
    };
    expect(normalizeInputSchema(schema)).toEqual({
      type: 'object',
      properties: { flag: { type: 'boolean' } },
    });
  });

  it('falls back to permissive object for parse-only schemas', () => {
    const schema = { parse: (x: unknown) => x };
    expect(normalizeInputSchema(schema)).toEqual({
      type: 'object',
      additionalProperties: true,
    });
  });

  it('falls back to permissive object for unrecognized shapes', () => {
    // Not a simple record (string value is not a known type literal), not JSON
    // schema (no type:'object'), not parse-compatible.
    expect(normalizeInputSchema({ weird: 'not-a-type' } as never)).toEqual({
      type: 'object',
      additionalProperties: true,
    });
  });
});

describe('createToolRegistry()', () => {
  const add = tool({
    name: 'add',
    description: 'add two numbers',
    inputSchema: { a: 'number', b: 'number' },
    handler: async ({ a, b }: { a: number; b: number }) => ({
      content: [{ type: 'text', text: String(a + b) }],
    }),
  });

  it('lists and gets registered tools', () => {
    const r = createToolRegistry([add]);
    expect(r.list().map((t) => t.name)).toEqual(['add']);
    expect(r.get('add')?.name).toBe('add');
    expect(r.get('missing')).toBeUndefined();
  });

  it('invokes a registered handler and returns its result', async () => {
    const r = createToolRegistry([add]);
    const result = await r.invoke('add', { a: 2, b: 3 });
    expect(result).toEqual({ content: [{ type: 'text', text: '5' }] });
  });

  it('throws on unknown tool name', async () => {
    const r = createToolRegistry([add]);
    await expect(r.invoke('missing', {})).rejects.toThrow(/Unknown tool/);
  });

  it('runs parse-compatible schemas before the handler sees args', async () => {
    let parsed: unknown = null;
    const t = tool({
      name: 'strict',
      description: '',
      inputSchema: {
        parse: (x) => {
          parsed = x;
          if (typeof (x as { n?: unknown }).n !== 'number') {
            throw new Error('n must be number');
          }
          return { n: (x as { n: number }).n * 2 };
        },
      },
      handler: async (args: unknown) => ({
        content: [{ type: 'text', text: JSON.stringify(args) }],
      }),
    });
    const r = createToolRegistry([t]);
    const ok = await r.invoke('strict', { n: 7 });
    expect(ok).toEqual({ content: [{ type: 'text', text: '{"n":14}' }] });
    expect(parsed).toEqual({ n: 7 });

    await expect(r.invoke('strict', { n: 'nope' })).rejects.toThrow(
      /n must be number/,
    );
  });

  it('rejects duplicate tool names at registry construction', () => {
    expect(() => createToolRegistry([add, add])).toThrow(/Duplicate/);
  });
});
