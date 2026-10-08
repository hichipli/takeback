import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface Checkpoint {
  id: string
  time: Date
  label: string
  files: number
}

export interface TakeBack {
  to: Checkpoint
  /** The state right before the take back, so it can be brought back. */
  saved: string
  /** What the take back did: A came back, D was removed, M was reverted, K was kept because the checkpoint ignores it. */
  changes: [status: string, path: string][]
  /** Set when the project's own git branch or commit moved since the checkpoint, as "branch sha7". */
  git?: { then: string; now: string }
}

interface Store {
  root: string
  gitDir: string
  run: (args: string[], env?: Record<string, string>) => { status: number | null; stdout: string; stderr: string }
  git: (args: string[], env?: Record<string, string>) => string
}

// Never snapshot these, even in projects without a .gitignore.
const SKIP_DIRS = ['node_modules', '.venv', 'venv', '__pycache__']
const DEFAULT_EXCLUDES = [...SKIP_DIRS.map((d) => `${d}/`), '.DS_Store'].join('\n') + '\n'
// ponytail: fixed retention, the same as Claude Code's own checkpoints; make it configurable if anyone asks
export const KEEP_DAYS = 30
const DAY = 86_400_000

export const storeHome = () => process.env.TAKEBACK_HOME ?? join(homedir(), '.takeback')

// Drop GIT_* vars so a caller running inside a git hook can't redirect us to their repo.
function cleanEnv(extra: Record<string, string> = {}) {
  const env: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) env[k] = v
  return { ...env, ...extra }
}

const storeDir = (root: string) =>
  join(storeHome(), `${basename(root) || 'root'}-${createHash('sha256').update(root).digest('hex').slice(0, 12)}`)

/**
 * The folder a directory's checkpoints cover: its git toplevel. Outside git, the nearest folder above that
 * already has checkpoints, or else the directory itself.
 */
export function projectRoot(dir: string): string {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8', env: cleanEnv() })
  let root = r.status === 0 ? resolve(r.stdout.trim()) : realpathSync(dir)
  if (r.status !== 0) {
    for (let d = dirname(root); d !== dirname(d); d = dirname(d)) {
      if (existsSync(join(storeDir(d), 'HEAD'))) {
        root = d
        break
      }
    }
  }
  const rel = relative(root, homedir())
  if (!rel.startsWith('..') && !isAbsolute(rel)) {
    throw new Error(`refusing to snapshot ${root} (your home folder or above). Run takeback inside a project folder.`)
  }
  return root
}

function storeAt(root: string, gitDir: string): Store {
  const run: Store['run'] = (args, env) => {
    const r = spawnSync('git', ['--git-dir', gitDir, '--work-tree', root, ...args], {
      cwd: existsSync(root) ? root : gitDir, encoding: 'utf8', env: cleanEnv(env), maxBuffer: 1 << 30,
    })
    if (r.error) throw r.error
    return r
  }
  const git: Store['git'] = (args, env) => {
    const r = run(args, env)
    if (r.status !== 0) throw new Error(r.stderr.trim() || `git ${args[0]} exited with ${r.status}`)
    return r.stdout
  }
  return { root, gitDir, run, git }
}

function open(dir: string): Store {
  const root = projectRoot(dir)
  return storeAt(root, storeDir(root))
}

function init(s: Store) {
  if (existsSync(join(s.gitDir, 'HEAD'))) return
  mkdirSync(s.gitDir, { recursive: true })
  const r = spawnSync('git', ['init', '-q', '--bare', s.gitDir], { encoding: 'utf8', env: cleanEnv() })
  if (r.status !== 0) throw new Error(r.stderr.trim() || 'git init failed')
  const config: [string, string][] = [
    ['core.bare', 'false'],
    ['core.autocrlf', 'false'], // restore byte-for-byte
    ['core.logAllRefUpdates', 'false'], // a reflog would keep pruned checkpoints alive
    ['core.hooksPath', join(s.gitDir, 'hooks')], // ignore the user's global git hooks
    ['commit.gpgsign', 'false'],
    ['user.name', 'takeback'],
    ['user.email', 'takeback@localhost'],
    ['takeback.root', s.root], // lets `prune` find stores whose project is gone
  ]
  for (const [k, v] of config) s.git(['config', k, v])
  mkdirSync(join(s.gitDir, 'info'), { recursive: true })
  writeFileSync(join(s.gitDir, 'info', 'exclude'), DEFAULT_EXCLUDES)
  // Overrides the project's .gitattributes: no eol conversion, no LFS or other filters.
  writeFileSync(join(s.gitDir, 'info', 'attributes'), '* -text -filter -ident\n')
}

const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/** Hooks from several agents (and `watch`) can fire at once; serialize everything per store. */
function lock<T>(gitDir: string, fn: () => T): T {
  const path = `${gitDir}.lock`
  mkdirSync(dirname(path), { recursive: true })
  for (let i = 0; ; i++) {
    try {
      mkdirSync(path)
      break
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      // ponytail: age-based stale lock detection; a pid file would be exact if 30s ever proves too short
      try {
        if (Date.now() - statSync(path).mtimeMs > 30_000) rmSync(path, { recursive: true, force: true })
      } catch {}
      if (i > 300) throw new Error(`another takeback process is busy with this project (${path})`)
      sleep(50)
    }
  }
  try {
    // Holding our lock means no other takeback uses this store, so a git index.lock left here comes from a
    // killed process (an agent's hook timeout, say) and would otherwise block every later checkpoint.
    rmSync(join(gitDir, 'index.lock'), { force: true })
    return fn()
  } finally {
    rmSync(path, { recursive: true, force: true })
  }
}

const hasStore = (s: Store) => existsSync(join(s.gitDir, 'HEAD'))

/** Reading takes no lock and writes nothing to the store, so it also works inside an agent's sandbox. */
function readStore<T>(dir: string, fn: (s: Store) => T): T {
  const s = open(dir)
  if (!hasStore(s)) throw new Error(`No checkpoints for ${s.root} yet.`)
  return fn(s)
}

/** Only `save` creates a store; reading commands in a folder without checkpoints leave nothing behind. */
function withStore<T>(dir: string, fn: (s: Store) => T, create = false): T {
  const s = open(dir)
  if (!create && !hasStore(s)) throw new Error(`No checkpoints for ${s.root} yet.`)
  return lock(s.gitDir, () => {
    init(s)
    return fn(s)
  })
}

/** Agents also run in folders like ~/Downloads. Hooks don't start checkpointing a big folder that isn't a git repo. */
export const AUTO_LIMIT = { files: 5000, bytes: 500e6 }

export function tooBigToStart(dir: string, limit = AUTO_LIMIT): boolean {
  const s = open(dir)
  if (hasStore(s) || spawnSync('git', ['rev-parse', '--git-dir'], { cwd: s.root, env: cleanEnv() }).status === 0) return false
  let files = 0
  let bytes = 0
  for (const stack = [s.root]; stack.length; ) {
    const d = stack.pop()!
    let entries
    try {
      entries = readdirSync(d, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.includes(e.name) && e.name !== '.git') stack.push(join(d, e.name))
      } else if (e.isFile()) {
        if (++files > limit.files) return true
        try {
          bytes += statSync(join(d, e.name)).size
        } catch {}
        if (bytes > limit.bytes) return true
      }
    }
  }
  return false
}

const rev = (s: Store, ref: string) => {
  const r = s.run(['rev-parse', '--verify', '-q', `${ref}^{commit}`])
  return r.status === 0 ? r.stdout.trim() : null
}

function info(s: Store, id: string): Checkpoint {
  const [ct, label] = s.git(['log', '-1', '--format=%ct%x1f%s', id]).trim().split('\x1f')
  return { id, time: new Date(Number(ct) * 1000), label, files: 0 }
}

// Checkpoints record the project's git position, and take backs what they restored, in the commit body.
function trailers(s: Store, id: string) {
  const body = s.git(['log', '-1', '--format=%b', id])
  return {
    restored: /^Restored: ([0-9a-f]{40})$/m.exec(body)?.[1],
    partial: /^Paths: /m.test(body),
    git: /^Git: (\S+ [0-9a-f]{40})$/m.exec(body)?.[1],
  }
}

/** The project's own branch and commit as "branch sha", or null outside a git repo or before its first commit. */
function gitPosition(root: string): string | null {
  const r = spawnSync('git', ['rev-parse', 'HEAD', '--abbrev-ref', 'HEAD'], { cwd: root, encoding: 'utf8', env: cleanEnv() })
  const [sha, branch] = r.stdout.trim().split('\n')
  return r.status === 0 && sha && branch ? `${branch} ${sha}` : null
}

function commitIndex(s: Store, label: string): string | null {
  const head = rev(s, 'HEAD')
  if (head && s.run(['diff', '--cached', '--quiet', 'HEAD']).status === 0) return null
  const git = gitPosition(s.root)
  s.git(['commit', '-q', '--no-verify', '--allow-empty', '-m', label, ...(git ? ['-m', `Git: ${git}`] : [])])
  return rev(s, 'HEAD')
}

function commitIfChanged(s: Store, label: string): string | null {
  s.git(['add', '-A', '--ignore-errors'])
  return commitIndex(s, label)
}

/** Where the project's git moved between checkpoint `to` and now, if it did. */
function gitMoved(s: Store, to: string): TakeBack['git'] {
  const then = trailers(s, to).git
  const now = gitPosition(s.root)
  if (!then || !now || then === now) return undefined
  const brief = (p: string) => p.slice(0, p.length - 33) // "branch sha" with the sha cut to 7 characters
  return { then: brief(then), now: brief(now) }
}

/** Stage the files on disk into a throwaway index, so previews and diffs see them without saving a checkpoint. */
function withScratchIndex<T>(s: Store, fn: (env: Record<string, string>) => T): T {
  const scratch = mkdtempSync(join(tmpdir(), 'takeback-'))
  const index = join(scratch, 'index')
  // Keep the index's mtime: git rechecks files changed in the same second as the index only if it can tell.
  if (existsSync(join(s.gitDir, 'index'))) cpSync(join(s.gitDir, 'index'), index, { preserveTimestamps: true })
  try {
    // New objects land in the scratch folder too; the store's own are read through an alternate.
    const env = { GIT_INDEX_FILE: index, GIT_OBJECT_DIRECTORY: join(scratch, 'objects'), GIT_ALTERNATE_OBJECT_DIRECTORIES: join(s.gitDir, 'objects') }
    mkdirSync(env.GIT_OBJECT_DIRECTORY)
    s.git(['add', '-A', '--ignore-errors'], env)
    return fn(env)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

/** A path the user gave, relative to the project root as git wants it. */
function projectPath(s: Store, dir: string, p: string): string {
  const rel = relative(s.root, resolve(realpathSync(dir), p))
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`${p} is outside ${s.root}`)
  return rel.split(sep).join('/')
}

/**
 * Where a plain `takeback` goes: the latest checkpoint if there are unsaved changes, otherwise the one before.
 * Repeating a full take back keeps walking back; taking back single files never moves that position.
 */
function pickTarget(s: Store, head: string, unsaved: boolean, target?: string): string {
  let to: string | null
  if (target) to = rev(s, target)
  else if (unsaved) to = head
  else {
    let at = head
    for (let parent; trailers(s, at).partial && (parent = rev(s, `${at}^`)); ) at = parent
    to = rev(s, `${trailers(s, at).restored ?? at}^`)
  }
  if (!to) throw new Error(target ? `Unknown checkpoint: ${target}` : 'Nothing to take back: this is the oldest checkpoint.')
  return to
}

/**
 * Which of `paths` the checkpoint's own .gitignore files ignore. If an agent emptied .gitignore, .env got into
 * a checkpoint; going back to a checkpoint that ignores .env must leave the file alone, not delete it.
 */
function ignoredAt(s: Store, to: string, paths: string[]): Set<string> {
  if (!paths.length) return new Set()
  const dir = mkdtempSync(join(tmpdir(), 'takeback-ignore-'))
  try {
    for (const f of s.git(['ls-tree', '-r', '-z', '--name-only', to]).split('\0')) {
      if (!/(^|\/)\.gitignore$/.test(f)) continue
      mkdirSync(join(dir, dirname(f)), { recursive: true })
      writeFileSync(join(dir, f), s.git(['show', `${to}:${f}`]))
    }
    const r = spawnSync('git', ['--git-dir', s.gitDir, '--work-tree', dir, 'check-ignore', '--no-index', '-z', '--stdin'], {
      cwd: dir, input: paths.join('\0'), encoding: 'utf8', env: cleanEnv(),
    })
    return new Set(r.stdout.split('\0').filter(Boolean))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const nameStatus = (out: string) => {
  const f = out.split('\0')
  const pairs: [string, string][] = []
  for (let i = 0; i + 1 < f.length; i += 2) if (f[i]) pairs.push([f[i], f[i + 1]])
  return pairs
}

/** Changes from the current files to checkpoint `to`, with removals the checkpoint ignores marked K (kept). */
function plan(s: Store, to: string, scope: string[], env?: Record<string, string>): [string, string][] {
  const changes = nameStatus(s.git(['diff', '--cached', '-R', '--name-status', '--no-renames', '-z', to, ...scope], env))
  const kept = ignoredAt(s, to, changes.filter(([st]) => st === 'D').map(([, f]) => f))
  return changes.map(([st, f]) => [kept.has(f) ? 'K' : st, f])
}

/**
 * Forget checkpoints older than `days`, always keeping the newest. Marking the oldest kept checkpoint
 * as a shallow boundary (as `git clone --depth` does) cuts history without changing any ids;
 * git gc then deletes what is no longer reachable. Returns how many checkpoints were dropped.
 */
function cut(s: Store, days: number): number {
  const lines = s.run(['log', '--format=%H %ct']).stdout.trim().split('\n').filter(Boolean)
  const tooOld = lines.findIndex((l) => Number(l.split(' ')[1]) * 1000 < Date.now() - days * DAY)
  if (tooOld === -1) return 0
  const keep = Math.max(tooOld - 1, 0)
  if (keep === lines.length - 1) return 0
  writeFileSync(join(s.gitDir, 'shallow'), lines[keep].split(' ')[0] + '\n')
  rmSync(join(s.gitDir, 'logs'), { recursive: true, force: true }) // stores from 0.1.0 kept reflogs
  return lines.length - 1 - keep
}

/** Save a checkpoint of the project containing `dir`. Returns its id, or null if nothing changed. */
export function save(dir: string, label = 'manual save'): string | null {
  return withStore(dir, (s) => {
    const id = commitIfChanged(s, label)
    // Once a day, drop checkpoints past the retention window. git's own auto gc reclaims the space.
    const stamp = join(s.gitDir, 'takeback-retention')
    if (!existsSync(stamp) || Date.now() - statSync(stamp).mtimeMs > DAY) {
      cut(s, KEEP_DAYS)
      writeFileSync(stamp, '')
    }
    return id
  }, true)
}

/** Newest first. */
export function list(dir: string, limit = 20): Checkpoint[] {
  if (!hasStore(open(dir))) return []
  return readStore(dir, (s) => {
    if (!rev(s, 'HEAD')) return []
    const out = s.git(['log', `-n${limit}`, '--shortstat', '--format=%x1e%H%x1f%ct%x1f%s%x1f'])
    return out.split('\x1e').filter(Boolean).map((chunk) => {
      const [id, ct, label, stat] = chunk.split('\x1f')
      return { id, time: new Date(Number(ct) * 1000), label, files: Number(/(\d+) files? changed/.exec(stat)?.[1] ?? 0) }
    })
  })
}

/**
 * Restore the project, or just `paths`, to a checkpoint (by default where a plain `takeback` goes, see pickTarget).
 * The current state is always saved first, so a take back can itself be taken back, and files the checkpoint
 * ignores are never deleted. With `dryRun`, nothing changes: the result says what would happen.
 */
export function undo(dir: string, target?: string, paths: string[] = [], dryRun = false): TakeBack {
  const run = (s: Store): TakeBack => {
    const head = rev(s, 'HEAD')
    if (!head) throw new Error(`No checkpoints for ${s.root} yet.`)
    const rels = paths.map((p) => projectPath(s, dir, p))
    const scope = ['--', ...(rels.length ? rels.map((r) => (r ? `:(literal)${r}` : '.')) : ['.'])]

    if (dryRun) {
      return withScratchIndex(s, (env) => {
        const to = pickTarget(s, head, s.run(['diff', '--cached', '--quiet', 'HEAD'], env).status !== 0, target)
        return { to: info(s, to), saved: head, changes: plan(s, to, scope, env), git: gitMoved(s, to) }
      })
    }

    s.git(['add', '-A', '--ignore-errors'])
    const to = pickTarget(s, head, s.run(['diff', '--cached', '--quiet', 'HEAD']).status !== 0, target)
    // Files the restore will overwrite that the index doesn't hold, because they're ignored right now,
    // go into the safety checkpoint too. Nothing on disk is lost.
    const tracked = new Set(s.git(['ls-files', '-z']).split('\0'))
    const atRisk = s.git(['ls-tree', '-r', '-z', '--name-only', to, '--', ...rels.filter(Boolean)]).split('\0')
      .filter((f) => f && !tracked.has(f) && existsSync(join(s.root, f)))
    if (atRisk.length) s.git(['add', '-f', '--', ...atRisk.map((f) => `:(literal)${f}`)])
    const before = commitIndex(s, 'saved before takeback') ?? head

    const changes = plan(s, to, scope)
    const r = s.run(['restore', `--source=${to}`, '--staged', '--worktree', ...scope])
    if (r.status !== 0) {
      throw new Error(/did not match/.test(r.stderr) ? `${paths.join(', ')} never appears in checkpoint ${to.slice(0, 7)}.` : r.stderr.trim())
    }
    const kept = changes.filter(([st]) => st === 'K').map(([, f]) => `:(literal)${f}`)
    if (kept.length) s.git(['restore', `--source=${before}`, '--worktree', '--', ...kept])
    if (changes.length || !paths.length) {
      const what = paths.length ? `${paths.join(', ')} ` : ''
      const body = [`Restored: ${to}`, ...(paths.length ? [`Paths: ${paths.join(' ')}`] : [])].join('\n')
      s.git(['commit', '-q', '--no-verify', '--allow-empty', '-m', `takeback ${what}to ${to.slice(0, 7)}`, '-m', body])
    }
    return { to: info(s, to), saved: before, changes, git: gitMoved(s, to) }
  }
  return dryRun ? readStore(dir, run) : withStore(dir, run)
}

/**
 * Patch from checkpoint `from` to checkpoint `to`, or to the files on disk now. Without `from`, it shows
 * what a plain `takeback` would undo: usually the agent's last turn.
 */
export function diff(dir: string, from?: string, to?: string, flags: string[] = []): { from: Checkpoint; patch: string } {
  return readStore(dir, (s) => {
    const head = rev(s, 'HEAD')
    if (!head) throw new Error(`No checkpoints for ${s.root} yet.`)
    const resolved = (ref: string) => {
      const id = rev(s, ref)
      if (!id) throw new Error(`Unknown checkpoint: ${ref}`)
      return id
    }
    if (from && to) {
      const a = resolved(from)
      return { from: info(s, a), patch: s.git(['diff', ...flags, a, resolved(to)]) }
    }
    return withScratchIndex(s, (env) => {
      const a = from ? resolved(from) : pickTarget(s, head, s.run(['diff', '--cached', '--quiet', 'HEAD'], env).status !== 0)
      return { from: info(s, a), patch: s.git(['diff', '--cached', ...flags, a], env) }
    })
  })
}

/** A file exactly as it was at a checkpoint, to read an old version without restoring anything. */
export function show(dir: string, id: string, path: string): Buffer {
  return readStore(dir, (s) => {
    const at = rev(s, id)
    if (!at) throw new Error(`Unknown checkpoint: ${id}`)
    const r = spawnSync('git', ['--git-dir', s.gitDir, 'show', `${at}:${projectPath(s, dir, path)}`], { env: cleanEnv(), maxBuffer: 1 << 30 })
    if (r.status !== 0) throw new Error(`${path} isn't in checkpoint ${at.slice(0, 7)}.`)
    return r.stdout
  })
}

const size = (dir: string) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .reduce((n, e) => (e.isFile() ? n + statSync(join(e.parentPath, e.name)).size : n), 0)

export interface Pruned { project: string; dropped: number; freed: number; gone: boolean }

/** For every project: drop checkpoints older than `days` and reclaim the space. Stores of deleted folders are removed. */
export function prune(days = KEEP_DAYS): Pruned[] {
  const home = storeHome()
  if (!existsSync(home)) return []
  return readdirSync(home, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(home, d.name, 'HEAD')))
    .map((d) => {
      const gitDir = join(home, d.name)
      const before = size(gitDir)
      const root = spawnSync('git', ['--git-dir', gitDir, 'config', 'takeback.root'], { encoding: 'utf8', env: cleanEnv() }).stdout.trim()
      if (root && !existsSync(root)) {
        rmSync(gitDir, { recursive: true, force: true })
        return { project: root, dropped: 0, freed: before, gone: true }
      }
      return lock(gitDir, () => {
        const s = storeAt(root || gitDir, gitDir) // stores from 0.1.0 don't record their project
        const dropped = cut(s, days)
        s.git(['gc', '--prune=now', '--quiet'])
        return { project: root || d.name, dropped, freed: before - size(gitDir), gone: false }
      })
    })
}

// ---- agent hooks -----------------------------------------------------------

export type Agent = 'claude' | 'codex'
export const AGENTS: Agent[] = ['claude', 'codex']

/** Where an agent reads hooks from. Both use the same `{ hooks: { Event: [{ hooks: [...] }] } }` schema. */
export function hookFile(agent: Agent, scope: 'global' | 'project', cwd = process.cwd()): string {
  if (agent === 'claude') {
    return scope === 'global'
      ? join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'settings.json')
      : join(cwd, '.claude', 'settings.local.json')
  }
  return join(scope === 'global' ? (process.env.CODEX_HOME ?? join(homedir(), '.codex')) : join(cwd, '.codex'), 'hooks.json')
}

/**
 * Copy takeback itself into ~/.takeback/app so hooks start in ~0.1s without a global install
 * (going through npx costs ~0.75s per prompt). Returns the command hooks should run.
 */
export function installApp(): string {
  const here = dirname(fileURLToPath(import.meta.url)) // dist/ (or src/ when run from source)
  const app = join(storeHome(), 'app')
  rmSync(app, { recursive: true, force: true })
  mkdirSync(join(app, 'dist'), { recursive: true })
  for (const f of readdirSync(here)) if (/\.(js|ts)$/.test(f)) copyFileSync(join(here, f), join(app, 'dist', f))
  copyFileSync(join(here, '..', 'package.json'), join(app, 'package.json'))
  const cli = join(app, 'dist', existsSync(join(here, 'cli.js')) ? 'cli.js' : 'cli.ts')
  return `node "${cli}"`
}

interface HookGroup { matcher?: string; hooks?: { type?: string; command?: string; timeout?: number; statusMessage?: string }[] }
const isOurs = (g: HookGroup) => g.hooks?.some((h) => /\bsave --hook (claude|codex)\b/.test(h.command ?? ''))

/**
 * Add (or with `remove`, delete) takeback's checkpoint hooks in an agent's hook file,
 * keeping everything else in it. Returns whether the file changed.
 */
export function installHooks(file: string, command: string, remove = false): boolean {
  const before = existsSync(file) ? readFileSync(file, 'utf8') : ''
  let cfg: { hooks?: Record<string, HookGroup[]> } & Record<string, unknown>
  try {
    cfg = before.trim() ? JSON.parse(before) : {}
  } catch {
    throw new Error(`${file} is not valid JSON; fix it first (takeback won't overwrite it).`)
  }
  const hooks = (cfg.hooks ??= {})
  for (const event of ['UserPromptSubmit', 'Stop']) {
    const groups = (hooks[event] ?? []).filter((g) => !isOurs(g))
    if (!remove) groups.push({ hooks: [{ type: 'command', command, timeout: 30, statusMessage: 'Saving a takeback checkpoint' }] })
    if (groups.length) hooks[event] = groups
    else delete hooks[event]
  }
  if (!Object.keys(hooks).length) delete cfg.hooks
  const after = JSON.stringify(cfg, null, 2) + '\n'
  if (after === before || (!before && remove)) return false
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, after)
  return true
}
