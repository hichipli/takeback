import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

export interface Checkpoint {
  id: string
  time: Date
  label: string
  files: number
  /** Set on checkpoints created by a take back: the checkpoint that was restored. */
  restored?: string
}

interface Store {
  root: string
  gitDir: string
  run: (args: string[], env?: Record<string, string>) => { status: number | null; stdout: string; stderr: string }
  git: (args: string[], env?: Record<string, string>) => string
}

// Never snapshot these, even in projects without a .gitignore.
const DEFAULT_EXCLUDES = ['node_modules/', '.venv/', 'venv/', '__pycache__/', '.DS_Store'].join('\n') + '\n'

const storeHome = () => process.env.TAKEBACK_HOME ?? join(homedir(), '.takeback')

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

function open(dir: string): Store {
  const root = projectRoot(dir)
  const hash = createHash('sha256').update(root).digest('hex').slice(0, 12)
  const gitDir = join(storeHome(), `${basename(root) || 'root'}-${hash}`)
  const run: Store['run'] = (args, env) => {
    const r = spawnSync('git', ['--git-dir', gitDir, '--work-tree', root, ...args], {
      cwd: root, encoding: 'utf8', env: cleanEnv(env), maxBuffer: 1 << 30,
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

function init(s: Store) {
  if (existsSync(join(s.gitDir, 'HEAD'))) return
  mkdirSync(s.gitDir, { recursive: true })
  const r = spawnSync('git', ['init', '-q', '--bare', s.gitDir], { encoding: 'utf8', env: cleanEnv() })
  if (r.status !== 0) throw new Error(r.stderr.trim() || 'git init failed')
  const config: [string, string][] = [
    ['core.bare', 'false'],
    ['core.autocrlf', 'false'], // restore byte-for-byte
    ['core.hooksPath', join(s.gitDir, 'hooks')], // ignore the user's global git hooks
    ['commit.gpgsign', 'false'],
    ['user.name', 'takeback'],
    ['user.email', 'takeback@localhost'],
  ]
  for (const [k, v] of config) s.git(['config', k, v])
  mkdirSync(join(s.gitDir, 'info'), { recursive: true })
  writeFileSync(join(s.gitDir, 'info', 'exclude'), DEFAULT_EXCLUDES)
  // Overrides the project's .gitattributes: no eol conversion, no LFS or other filters.
  writeFileSync(join(s.gitDir, 'info', 'attributes'), '* -text -filter -ident\n')
}

const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/** Hooks from several agents (and `watch`) can fire at once; serialize them per project. */
function withStore<T>(dir: string, fn: (s: Store) => T): T {
  const s = open(dir)
  const lock = `${s.gitDir}.lock`
  mkdirSync(dirname(lock), { recursive: true })
  for (let i = 0; ; i++) {
    try {
      mkdirSync(lock)
      break
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      // ponytail: age-based stale lock detection; a pid file would be exact if 30s ever proves too short
      try {
        if (Date.now() - statSync(lock).mtimeMs > 30_000) rmSync(lock, { recursive: true, force: true })
      } catch {}
      if (i > 300) throw new Error(`another takeback process is busy with this project (${lock})`)
      sleep(50)
    }
  }
  try {
    init(s)
    return fn(s)
  } finally {
    rmSync(lock, { recursive: true, force: true })
  }
}

const rev = (s: Store, ref: string) => {
  const r = s.run(['rev-parse', '--verify', '-q', `${ref}^{commit}`])
  return r.status === 0 ? r.stdout.trim() : null
}

function commitIfChanged(s: Store, label: string): string | null {
  s.git(['add', '-A', '--ignore-errors'])
  const head = rev(s, 'HEAD')
  if (head && s.run(['diff', '--cached', '--quiet', 'HEAD']).status === 0) return null
  s.git(['commit', '-q', '--no-verify', '--allow-empty', '-m', label])
  return rev(s, 'HEAD')
}

const restoredFrom = (s: Store, id: string) => /^Restored: ([0-9a-f]{40})$/m.exec(s.git(['log', '-1', '--format=%b', id]))?.[1]

/** Save a checkpoint of the project containing `dir`. Returns its id, or null if nothing changed. */
export function save(dir: string, label = 'manual save'): string | null {
  return withStore(dir, (s) => commitIfChanged(s, label))
}

/** Newest first. */
export function list(dir: string, limit = 20): Checkpoint[] {
  return withStore(dir, (s) => {
    if (!rev(s, 'HEAD')) return []
    const out = s.git(['log', `-n${limit}`, '--shortstat', '--format=%x1e%H%x1f%ct%x1f%s%x1f%b%x1f'])
    return out.split('\x1e').filter(Boolean).map((chunk) => {
      const [id, ct, label, body, stat] = chunk.split('\x1f')
      return {
        id,
        time: new Date(Number(ct) * 1000),
        label,
        files: Number(/(\d+) files? changed/.exec(stat)?.[1] ?? 0),
        restored: /^Restored: ([0-9a-f]{40})$/m.exec(body)?.[1],
      }
    })
  })
}

/**
 * Restore the project to a checkpoint. Without a target, take back the most recent change:
 * unsaved edits if there are any, otherwise the last checkpoint. Repeating it keeps walking back.
 * The current state is always saved first, so a take back can itself be taken back.
 */
export function undo(dir: string, target?: string): { to: string; saved: string } {
  return withStore(dir, (s) => {
    const head = rev(s, 'HEAD')
    if (!head) throw new Error('No checkpoints yet. Run `takeback init` (Claude Code, Codex) or `takeback watch` first.')
    const saved = commitIfChanged(s, 'saved before takeback')
    const to = target ? rev(s, target) : saved ? head : rev(s, `${restoredFrom(s, head) ?? head}^`)
    if (!to) throw new Error(target ? `Unknown checkpoint: ${target}` : 'Nothing to take back: this is the oldest checkpoint.')
    s.git(['restore', `--source=${to}`, '--staged', '--worktree', '--', '.'])
    s.git(['commit', '-q', '--no-verify', '--allow-empty', '-m', `takeback to ${to.slice(0, 7)}`, '-m', `Restored: ${to}`])
    return { to, saved: saved ?? head }
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

interface HookGroup { matcher?: string; hooks?: { type?: string; command?: string; timeout?: number }[] }
const isOurs = (g: HookGroup) => g.hooks?.some((h) => /\btakeback\b.*\bsave --hook\b/.test(h.command ?? ''))

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
