#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { readFileSync, watch } from 'node:fs'
import { parseArgs } from 'node:util'
import { AGENTS, diff, hookFile, installHooks, list, projectRoot, save, undo, type Agent, type Checkpoint } from './takeback.ts'

const VERSION: string = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version

const HELP = `takeback ${VERSION}: Ctrl+Z for AI coding agents

Usage
  takeback                    Take back the last turn (restore the previous checkpoint)
  takeback to <checkpoint>    Restore any checkpoint from \`takeback log\`
  takeback log [-n 20]        List checkpoints, newest first
  takeback diff [from] [to]   Show changes since a checkpoint (default: the latest)
  takeback save [message]     Save a checkpoint now
  takeback watch              Save checkpoints whenever files settle (works with any agent)
  takeback init [agent]       Save a checkpoint before every prompt and after every turn
                              in Claude Code and Codex (agent: ${AGENTS.join(' | ')}; default: both)
      --project               Install hooks for this project only instead of globally
      --remove                Remove the hooks again

Checkpoints live in ~/.takeback, outside your project. Your own .git is never touched.
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
const oneLine = (s: string, max = 60) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}
const describe = (c?: Checkpoint) => (c ? `${c.label} ${dim(`(${ago(c.time)})`)}` : '')

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

function takeBack(target?: string) {
  const { to, saved } = undo(process.cwd(), target)
  const byId = new Map(list(process.cwd(), 200).map((c) => [c.id, c]))
  console.log(`${green('↩')}  Took back to ${yellow(short(to))}  ${describe(byId.get(to))}`)
  console.log(dim(`   Previous state saved as ${short(saved)}. Bring it back: takeback to ${short(saved)}`))
}

function log(limit: number) {
  const items = list(process.cwd(), limit)
  if (!items.length) return console.log('No checkpoints yet. Run `takeback init` or `takeback watch` first.')
  console.log(dim(projectRoot(process.cwd())))
  for (const c of items) {
    const files = c.files ? dim(` · ${c.files} file${c.files === 1 ? '' : 's'}`) : ''
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
  console.log(`Watching ${root}\nA checkpoint is saved 1.5s after files stop changing. Press Ctrl+C to stop.`)
  snap()
  let timer: NodeJS.Timeout | undefined
  watch(root, { recursive: true }, (_event, file) => {
    if (file && /(^|[\\/])(\.git|node_modules)([\\/]|$)/.test(String(file))) return
    clearTimeout(timer)
    timer = setTimeout(snap, 1500)
  })
}

function init(agents: Agent[], scope: 'global' | 'project', remove: boolean) {
  // Prefer a global install: hooks run on every prompt and npx adds startup time.
  const which = spawnSync('takeback', ['--version'], { shell: process.platform === 'win32' })
  const bin = which.status === 0 ? 'takeback' : 'npx -y takeback'
  for (const agent of agents) {
    const file = hookFile(agent, scope)
    const changed = installHooks(file, `${bin} save --hook ${agent}`, remove)
    const verb = remove ? 'removed from' : 'installed in'
    console.log(`${changed ? green('✓') : dim('·')} ${agent}: hooks ${changed ? verb : remove ? 'not found in' : 'already in'} ${file}`)
  }
  if (remove) return
  if (agents.includes('codex')) console.log(dim('  Codex asks you to trust new hooks once: run /hooks inside Codex.'))
  if (bin !== 'takeback') console.log(dim('  Tip: `npm i -g takeback`, then run `takeback init` again for faster hooks.'))
  console.log(`\nUsing another agent (Cursor, Gemini CLI, OpenCode, Aider…)? Run ${yellow('takeback watch')} next to it.`)
  console.log(`Something went wrong? Run ${yellow('takeback')} to take back the last turn.`)
}

function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      hook: { type: 'string' },
      n: { type: 'string', short: 'n', default: '20' },
      stat: { type: 'boolean' },
      project: { type: 'boolean' },
      remove: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  })
  const [cmd = 'undo', ...args] = positionals
  if (values.version) return console.log(VERSION)
  if (values.help || cmd === 'help') return console.log(HELP)

  switch (cmd) {
    case 'undo':
      return takeBack()
    case 'to':
      if (!args[0]) throw new Error('Which checkpoint? Pick an id from `takeback log`.')
      return takeBack(args[0])
    case 'log':
    case 'ls':
      return log(Number(values.n) || 20)
    case 'diff': {
      const flags = [...(tty ? ['--color=always'] : []), ...(values.stat ? ['--stat'] : [])]
      return process.stdout.write(diff(process.cwd(), args[0], args[1], flags))
    }
    case 'save':
      if (values.hook) return hook(values.hook)
      {
        const id = save(process.cwd(), args.join(' ') || 'manual save')
        return console.log(id ? `${green('✓')} Saved ${yellow(short(id))}` : dim('Nothing changed since the last checkpoint.'))
      }
    case 'watch':
      return watchFiles()
    case 'init': {
      const agents = args.length ? (args as Agent[]) : AGENTS
      const unknown = agents.find((a) => !AGENTS.includes(a))
      if (unknown) throw new Error(`Unknown agent "${unknown}". Supported: ${AGENTS.join(', ')}. For any other agent use \`takeback watch\`.`)
      return init(agents, values.project ? 'project' : 'global', !!values.remove)
    }
    default:
      throw new Error(`Unknown command "${cmd}". Run \`takeback --help\`.`)
  }
}

try {
  main()
} catch (e) {
  console.error(red(`takeback: ${(e as Error).message}`))
  process.exit(1)
}
