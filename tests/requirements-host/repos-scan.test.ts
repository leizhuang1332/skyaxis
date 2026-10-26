/**
 * repos/ scanning (reverse-link discovery): the pure scanner over real temp
 * directories (normal / detached / worktree-pointer / non-git / oversized),
 * plus the endpoint faces — GET ?scan=1 facts and POST adopt (ledger row from
 * the host-read branch, no clone spawned, inline rejections before any
 * write). Adopt runs with NO subprocess service at all: proof that the
 * reverse-link path never depends on git being installed.
 */
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { afterEach, describe, expect, it } from 'vitest'
import type { ErrorResponse, ListResponse, ReposScanResponseOk } from '../../src/requirements-shared/protocol.js'
import { REQUIREMENTS_LIST_PATH, REQUIREMENTS_REPOS_PATH, REQUIREMENTS_SAVE_PATH, REQUIREMENTS_WORKSPACE_PATH } from '../../src/requirements-shared/protocol.js'
import { registerRequirementsReposEndpoints } from '../../src/requirements-host/repos-endpoint.js'
import { registerRequirementsEndpoints } from '../../src/requirements-host/endpoint.js'
import { scanRepoDirs } from '../../src/requirements-host/repos-scan.js'
import { repoDirName } from '../../src/requirements-shared/repo-dir.js'
import { RequirementsFileStore } from '../../src/requirements-host/requirements-file.js'
import { CloneTaskRegistry } from '../../src/requirements-host/clone.js'
import { RequirementWorkspaceBinder } from '../../src/requirements-host/workspace.js'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

/** Lays a readable .git/HEAD (+ optional origin config) into a directory. */
function makeRepo(dir: string, head: string, originUrl?: string): void {
  const gitDir = join(dir, '.git')
  mkdirSync(gitDir, { recursive: true })
  writeFileSync(join(gitDir, 'HEAD'), head, 'utf8')
  if (originUrl !== undefined) {
    writeFileSync(join(gitDir, 'config'), [
      '[core]',
      '\trepositoryformatversion = 0',
      '[remote "origin"]',
      `\turl = ${originUrl}`,
      '\tfetch = +refs/heads/*:refs/remotes/origin/*',
      '[branch "main"]',
      '\tremote = origin',
      '\tmerge = refs/heads/main',
      '',
    ].join('\n'), 'utf8')
  }
}

describe('scanRepoDirs (pure scanner)', () => {
  it('reads branch and origin url per directory and skips non-git entries', () => {
    const root = mkdtempSync(join(tmpdir(), 'repos-scan-test-'))
    dirs.push(root)
    const repos = join(root, 'repos')
    mkdirSync(repos)
    makeRepo(join(repos, 'My-Repo'), 'ref: refs/heads/feature-x\n', 'git@example.com:org/my-repo.git')
    mkdirSync(join(repos, 'plain-dir'))
    makeRepo(join(repos, 'detached'), '0123456789abcdef0123456789abcdef01234567\n')
    writeFileSync(join(repos, 'a-file'), 'x', 'utf8')

    const rows = scanRepoDirs(repos)
    expect(rows.map((row) => row.name)).toEqual(['My-Repo', 'detached', 'plain-dir']) // sorted; file skipped
    expect(rows[0]).toMatchObject({ isGitRepo: true, branch: 'feature-x', remoteUrl: 'git@example.com:org/my-repo.git' })
    expect(rows[1]).toMatchObject({ isGitRepo: true }) // detached: repo, but no branch
    expect(rows[1]?.branch).toBeUndefined()
    expect(rows[1]?.remoteUrl).toBeUndefined()
    expect(rows[2]).toEqual({ name: 'plain-dir', isGitRepo: false }) // listed, not adoptable
  })

  it('follows a worktree-style .git pointer file exactly one hop', () => {
    const root = mkdtempSync(join(tmpdir(), 'repos-scan-test-'))
    dirs.push(root)
    const repos = join(root, 'repos')
    const real = join(root, 'elsewhere', 'wt-git')
    mkdirSync(repos)
    mkdirSync(real, { recursive: true })
    writeFileSync(join(real, 'HEAD'), 'ref: refs/heads/wt-branch\n', 'utf8')
    writeFileSync(join(real, 'config'), '[remote "origin"]\n\turl = https://example.com/org/wt.git\n', 'utf8')
    const wtDir = join(repos, 'wt')
    mkdirSync(wtDir)
    writeFileSync(join(wtDir, '.git'), `gitdir: ${real}\n`, 'utf8')

    expect(scanRepoDirs(repos)).toEqual([
      { name: 'wt', isGitRepo: true, branch: 'wt-branch', remoteUrl: 'https://example.com/org/wt.git' },
    ])
  })

  it('treats oversized HEAD/config and a missing repos/ as absent facts', () => {
    const root = mkdtempSync(join(tmpdir(), 'repos-scan-test-'))
    dirs.push(root)
    const repos = join(root, 'repos')
    mkdirSync(repos)
    const big = join(repos, 'big')
    makeRepo(big, 'ref: refs/heads/main\n')
    writeFileSync(join(big, '.git', 'HEAD'), 'x'.repeat(4097), 'utf8') // over the HEAD cap

    const bigCfg = join(repos, 'bigcfg')
    makeRepo(bigCfg, 'ref: refs/heads/main\n', 'https://example.com/org/x.git')
    writeFileSync(join(bigCfg, '.git', 'config'), `[remote "origin"]\n\turl = ${'x'.repeat(70_000)}\n`, 'utf8') // over the config cap

    expect(scanRepoDirs(repos)).toEqual([
      { name: 'big', isGitRepo: true }, // branch refused, repo kept
      { name: 'bigcfg', isGitRepo: true, branch: 'main' }, // url refused, branch kept
    ])
    expect(scanRepoDirs(join(root, 'no-such-repos'))).toEqual([])
  })
})

describe('repoDirName dot-segment guard (sandbox escape)', () => {
  const SEED = '22222222-2222-4222-8222-222222222222'

  it('pure dot runs fall back; mixed dot names stay', () => {
    // join(ws, 'repos', '..') === ws — these must never come out of the derivation.
    expect(repoDirName('.', SEED)).toBe('repo-22222222')
    expect(repoDirName('..', SEED)).toBe('repo-22222222')
    expect(repoDirName('...', SEED)).toBe('repo-22222222')
    // Whitespace folds to dashes first, so this lands as a literal (harmless)
    // mixed name rather than a pure dot run.
    expect(repoDirName(' . .. ', SEED)).toBe('.-..')
    // Legal mixed names are untouched.
    expect(repoDirName('.hidden', SEED)).toBe('.hidden')
    expect(repoDirName('a..b', SEED)).toBe('a..b')
    expect(repoDirName('my repo', SEED)).toBe('my-repo')
  })
})

describe('requirements endpoints: repos scan & adopt', () => {
  const REPO_ID = '22222222-2222-4222-8222-222222222222'
  const SAVE_BODY = { expectedRevision: 0, requirement: { title: 'alpha', description: '' } }

  async function harness() {
    const dir = mkdtempSync(join(tmpdir(), 'requirements-adopt-test-'))
    dirs.push(dir)
    const file = new RequirementsFileStore(join(dir, 'requirements.yaml'))
    const workspaces = new RequirementWorkspaceBinder()
    const clones = new CloneTaskRegistry() // no subprocess: adopt must not need one
    const ctx = new Context()
    const fiber = ctx.plugin((pluginCtx) => {
      new HostConnectionService(pluginCtx, [], {} as never)
    })
    await fiber.await()
    const connection = ctx.get('connection') as HostConnectionHandle
    registerRequirementsEndpoints(connection, { file, workspaces })
    registerRequirementsReposEndpoints(connection, { file, clones })
    const shared = connection.createSharedFetchHandler('/api')
// 0.2.1-rc.3（0033）：fetch(request, peer) 双参——owner peer 放行（dsh fetch-routes 测试同款夹具）。
const ownerPeer = connection.createPeer({ principal: { kind: 'owner' } })
const fetchAs = (request: Request) => shared.fetch(request, ownerPeer)
    const base = 'http://127.0.0.1'
    const get = (path: string) => fetchAs(new Request(base + path, {}))
    const post = (path: string, body: unknown) =>
      fetchAs(new Request(base + path, { method: 'POST', body: JSON.stringify(body) }))
    return { file, dir, clones, get, post, dispose: () => fiber.dispose() }
  }

  /** Requirement + bound workspace; returns the requirement id. */
  async function setup(h: Awaited<ReturnType<typeof harness>>): Promise<string> {
    const created = await (await h.post(REQUIREMENTS_SAVE_PATH, SAVE_BODY)).json() as { requirement: { id: string } }
    const ws = join(h.dir, 'ws')
    mkdirSync(join(ws, 'repos'), { recursive: true })
    await h.post(REQUIREMENTS_WORKSPACE_PATH, { expectedRevision: 1, id: created.requirement.id, action: 'set', path: ws })
    return created.requirement.id
  }

  const ADOPT = (id: string, expectedRevision: number, overrides?: Partial<{ repoId: string; repoName: string }>) => ({
    expectedRevision,
    id,
    action: 'adopt',
    repoId: overrides?.repoId ?? REPO_ID,
    repoName: overrides?.repoName ?? 'My Repo',
  })

  it('GET ?scan=1 answers raw directory facts', async () => {
    const h = await harness()
    const id = await setup(h)
    makeRepo(join(h.dir, 'ws', 'repos', 'My-Repo'), 'ref: refs/heads/main\n', 'git@example.com:org/my-repo.git')
    const res = await h.get(`${REQUIREMENTS_REPOS_PATH}?id=${id}&scan=1`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ReposScanResponseOk
    expect(body.dirs).toEqual([{ name: 'My-Repo', isGitRepo: true, branch: 'main', remoteUrl: 'git@example.com:org/my-repo.git' }])
    await h.dispose()
  })

  it('GET ?scan=1: missing repos/ is an empty listing; ghost id 404; no id 400; unbound 400 no-workspace', async () => {
    const h = await harness()
    const id = await setup(h)
    const empty = await h.get(`${REQUIREMENTS_REPOS_PATH}?id=${id}&scan=1`)
    expect(((await empty.json()) as ReposScanResponseOk).dirs).toEqual([])

    const ghost = await h.get(`${REQUIREMENTS_REPOS_PATH}?id=00000000-0000-4000-8000-000000000000&scan=1`)
    expect(ghost.status).toBe(404)
    const noId = await h.get(`${REQUIREMENTS_REPOS_PATH}?scan=1`)
    expect(noId.status).toBe(400)

    const created = await (await h.post(REQUIREMENTS_SAVE_PATH, { ...SAVE_BODY, expectedRevision: 2 })).json() as { requirement: { id: string } }
    const unbound = await h.get(`${REQUIREMENTS_REPOS_PATH}?id=${created.requirement.id}&scan=1`)
    expect(unbound.status).toBe(400)
    expect(((await unbound.json()) as ErrorResponse).code).toBe('no-workspace')
    await h.dispose()
  })

  it('adopt writes the ledger row with the host-read branch and spawns no task', async () => {
    const h = await harness()
    const id = await setup(h)
    // The ledgered branch is what HEAD says (main), NOT any client-side guess.
    makeRepo(join(h.dir, 'ws', 'repos', 'My-Repo'), 'ref: refs/heads/main\n')
    const res = await h.post(REQUIREMENTS_REPOS_PATH, ADOPT(id, 2))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: true; revision: number; requirement: { linkedRepos: Array<{ repoId: string; branch: string }> }; tasks: unknown[] }
    expect(body.requirement.linkedRepos).toEqual([{ repoId: REPO_ID, branch: 'main' }])
    expect(body.revision).toBe(3)
    expect(body.tasks).toEqual([]) // no clone task — the directory IS the adoption

    const listed = await (await h.get(REQUIREMENTS_LIST_PATH)).json() as ListResponse
    expect(listed.ok && listed.requirements[0]?.linkedRepos).toEqual([{ repoId: REPO_ID, branch: 'main' }])
    await h.dispose()
  })

  it('adopt rejections leave the ledger untouched: missing dir, non-git, detached', async () => {
    const h = await harness()
    const id = await setup(h)

    const missing = await h.post(REQUIREMENTS_REPOS_PATH, ADOPT(id, 2))
    expect(missing.status).toBe(400)
    expect(((await missing.json()) as ErrorResponse).code).toBe('dest-missing')

    const plain = join(h.dir, 'ws', 'repos', 'My-Repo')
    mkdirSync(plain, { recursive: true })
    const nonGit = await h.post(REQUIREMENTS_REPOS_PATH, ADOPT(id, 2))
    expect(nonGit.status).toBe(400)
    expect(((await nonGit.json()) as ErrorResponse).code).toBe('no-branch')

    rmSync(plain, { recursive: true, force: true })
    makeRepo(plain, '0123456789abcdef0123456789abcdef01234567\n') // detached HEAD
    const detached = await h.post(REQUIREMENTS_REPOS_PATH, ADOPT(id, 2))
    expect(detached.status).toBe(400)
    expect(((await detached.json()) as ErrorResponse).code).toBe('no-branch')

    const listed = await (await h.get(REQUIREMENTS_LIST_PATH)).json() as ListResponse
    expect(listed.ok && listed.requirements[0]?.linkedRepos).toEqual([])
    expect(listed.ok && listed.revision).toBe(2) // workspace-set only — no adopt write landed
    await h.dispose()
  })

  it('adopt of a dot-segment name probes the fallback dir — never outside repos/', async () => {
    const h = await harness()
    const id = await setup(h)
    // The trap: a git-checked-out workspace ROOT — the path join(ws,'repos','..')
    // would normalize to it without the dot-segment guard in repoDirName.
    makeRepo(join(h.dir, 'ws'), 'ref: refs/heads/main\n')
    const res = await h.post(REQUIREMENTS_REPOS_PATH, ADOPT(id, 2, { repoName: '..' }))
    expect(res.status).toBe(400)
    expect(((await res.json()) as ErrorResponse).code).toBe('dest-missing')
    const listed = await (await h.get(REQUIREMENTS_LIST_PATH)).json() as ListResponse
    expect(listed.ok && listed.requirements[0]?.linkedRepos).toEqual([])
    // The workspace root (and its .git) stands untouched.
    expect(statSync(join(h.dir, 'ws', '.git', 'HEAD'), { throwIfNoEntry: false })).toBeDefined()
    await h.dispose()
  })

  it('adopt rejects branches the ledger cannot hold (>100 chars) before any write', async () => {
    const h = await harness()
    const id = await setup(h)
    makeRepo(join(h.dir, 'ws', 'repos', 'My-Repo'), `ref: refs/heads/${'b'.repeat(101)}\n`)
    const res = await h.post(REQUIREMENTS_REPOS_PATH, ADOPT(id, 2))
    expect(res.status).toBe(400)
    expect(((await res.json()) as ErrorResponse).code).toBe('invalid-branch')
    // No row landed — the file must never degrade on the next load.
    const listed = await (await h.get(REQUIREMENTS_LIST_PATH)).json() as ListResponse
    expect(listed.ok && listed.requirements[0]?.linkedRepos).toEqual([])
    expect(listed.ok && listed.revision).toBe(2)
    await h.dispose()
  })

  it('adopt rejects duplicates and stale revisions, and 404s ghost ids', async () => {
    const h = await harness()
    const id = await setup(h)
    makeRepo(join(h.dir, 'ws', 'repos', 'My-Repo'), 'ref: refs/heads/main\n')
    await h.post(REQUIREMENTS_REPOS_PATH, ADOPT(id, 2))

    const duplicate = await h.post(REQUIREMENTS_REPOS_PATH, ADOPT(id, 3))
    expect(duplicate.status).toBe(400)
    expect(((await duplicate.json()) as ErrorResponse).code).toBe('bad-request')

    const stale = await h.post(REQUIREMENTS_REPOS_PATH, ADOPT(id, 1, { repoId: '33333333-3333-4333-8333-333333333333' }))
    expect(stale.status).toBe(409)

    const ghost = await h.post(REQUIREMENTS_REPOS_PATH, ADOPT('00000000-0000-4000-8000-000000000000', 3))
    expect(ghost.status).toBe(404)

    // A repo whose name derives the SAME dirName still adopts when its own
    // directory is there (dirName is the identity key, not the name string).
    makeRepo(join(h.dir, 'ws', 'repos', 'Other-Repo'), 'ref: refs/heads/dev\n')
    const other = await h.post(REQUIREMENTS_REPOS_PATH, ADOPT(id, 3, { repoId: '33333333-3333-4333-8333-333333333333', repoName: 'Other Repo' }))
    expect(other.status).toBe(200)
    const body = (await other.json()) as { requirement: { linkedRepos: Array<{ repoId: string; branch: string }> } }
    expect(body.requirement.linkedRepos).toEqual([
      { repoId: REPO_ID, branch: 'main' },
      { repoId: '33333333-3333-4333-8333-333333333333', branch: 'dev' },
    ])
    await h.dispose()
  })
})
