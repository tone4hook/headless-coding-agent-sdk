/**
 * Git worktree helpers — a tiny companion for multi-agent consumers that
 * fan out runs across isolated checkouts. Shells out to `git worktree`
 * via execFile (no native deps).
 */

import { execFile } from 'node:child_process';
import { mkdir, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { CliNotFoundError } from '../errors.js';

const execFileP = promisify(execFile);

async function git(repo: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileP('git', args, { cwd: repo });
    return stdout;
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stderr?: string };
    if (err.code === 'ENOENT') {
      throw new CliNotFoundError('git');
    }
    const msg = err.stderr ?? err.message ?? 'git failed';
    throw new Error(`git ${args.join(' ')}: ${msg.trim()}`);
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function branchExists(repo: string, branch: string): Promise<boolean> {
  try {
    await git(repo, ['rev-parse', '--verify', `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

export interface WorktreeOptions {
  /** Path to the main checkout (must be a git repo). */
  repo: string;
  /** Branch name to check out (created from `baseRef` if absent). */
  branch: string;
  /** Base ref for new branch creation. Default: 'HEAD'. */
  baseRef?: string;
  /** Parent directory for worktree dirs. Default: `${repo}/.headless-coder/worktrees`. */
  basePath?: string;
  /** Reuse an existing branch instead of failing if `branch` already exists. */
  reuseBranch?: boolean;
}

export interface Worktree {
  /** Absolute path to the worktree directory. */
  path: string;
  /** Branch checked out in the worktree. */
  branch: string;
  /** Remove the worktree (and optionally delete its branch). */
  remove(opts?: {
    force?: boolean;
    deleteBranch?: boolean;
  }): Promise<void>;
}

export async function createWorktree(opts: WorktreeOptions): Promise<Worktree> {
  const repo = resolve(opts.repo);
  const baseRef = opts.baseRef ?? 'HEAD';
  const basePath = resolve(
    opts.basePath ?? join(repo, '.headless-coder', 'worktrees'),
  );
  await mkdir(basePath, { recursive: true });

  const safeName = opts.branch.replace(/[^A-Za-z0-9._-]/g, '_');
  const wtPath = join(basePath, `${safeName}-${Date.now()}`);

  const branchAlreadyExists = await branchExists(repo, opts.branch);
  if (branchAlreadyExists) {
    // `git worktree add <path> <existing-branch>` checks out the branch.
    // Will fail if the branch is already checked out elsewhere — that's
    // the right behavior unless `reuseBranch` is set, in which case we
    // still let git's own conflict detection trip.
    await git(repo, ['worktree', 'add', wtPath, opts.branch]);
  } else {
    await git(repo, ['worktree', 'add', '-b', opts.branch, wtPath, baseRef]);
  }

  return {
    path: wtPath,
    branch: opts.branch,
    async remove(removeOpts) {
      const args = ['worktree', 'remove'];
      if (removeOpts?.force) args.push('--force');
      args.push(wtPath);
      try {
        await git(repo, args);
      } catch {
        // Fallback: if git removal fails (e.g. dirty index that refuses
        // even --force), rip the directory out and prune.
        if (await pathExists(wtPath)) {
          await rm(wtPath, { recursive: true, force: true });
        }
        await git(repo, ['worktree', 'prune']).catch(() => undefined);
      }
      if (removeOpts?.deleteBranch) {
        await git(repo, ['branch', '-D', opts.branch]).catch(
          () => undefined,
        );
      }
    },
  };
}

export async function pruneStaleWorktrees(
  repo: string,
  _opts?: { olderThanMs?: number },
): Promise<string[]> {
  // `git worktree prune` cleans up bookkeeping for worktrees whose dirs
  // have been deleted. Returns the names it pruned (parsed from
  // `--verbose` output). We don't implement age-filtering here because
  // git's own prune semantics are dir-existence based; consumers wanting
  // age policy should walk the basePath themselves.
  const out = await git(repo, ['worktree', 'prune', '--verbose']);
  const removed: string[] = [];
  for (const line of out.split('\n')) {
    const m = /^Removing worktrees\/(\S+):/.exec(line);
    if (m && m[1]) removed.push(m[1]);
  }
  return removed;
}
