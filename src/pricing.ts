/**
 * Best-effort token pricing table. Returns `undefined` (not NaN) for
 * unknown models so callers can render "—" rather than misleading zeros.
 *
 * The table is intentionally small: only models that are common today
 * and whose price points are publicly listed by the vendor. Out-of-date
 * entries are worse than missing entries — keep this lean and bump it
 * deliberately per release.
 *
 * Prices are USD per 1M tokens.
 */

import type { UsageStats } from './types.js';

export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok?: number;
  cacheWritePerMTok?: number;
  reasoningPerMTok?: number;
}

export const MODEL_PRICING: Readonly<Record<string, ModelPricing>> = {
  // Anthropic Claude (USD per 1M tokens, public list pricing snapshot).
  'claude-opus-4': { inputPerMTok: 15, outputPerMTok: 75, cacheReadPerMTok: 1.5, cacheWritePerMTok: 18.75 },
  'claude-sonnet-4': { inputPerMTok: 3, outputPerMTok: 15, cacheReadPerMTok: 0.3, cacheWritePerMTok: 3.75 },
  'claude-haiku-4': { inputPerMTok: 0.8, outputPerMTok: 4, cacheReadPerMTok: 0.08, cacheWritePerMTok: 1 },

  // OpenAI Codex / GPT (representative — consumers should override if needed).
  'gpt-5': { inputPerMTok: 1.25, outputPerMTok: 10 },
  'gpt-5-mini': { inputPerMTok: 0.25, outputPerMTok: 2 },

  // Google Gemini.
  'gemini-2.5-pro': { inputPerMTok: 1.25, outputPerMTok: 10, cacheReadPerMTok: 0.31 },
  'gemini-2.5-flash': { inputPerMTok: 0.3, outputPerMTok: 2.5, cacheReadPerMTok: 0.075 },
};

function findPricing(model: string): ModelPricing | undefined {
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];
  // Loose match: strip date suffix (e.g. "claude-sonnet-4-20250514").
  for (const key of Object.keys(MODEL_PRICING)) {
    if (model.startsWith(key)) return MODEL_PRICING[key];
  }
  return undefined;
}

/**
 * Estimate cost in USD given a model id and token counts. Returns
 * `undefined` for unknown models so callers can distinguish "free" from
 * "unknown".
 */
export function estimateCostUsd(
  model: string | undefined,
  stats: UsageStats,
): number | undefined {
  if (!model) return undefined;
  const p = findPricing(model);
  if (!p) return undefined;

  const M = 1_000_000;
  const input = (stats.inputTokens ?? 0) * (p.inputPerMTok / M);
  const output = (stats.outputTokens ?? 0) * (p.outputPerMTok / M);
  const cacheRead =
    (stats.cacheReadTokens ?? 0) * ((p.cacheReadPerMTok ?? 0) / M);
  const cacheWrite =
    (stats.cacheCreationTokens ?? 0) * ((p.cacheWritePerMTok ?? 0) / M);
  const reasoning =
    (stats.reasoningTokens ?? 0) *
    ((p.reasoningPerMTok ?? p.outputPerMTok) / M);

  const cost = input + output + cacheRead + cacheWrite + reasoning;
  return Number.isFinite(cost) ? cost : undefined;
}
