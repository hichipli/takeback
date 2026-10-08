#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, watch } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { AGENTS, AUTO_LIMIT, KEEP_DAYS, diff, hookFile, installApp, installHooks, list, projectRoot, prune, rememberPrompt, save, show, takePrompt, tooBigToStart, undo, type Agent } from './takeback.ts'

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
  -n, --dry-run                 With any of the above: show what would change, change nothing

Look around
  takeback diff [from] [to]     What \`takeback\` would undo, as a patch; or changes since a checkpoint
  takeback log [count]          Checkpoints, newest first
  takeback show <id> <file>     A file exactly as it was at a checkpoint
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
function hook(flag: string) {
  // The plugin's hook file serves Claude Code and Codex; only Codex sets PLUGIN_ROOT.
  const agent = flag === 'auto' ? (process.env.PLUGIN_ROOT ? 'codex' : 'claude') : flag
  try {
    let payload: { cwd?: string; hook_event_name?: string; prompt?: string; session_id?: string } = {}
    try {
      payload = JSON.parse(readFileSync(0, 'utf8') || '{}')
    } catch {}
    const event = payload.hook_event_name
    const dir = payload.cwd ?? process.cwd()
    // Our own plugin commands: the take back saves the state it replaces, so skip the extra checkpoint.
    if (payload.prompt?.trimStart().startsWith('/takeback:')) return
    // With the takeback plugin enabled, its hook does the work and this one (from `init`) stands down.
    // Both agents set CLAUDE_PLUGIN_ROOT for plugin hooks.
    if (!process.env.CLAUDE_PLUGIN_ROOT && (agent === 'claude' || agent === 'codex') && pluginEnabled(agent)) return
    if (tooBigToStart(dir)) return
    const session = payload.session_id
    const prompt = oneLine(payload.prompt ?? '')
    if (event === 'UserPromptSubmit') {
      save(dir, `${agent} · before "${prompt}"`)
      if (session) rememberPrompt(dir, session, prompt)
    } else if (event === 'Stop') {
      const asked = session && takePrompt(dir, session)
      save(dir, asked ? `${agent} · after "${asked}"` : `${agent} · after turn`)
    } else {
      save(dir, `${agent} · ${event ?? 'hook'}`)
    }
  } catch (e) {
    process.stderr.write(`takeback: ${(e as Error).message}\n`)
  }
}

// The Claude Code plugin passes --slash, so hints name its commands instead of the terminal ones.
let slash = false
const command = (...args: string[]) => {
  if (!slash) return ['takeback', ...args].join(' ')
  const [name, ...rest] = args[0] === 'to' || args[0] === 'diff' ? args : ['undo', ...args]
  return [`/takeback:${name}`, ...rest].join(' ')
}

const DID: Record<string, string> = { A: 'restored', D: 'removed', M: 'reverted', K: 'kept' }
const WOULD: Record<string, string> = { A: 'restore', D: 'remove', M: 'revert', K: 'keep' }

function takeBack(target: string | undefined, paths: string[], dryRun: boolean) {
  const { to, saved, changes, git } = undo(process.cwd(), target, paths, dryRun)
  if (!changes.length) return console.log(dim(`Nothing to take back: ${paths.join(', ') || 'everything'} already matches ${short(to.id)}.`))
  const what = paths.length ? ` ${paths.join(', ')}` : ''
  const head = dryRun ? `${yellow('?')}  Would take back` : `${green('↩')}  Took back`
  console.log(`${head}${what} to ${yellow(short(to.id))} ${dim('·')} ${to.label} ${dim(`· ${ago(to.time)}`)}`)
  for (const [status, path] of changes.slice(0, 8)) {
    const note = status === 'K' ? dim('  (ignored in that checkpoint)') : ''
    console.log(`   ${dim(((dryRun ? WOULD : DID)[status] ?? 'revert').padEnd(10))}${path}${note}`)
  }
  if (changes.length > 8) console.log(dim(`   …and ${changes.length - 8} more`))
  if (git) {
    console.log(yellow(git.then ? `   ! git moved since then: ${git.then} → ${git.now}.` : `   ! git has new commits since then (now ${git.now}).`))
    console.log(yellow('     Files come back as uncommitted changes; your commits stay.'))
  }
  if (dryRun) {
    const again = command(...(target ? ['to', target] : []), ...paths)
    return console.log(dim(`   Nothing changed yet. Run \`${again}\` to do it, or \`${command('diff')}\` for the full patch.`))
  }
  console.log(dim(`   Changed your mind? ${command('to', short(saved))}`))
}

/** The usual reasons a folder has no checkpoints, each with its fix. */
function noCheckpoints(message: string) {
  console.error(red(`takeback: ${tilde(message)}`))
  const mb = AUTO_LIMIT.bytes / 1e6
  console.error(dim(`  · Set up once with \`npx takeback init\`, or keep \`npx takeback watch\` running here.
  · Codex skips new hooks until you approve them once: /hooks in Codex, or Hooks in the ChatGPT app.
  · Folders that aren't git repos and hold over ${AUTO_LIMIT.files.toLocaleString('en')} files or ${mb} MB start only after \`takeback save\`.`))
  process.exitCode = 1
}

function log(limit: number) {
  const items = list(process.cwd(), limit)
  if (!items.length) return noCheckpoints(`No checkpoints for ${projectRoot(process.cwd())} yet.`)
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

/** Whether the takeback plugin is enabled for an agent. It brings its own hooks, so ours would save everything twice. */
function pluginEnabled(agent: Agent) {
  try {
    if (agent === 'claude') {
      const { enabledPlugins = {} } = JSON.parse(readFileSync(hookFile('claude', 'global'), 'utf8'))
      return Object.entries(enabledPlugins).some(([id, on]) => on === true && id.startsWith('takeback@'))
    }
    const config = readFileSync(join(dirname(hookFile('codex', 'global')), 'config.toml'), 'utf8')
    return /^\[plugins\."takeback@[^"]+"\]\s*\n\s*enabled\s*=\s*true/m.test(config)
  } catch {
    return false
  }
}

const cli = (bin: string) => (...args: string[]) => spawnSync(bin, args, { encoding: 'utf8', timeout: 120_000, shell: process.platform === 'win32' })
const codex = cli('codex')
const claude = cli('claude')

/**
 * Codex runs a new hook only after the user approves it, and lists hooks from config as an anonymous
 * "User config · Hook 1". Installed as a plugin, the same hooks show up under "takeback" with its logo.
 */
function installCodexPlugin(): boolean {
  const marketplaces = codex('plugin', 'marketplace', 'list')
  if (marketplaces.status !== 0) return false // no codex CLI on PATH (say, ChatGPT app only)
  // Already added: refresh it, so `npx takeback@latest init` also updates the plugin. A local marketplace has nothing to fetch.
  if (/^takeback\s/m.test(marketplaces.stdout)) codex('plugin', 'marketplace', 'upgrade', 'takeback')
  else if (codex('plugin', 'marketplace', 'add', 'hichipli/takeback').status !== 0) return false
  return codex('plugin', 'add', 'takeback@takeback').status === 0
}

/** Update the Claude Code plugin, for the same reason. False without the claude CLI on PATH. */
const updateClaudePlugin = () =>
  claude('plugin', 'marketplace', 'update', 'takeback').status === 0 && claude('plugin', 'update', 'takeback@takeback').status === 0

/** Whether the user already approved the Codex plugin's hooks; Codex records that in its config. */
function codexHooksTrusted() {
  try {
    const config = readFileSync(join(dirname(hookFile('codex', 'global')), 'config.toml'), 'utf8')
    return /\[hooks\.state\."takeback@takeback:hooks\/hooks\.json:user_prompt_submit:0:0"\]\s*\ntrusted_hash/.test(config)
  } catch {
    return false
  }
}

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
    if (remove && agent === 'codex' && pluginEnabled('codex') && codex('plugin', 'remove', 'takeback@takeback').status === 0) {
      console.log(`${green('✓')} ${NAMES[agent]}: takeback plugin removed`)
    }
    // With a takeback plugin, init installs or updates it instead of writing hooks into the agent's config.
    const updated = remove ? false : agent === 'codex' ? scope === 'global' && installCodexPlugin() : pluginEnabled('claude') && updateClaudePlugin()
    if (!remove && (updated || pluginEnabled(agent))) {
      const cleaned = installHooks(file, '', true) ? dim(` (removed the old hooks from ${tilde(file)})`) : ''
      const howTo = agent === 'claude' ? '/plugin update takeback@takeback in Claude Code' : 'codex plugin marketplace upgrade takeback && codex plugin add takeback@takeback'
      const state = updated ? 'takeback plugin, up to date' : `covered by the takeback plugin ${dim(`(to update it: ${howTo})`)}`
      console.log(`${green('✓')} ${NAMES[agent]}: ${state}${cleaned}`)
      if (agent === 'codex' && !codexHooksTrusted()) {
        console.log(yellow('  ! Codex runs new hooks only after you approve them: /hooks in Codex, or Hooks in the ChatGPT app.'))
        console.log(yellow('    Look for the two hooks listed under takeback.'))
      }
      continue
    }
    const changed = installHooks(file, `${command} save --hook ${agent}`, remove)
    const state = remove ? (changed ? 'hooks removed from' : 'no hooks in') : changed ? 'checkpoint hooks added to' : 'already set up in'
    console.log(`${changed || !remove ? green('✓') : dim('·')} ${NAMES[agent]}: ${state} ${tilde(file)}`)
    if (agent === 'codex' && !remove) {
      console.log(yellow('  ! Codex runs new hooks only after you approve them: /hooks in Codex, or Hooks in the ChatGPT app.'))
      console.log(yellow(`    They're listed under "User config" and run ${tilde(command.replace(/^node /, ''))}.`))
    }
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

const COMMANDS = ['undo', 'to', 'log', 'ls', 'diff', 'show', 'save', 'watch', 'init', 'prune', 'help']

function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      hook: { type: 'string' },
      n: { type: 'boolean', short: 'n' },
      'dry-run': { type: 'boolean' },
      slash: { type: 'boolean' },
      keep: { type: 'string' },
      stat: { type: 'boolean' },
      project: { type: 'boolean' },
      remove: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  })
  if (values.version) return console.log(VERSION)
  slash = !!values.slash
  const [cmd, ...args] = positionals
  if (values.help || cmd === 'help') return console.log(HELP)
  const dryRun = !!(values.n || values['dry-run'])
  if (!cmd || !COMMANDS.includes(cmd)) {
    // `takeback [file...]`; a typo like `takeback lgo` lands here too, so say so if it fails.
    try {
      return takeBack(undefined, positionals, dryRun)
    } catch (e) {
      const odd = positionals.find((p) => !existsSync(p))
      throw new Error(odd ? `${(e as Error).message}\n  ("${odd}" is not a command or an existing file; see takeback --help)` : (e as Error).message)
    }
  }

  switch (cmd) {
    case 'undo':
      return takeBack(undefined, args, dryRun)
    case 'to':
      if (!args[0]) throw new Error('Which checkpoint? Pick an id from `takeback log`.')
      return takeBack(args[0], args.slice(1), dryRun)
    case 'log':
    case 'ls':
      return log(Number(args[0]) || 20)
    case 'diff': {
      const flags = [...(tty ? ['--color=always'] : []), ...(values.stat ? ['--stat'] : [])]
      const { from, patch } = diff(process.cwd(), args[0], args[1], flags)
      // On stderr, so `takeback diff > fix.patch` stays a clean patch.
      if (args.length < 2) {
        const reverts = args[0] ? command('to', short(from.id)) : command()
        const since = `since ${short(from.id)} · ${from.label} · ${ago(from.time)}`
        console.error(dim(patch ? `Changes ${since}. \`${reverts}\` reverts them.` : `No changes ${since}.`))
      }
      return process.stdout.write(patch)
    }
    case 'show':
      if (args.length !== 2) throw new Error('Usage: takeback show <checkpoint> <file>')
      return process.stdout.write(show(process.cwd(), args[0], args[1]))
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
  const message = (e as Error).message
  if (message.startsWith('No checkpoints')) noCheckpoints(message)
  else console.error(red(`takeback: ${message}`))
  process.exit(1)
}
