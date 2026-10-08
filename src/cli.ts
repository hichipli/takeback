#!/usr/bin/env node
import { existsSync, readFileSync, watch } from 'node:fs'
import { homedir } from 'node:os'
import { dirname } from 'node:path'
import { parseArgs } from 'node:util'
import { AGENTS, KEEP_DAYS, diff, hookFile, installApp, installHooks, list, projectRoot, prune, save, undo, type Agent } from './takeback.ts'

const VERSION: string = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version

const HELP = `takeback ${VERSION}: Ctrl+Z for AI coding agents

Set up once
  npx takeback init             Checkpoint every prompt and turn in Claude Code and Codex
                                (init claude | init codex for one of them, --project for
                                this folder only, --remove to undo the setup)
  npx takeback watch            Or keep this running next to any other tool

Take back
  takeback                      Take back the last turn. Run it again to go further back.
  takeback <file>...            Take back the last turn for these files only
  takeback to <id> [file...]    Restore the project, or some files, to any checkpoint

Look around
  takeback log [-n 20]          Checkpoints, newest first
  takeback diff [from] [to]     Changes since a checkpoint (default: the latest); --stat to summarize
  takeback save [message]       Save a checkpoint now
  takeback prune [--keep 7d]    Free disk space now (checkpoints older than ${KEEP_DAYS} days go on their own)

Everything takeback stores lives in ~/.takeback. Your own .git is never touched.
https://github.com/hichipli/takeback`

const tty = process.stdout.isTTY && !process.env.NO_COLOR
const paint = (code: number) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s)
const [dim, red, green, yellow] = [2, 31, 32, 33].map(paint)

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
function ago(t: Date) {
  const s = (t.getTime() - Date.now()) / 1000
  for (const [unit, secs] of [['day', 86400], ['hour', 3600], ['minute', 60]] as const) {
    if (Math.abs(s) >= secs) return rtf.format(Math.round(s / secs), unit)
  }
  return 'just now'
}

const short = (id: string) => id.slice(0, 7)
const tilde = (p: string) => (p.startsWith(homedir()) ? `~${p.slice(homedir().length)}` : p)
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const size = (bytes: number) => (bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.round(Math.max(bytes, 0) / 1e3)} KB`)
const oneLine = (s: string, max = 60) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/** Hook mode: called by an agent with a JSON payload on stdin. Must stay silent and never fail the agent. */
function hook(agent: string) {
  try {
    let payload: { cwd?: string; hook_event_name?: string; prompt?: string } = {}
    try {
      payload = JSON.parse(readFileSync(0, 'utf8') || '{}')
    } catch {}
    const event = payload.hook_event_name
    const label =
      event === 'UserPromptSubmit' ? `${agent} · before "${oneLine(payload.prompt ?? '')}"`
      : event === 'Stop' ? `${agent} · after turn`
      : `${agent} · ${event ?? 'hook'}`
    save(payload.cwd ?? process.cwd(), label)
  } catch (e) {
    process.stderr.write(`takeback: ${(e as Error).message}\n`)
  }
}

const DID: Record<string, string> = { A: 'restored', D: 'removed', M: 'reverted' }

function takeBack(target: string | undefined, paths: string[]) {
  const { to, saved, changes } = undo(process.cwd(), target, paths)
  if (!changes.length) return console.log(dim(`Nothing to take back: ${paths.join(', ') || 'everything'} already matches ${short(to.id)}.`))
  const what = paths.length ? ` ${paths.join(', ')}` : ''
  console.log(`${green('↩')}  Took back${what} to ${yellow(short(to.id))} ${dim('·')} ${to.label} ${dim(`· ${ago(to.time)}`)}`)
  for (const [status, path] of changes.slice(0, 8)) console.log(`   ${dim((DID[status] ?? 'reverted').padEnd(10))}${path}`)
  if (changes.length > 8) console.log(dim(`   …and ${changes.length - 8} more`))
  console.log(dim(`   Changed your mind? takeback to ${short(saved)}`))
}

function log(limit: number) {
  const items = list(process.cwd(), limit)
  if (!items.length) return console.log('No checkpoints yet. Run `npx takeback init` or `npx takeback watch` first.')
  console.log(dim(tilde(projectRoot(process.cwd()))))
  for (const c of items) {
    const files = c.files ? dim(` · ${plural(c.files, 'file')}`) : ''
    console.log(`  ${yellow(short(c.id))}  ${dim(ago(c.time).padEnd(14))}  ${c.label}${files}`)
  }
}

function watchFiles() {
  const root = projectRoot(process.cwd())
  const snap = () => {
    try {
      const id = save(root, 'watch · files changed')
      if (id) console.log(`  ${yellow(short(id))}  ${dim(new Date().toLocaleTimeString())}  saved`)
    } catch (e) {
      console.error(red(`takeback: ${(e as Error).message}`))
    }
  }
  console.log(`Watching ${tilde(root)}\nA checkpoint is saved 1.5s after files stop changing. Press Ctrl+C to stop.`)
  snap()
  let timer: NodeJS.Timeout | undefined
  watch(root, { recursive: true }, (_event, file) => {
    if (file && /(^|[\\/])(\.git|node_modules)([\\/]|$)/.test(String(file))) return
    clearTimeout(timer)
    timer = setTimeout(snap, 1500)
  })
}

const NAMES: Record<Agent, string> = { claude: 'Claude Code', codex: 'Codex' }

/** Without explicit agents, only touch the ones installed here: a chat-app user who runs init should get no stray config. */
function init(agents: Agent[], scope: 'global' | 'project', remove: boolean, detect: boolean) {
  const chosen = detect ? agents.filter((a) => existsSync(dirname(hookFile(a, 'global')))) : agents
  if (!chosen.length) {
    console.log("Didn't find Claude Code or Codex on this computer, so nothing was changed.")
    return console.log(`Using another tool that edits your files? Keep ${yellow('npx takeback watch')} running in the project folder.`)
  }
  const command = remove ? 'takeback' : installApp()
  for (const agent of agents) {
    if (!chosen.includes(agent)) {
      console.log(dim(`· ${NAMES[agent]}: not installed, skipped`))
      continue
    }
    const file = hookFile(agent, scope)
    const changed = installHooks(file, `${command} save --hook ${agent}`, remove)
    const state = remove ? (changed ? 'hooks removed from' : 'no hooks in') : changed ? 'checkpoint hooks added to' : 'already set up in'
    const trust = agent === 'codex' && changed && !remove ? dim(' (Codex asks you to review new hooks once)') : ''
    console.log(`${changed || !remove ? green('✓') : dim('·')} ${NAMES[agent]}: ${state} ${tilde(file)}${trust}`)
  }
  if (remove) return
  console.log(`\nDone. When an agent breaks something, run ${yellow('npx takeback')} in the project folder.`)
  console.log(dim('Other tools (Cursor, Gemini CLI, OpenCode…): keep `npx takeback watch` running in the project folder.'))
}

function pruneAll(keep?: string) {
  const days = keep === undefined ? KEEP_DAYS : Number(keep.replace(/d$/i, ''))
  if (!Number.isFinite(days) || days < 0) throw new Error('--keep takes a number of days, like --keep 7d')
  const results = prune(days)
  for (const r of results.filter((r) => r.gone || r.dropped)) {
    const what = r.gone ? 'folder is gone, all checkpoints deleted' : `${plural(r.dropped, 'old checkpoint')} dropped`
    console.log(`  ${tilde(r.project)}  ${dim(what)}  ${size(r.freed)} freed`)
  }
  const freed = results.reduce((n, r) => n + Math.max(r.freed, 0), 0)
  console.log(`${green('✓')} Freed ${size(freed)}. Kept the last ${plural(days, 'day')} of checkpoints and always the newest one.`)
}

const COMMANDS = ['undo', 'to', 'log', 'ls', 'diff', 'save', 'watch', 'init', 'prune', 'help']

function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      hook: { type: 'string' },
      n: { type: 'string', short: 'n', default: '20' },
      keep: { type: 'string' },
      stat: { type: 'boolean' },
      project: { type: 'boolean' },
      remove: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  })
  if (values.version) return console.log(VERSION)
  const [cmd, ...args] = positionals
  if (values.help || cmd === 'help') return console.log(HELP)
  if (!cmd || !COMMANDS.includes(cmd)) {
    // `takeback [file...]`; a typo like `takeback lgo` lands here too, so say so if it fails.
    try {
      return takeBack(undefined, positionals)
    } catch (e) {
      const odd = positionals.find((p) => !existsSync(p))
      throw new Error(odd ? `${(e as Error).message}\n  ("${odd}" is not a command or an existing file; see takeback --help)` : (e as Error).message)
    }
  }

  switch (cmd) {
    case 'undo':
      return takeBack(undefined, args)
    case 'to':
      if (!args[0]) throw new Error('Which checkpoint? Pick an id from `takeback log`.')
      return takeBack(args[0], args.slice(1))
    case 'log':
    case 'ls':
      return log(Number(values.n) || 20)
    case 'diff': {
      const flags = [...(tty ? ['--color=always'] : []), ...(values.stat ? ['--stat'] : [])]
      return process.stdout.write(diff(process.cwd(), args[0], args[1], flags))
    }
    case 'save': {
      if (values.hook) return hook(values.hook)
      const id = save(process.cwd(), args.join(' ') || 'manual save')
      return console.log(id ? `${green('✓')} Saved ${yellow(short(id))}` : dim('Nothing changed since the last checkpoint.'))
    }
    case 'watch':
      return watchFiles()
    case 'init': {
      const agents = args.length ? (args as Agent[]) : AGENTS
      const unknown = agents.find((a) => !AGENTS.includes(a))
      if (unknown) throw new Error(`Unknown agent "${unknown}". Supported: ${AGENTS.join(', ')}. For any other tool use \`takeback watch\`.`)
      return init(agents, values.project ? 'project' : 'global', !!values.remove, !args.length && !values.remove)
    }
    case 'prune':
      return pruneAll(values.keep)
  }
}

try {
  main()
} catch (e) {
  console.error(red(`takeback: ${(e as Error).message}`))
  process.exit(1)
}
