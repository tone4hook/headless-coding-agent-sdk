/**
 * Shared permission-policy → argv translation.
 *
 * Each adapter declares a ProviderPolicyTranslation table describing how
 * the unified PermissionPolicy maps to its CLI flags. The applier owns
 * the mode-flag precedence guard and the allow/deny conditional pushes,
 * so the only adapter-specific surface is the table.
 *
 * Unsupported denies are surfaced as FeatureNotSupportedError, matching
 * how every other adapter-incompatible field is handled at argv-build
 * time.
 */

import { FeatureNotSupportedError } from '../../errors.js';
import type { PermissionPolicy, Provider } from '../../types.js';

export type ListFormat = 'multi' | 'csv';

export interface ListFlag {
  name: string;
  format: ListFormat;
}

export interface ProviderPolicyTranslation {
  /** Which CLI flag carries the mode value. */
  modeFlag: string;
  /** Per-mode flag value. Modes mapped to undefined are treated as "no override". */
  modeValues: Partial<Record<NonNullable<PermissionPolicy['mode']>, string>>;
  /** Where to push policy.allow. Undefined = adapter handled it elsewhere or it's unsupported. */
  allowFlag?: ListFlag;
  /** Where to push policy.deny. 'unsupported' makes a non-empty list throw. */
  denyFlag: ListFlag | 'unsupported';
}

export function applyPermissionPolicy(
  argv: string[],
  policy: PermissionPolicy,
  provider: Provider,
  table: ProviderPolicyTranslation,
): void {
  // Precedence: an explicit adapter-native mode flag already pushed wins.
  if (!argv.includes(table.modeFlag)) {
    const mapped = policy.mode ? table.modeValues[policy.mode] : undefined;
    if (mapped) argv.push(table.modeFlag, mapped);
  }

  if (policy.allow && policy.allow.length > 0 && table.allowFlag) {
    pushList(argv, table.allowFlag, policy.allow);
  }

  if (policy.deny && policy.deny.length > 0) {
    if (table.denyFlag === 'unsupported') {
      throw new FeatureNotSupportedError(
        provider,
        'permissionPolicy.deny',
        `${provider} CLI has no tool-name deny list. Remove permissionPolicy.deny or use the other adapter.`,
      );
    }
    pushList(argv, table.denyFlag, policy.deny);
  }
}

function pushList(argv: string[], flag: ListFlag, items: string[]): void {
  if (flag.format === 'csv') {
    argv.push(flag.name, items.join(','));
  } else {
    argv.push(flag.name, ...items);
  }
}
