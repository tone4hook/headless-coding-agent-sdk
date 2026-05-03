import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorktree } from '../src/worktree/index.js';

const execFileP = promisify(execFile);

async function git(repo: string, args: string[]): Promise<string> {
  const { stdout } = await execFileP('git', args, { cwd: repo });
  return stdout;
}

async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'hca-wt-'));
  await git(dir, ['init', '-q', '-b', 'main']);
  await git(dir, ['config', 'user.email', 't@t']);
  await git(dir, ['config', 'user.name', 'T']);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'README.md'), 'hi\n');
  await git(dir, ['add', '.']);
  await git(dir, ['commit', '-q', '-m', 'init']);
  return dir;
}

describe('createWorktree', () => {
  let repo: string;

  beforeEach(async () => {
    repo = await makeRepo();
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true }).catch(() => undefined);
  });

  it('creates a worktree on a new branch', async () => {
    const wt = await createWorktree({ repo, branch: 'feature/x' });
    expect(wt.branch).toBe('feature/x');
    const out = await git(repo, ['worktree', 'list', '--porcelain']);
    expect(out).toContain(wt.path);
    await wt.remove();
  });

  it('removes the worktree on remove()', async () => {
    const wt = await createWorktree({ repo, branch: 'feature/y' });
    await wt.remove();
    const out = await git(repo, ['worktree', 'list', '--porcelain']);
    expect(out).not.toContain(wt.path);
  });

  it('checks out an existing branch', async () => {
    await git(repo, ['branch', 'feature/z']);
    const wt = await createWorktree({ repo, branch: 'feature/z' });
    expect(wt.branch).toBe('feature/z');
    await wt.remove();
  });

  it('deleteBranch: true removes the branch on remove()', async () => {
    const wt = await createWorktree({ repo, branch: 'feature/del' });
    await wt.remove({ deleteBranch: true });
    let exists = true;
    try {
      await git(repo, ['rev-parse', '--verify', 'refs/heads/feature/del']);
    } catch {
      exists = false;
    }
    expect(exists).toBe(false);
  });
});
