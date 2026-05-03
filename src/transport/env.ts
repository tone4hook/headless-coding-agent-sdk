/**
 * Environment-variable hygiene for spawned CLIs.
 *
 * The SDK spawns three external Node-based CLIs. Without sanitation the host
 * process's `NODE_OPTIONS=--require ts-node/register`, `npm_*`, `CLAUDECODE`,
 * etc. leak into every child and have caused: slow Node startup, accidental
 * debugger attach, and false "we're inside Claude Code" signals reaching
 * Gemini's child shells.
 *
 * Strategy: deny-list, not allow-list. Provider-specific auth/proxy/CA-bundle
 * vars (`HTTPS_PROXY`, `SSL_CERT_FILE`, `NODE_EXTRA_CA_CERTS`, `HOME`,
 * `XDG_CONFIG_HOME`, `*_API_KEY`, `GOOGLE_APPLICATION_CREDENTIALS`,
 * `GOOGLE_CLOUD_*`, `CLAUDE_CONFIG_DIR`, etc.) flow through untouched.
 */

export const DEFAULT_DENY_KEYS: readonly string[] = [
  'NODE_OPTIONS',
  'NODE_INSPECT',
  'NODE_DEBUG',
  'NODE_REPL_HISTORY',
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
];

export const DEFAULT_DENY_PREFIXES: readonly string[] = ['npm_', 'PNPM_', 'YARN_'];

export interface SanitizeEnvOptions {
  /** Extra exact-match keys to remove. */
  additionalDeny?: string[];
  /** Override the default exact-match deny list. */
  denyKeys?: readonly string[];
  /** Override the default prefix deny list. */
  denyPrefixes?: readonly string[];
}

export function sanitizeEnv(
  parent: NodeJS.ProcessEnv,
  opts: SanitizeEnvOptions = {},
): NodeJS.ProcessEnv {
  const denyKeys = new Set([
    ...(opts.denyKeys ?? DEFAULT_DENY_KEYS),
    ...(opts.additionalDeny ?? []),
  ]);
  const denyPrefixes = opts.denyPrefixes ?? DEFAULT_DENY_PREFIXES;

  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(parent)) {
    if (denyKeys.has(key)) continue;
    if (denyPrefixes.some((p) => key.startsWith(p))) continue;
    out[key] = value;
  }
  return out;
}
