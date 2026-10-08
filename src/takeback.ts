import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
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
  /** What the take back did, as git name-status pairs: A came back, D was removed, M was reverted. */
  changes: [status: string, path: string][]
}

interface Store {
  root: string
  gitDir: string
  run: (args: string[], env?: Record<string, string>) => { status: number | null; stdout: string; stderr: string }
  git: (args: string[], env?: Record<string, string>) => string
}

// Never snapshot these, even in projects without a .gitignore.
const DEFAULT_EXCLUDES = ['node_modules/', '.venv/', 'venv/', '__pycache__/', '.DS_Store'].join('\n') + '\n'
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

/** The folder a directory's checkpoints cover: its git toplevel, or the directory itself. */
export function projectRoot(dir: string): string {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8', env: cleanEnv() })
  const root = r.status === 0 ? resolve(r.stdout.trim()) : realpathSync(dir)
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
  const hash = createHash('sha256').update(root).digest('hex').slice(0, 12)
  return storeAt(root, join(storeHome(), `${basename(root) || 'root'}-${hash}`))
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
    return fn()
  } finally {
    rmSync(path, { recursive: true, force: true })
  }
}

function withStore<T>(dir: string, fn: (s: Store) => T): T {
  const s = open(dir)
  return lock(s.gitDir, () => {
    init(s)
    return fn(s)
  })
}

const rev = (s: Store, ref: string) => {
  const r = s.run(['rev-parse', '--verify', '-q', `${ref}^{commit}`])
  return r.status === 0 ? r.stdout.trim() : null
}

function info(s: Store, id: string): Checkpoint {
  const [ct, label] = s.git(['log', '-1', '--format=%ct%x1f%s', id]).trim().split('\x1f')
  return { id, time: new Date(Number(ct) * 1000), label, files: 0 }
}

// Take backs record what they restored in the commit body.
function trailers(s: Store, id: string) {
  const body = s.git(['log', '-1', '--format=%b', id])
  return { restored: /^Restored: ([0-9a-f]{40})$/m.exec(body)?.[1], partial: /^Paths: /m.test(body) }
}

function commitIfChanged(s: Store, label: string): string | null {
  s.git(['add', '-A', '--ignore-errors'])
  const head = rev(s, 'HEAD')
  if (head && s.run(['diff', '--cached', '--quiet', 'HEAD']).status === 0) return null
  s.git(['commit', '-q', '--no-verify', '--allow-empty', '-m', label])
  return rev(s, 'HEAD')
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
  })
}

/** Newest first. */
export function list(dir: string, limit = 20): Checkpoint[] {
  return withStore(dir, (s) => {
    if (!rev(s, 'HEAD')) return []
    const out = s.git(['log', `-n${limit}`, '--shortstat', '--format=%x1e%H%x1f%ct%x1f%s%x1f'])
    return out.split('\x1e').filter(Boolean).map((chunk) => {
      const [id, ct, label, stat] = chunk.split('\x1f')
      return { id, time: new Date(Number(ct) * 1000), label, files: Number(/(\d+) files? changed/.exec(stat)?.[1] ?? 0) }
    })
  })
}

/**
 * Restore the project, or just `paths`, to a checkpoint. Without a target, take back the most recent
 * change: unsaved edits if there are any, otherwise the last checkpoint. Repeating a full take back
 * keeps walking back; taking back single files never moves that position.
 * The current state is always saved first, so a take back can itself be taken back.
 */
export function undo(dir: string, target?: string, paths: string[] = []): TakeBack {
  return withStore(dir, (s) => {
    const head = rev(s, 'HEAD')
    if (!head) throw new Error('No checkpoints yet. Run `takeback init` (Claude Code, Codex) or `takeback watch` first.')
    const base = realpathSync(dir)
    const specs = paths.map((p) => {
      const rel = relative(s.root, resolve(base, p))
      if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`${p} is outside ${s.root}`)
      return rel ? `:(literal)${rel.split(sep).join('/')}` : '.'
    })
    const saved = commitIfChanged(s, 'saved before takeback')

    let to: string | null
    if (target) to = rev(s, target)
    else if (saved) to = head
    else {
      let at = head
      for (let parent; trailers(s, at).partial && (parent = rev(s, `${at}^`)); ) at = parent
      to = rev(s, `${trailers(s, at).restored ?? at}^`)
    }
    if (!to) throw new Error(target ? `Unknown checkpoint: ${target}` : 'Nothing to take back: this is the oldest checkpoint.')

    const r = s.run(['restore', `--source=${to}`, '--staged', '--worktree', '--', ...(specs.length ? specs : ['.'])])
    if (r.status !== 0) {
      throw new Error(/did not match/.test(r.stderr) ? `${paths.join(', ')} never appears in checkpoint ${to.slice(0, 7)}.` : r.stderr.trim())
    }
    const before = saved ?? head
    const changes = s.git(['diff', '--cached', '--name-status', '--no-renames', before])
      .trim().split('\n').filter(Boolean).map((l) => l.split('\t') as [string, string])
    if (changes.length || !paths.length) {
      const what = paths.length ? `${paths.join(', ')} ` : ''
      const body = [`Restored: ${to}`, ...(paths.length ? [`Paths: ${paths.join(' ')}`] : [])].join('\n')
      s.git(['commit', '-q', '--no-verify', '--allow-empty', '-m', `takeback ${what}to ${to.slice(0, 7)}`, '-m', body])
    }
    return { to: info(s, to), saved: before, changes }
  })
}

/** Patch from checkpoint `from` (default: latest) to checkpoint `to` (default: the files on disk now). */
export function diff(dir: string, from = 'HEAD', to?: string, flags: string[] = []): string {
  return withStore(dir, (s) => {
    const a = rev(s, from)
    if (!a) throw new Error(`Unknown checkpoint: ${from}`)
    if (to) {
      const b = rev(s, to)
      if (!b) throw new Error(`Unknown checkpoint: ${to}`)
      return s.git(['diff', ...flags, a, b])
    }
    // Stage the working tree into a throwaway index so untracked files show up too.
    const index = join(tmpdir(), `takeback-index-${process.pid}-${Date.now()}`)
    if (existsSync(join(s.gitDir, 'index'))) copyFileSync(join(s.gitDir, 'index'), index)
    try {
      const env = { GIT_INDEX_FILE: index }
      s.git(['add', '-A', '--ignore-errors'], env)
      return s.git(['diff', '--cached', ...flags, a], env)
    } finally {
      rmSync(index, { force: true })
    }
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

interface HookGroup { matcher?: string; hooks?: { type?: string; command?: string; timeout?: number }[] }
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
    if (!remove) groups.push({ hooks: [{ type: 'command', command, timeout: 30 }] })
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
