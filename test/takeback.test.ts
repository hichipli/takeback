import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, delimiter, dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

// Never read or write the real ~/.takeback, ~/.claude or ~/.codex.
process.env.TAKEBACK_HOME = mkdtempSync(join(tmpdir(), 'takeback-store-'))
process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'takeback-claude-home-'))
process.env.CODEX_HOME = mkdtempSync(join(tmpdir(), 'takeback-codex-home-'))
// Nor run the real codex or claude CLI: `init` would install or update the plugins from GitHub.
// Keep this test run's node first, since its folder may be one that also holds those CLIs.
process.env.PATH = [dirname(process.execPath), ...process.env.PATH!.split(delimiter).filter((d) => !['codex', 'claude'].some((b) => existsSync(join(d, b))))].join(delimiter)
const { diff, installHooks, list, prune, save, show, tooBigToStart, undo } = await import('../src/takeback.ts')

const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.ts')

function project(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'takeback-project-'))
  for (const [name, body] of Object.entries(files)) write(dir, name, body)
  return dir
}
function write(dir: string, name: string, body: string) {
  mkdirSync(dirname(join(dir, name)), { recursive: true })
  writeFileSync(join(dir, name), body)
}
const read = (dir: string, name: string) => readFileSync(join(dir, name), 'utf8')

test('takes back turns, including Bash-style deletes and new files, and the take back itself', () => {
  const dir = project({ 'app.js': 'v1', 'scripts/build.sh': 'build', '.gitignore': '*.log\n', 'debug.log': 'mine' })
  save(dir, 'before turn 1')

  // Turn 1: what an agent might do through Bash: edit, rm -rf, create, touch an ignored file.
  write(dir, 'app.js', 'v2')
  rmSync(join(dir, 'scripts'), { recursive: true })
  write(dir, 'src/new.js', 'new')
  write(dir, 'debug.log', 'agent was here')
  save(dir, 'after turn 1')

  // Turn 2, never checkpointed (no Stop hook): unsaved changes are taken back first.
  write(dir, 'app.js', 'v3')
  const second = undo(dir)
  assert.equal(read(dir, 'app.js'), 'v2')

  // Again: walks back past turn 1, and reports what it did.
  const first = undo(dir)
  assert.deepEqual(first.changes, [['M', 'app.js'], ['A', 'scripts/build.sh'], ['D', 'src/new.js']])
  assert.equal(first.to.label, 'before turn 1')
  assert.equal(read(dir, 'app.js'), 'v1')
  assert.equal(read(dir, 'scripts/build.sh'), 'build')
  assert.ok(!existsSync(join(dir, 'src')), 'files the agent created are gone, and so is their folder')
  assert.equal(read(dir, 'debug.log'), 'agent was here', 'ignored files are left alone')

  // A take back can be taken back.
  undo(dir, second.saved)
  assert.equal(read(dir, 'app.js'), 'v3')
  assert.ok(existsSync(join(dir, 'src/new.js')))
})

test('save skips when nothing changed; list and diff describe checkpoints', () => {
  const dir = project({ 'a.txt': 'one' })
  const first = save(dir, 'first')
  assert.ok(first)
  assert.equal(save(dir, 'again'), null)

  write(dir, 'a.txt', 'two')
  write(dir, 'b.txt', 'untracked')
  const patch = diff(dir).patch
  assert.match(patch, /\+two/)
  assert.match(patch, /b\.txt/, 'new files show up before they are saved')

  save(dir, 'second')
  const [latest, previous] = list(dir)
  assert.deepEqual([latest.label, latest.files, previous.id], ['second', 2, first])
  assert.match(diff(dir, previous.id, latest.id).patch, /\+two/)
})

test('undo explains when there is nothing to take back', () => {
  const dir = project({ 'a.txt': 'one' })
  assert.throws(() => undo(dir), /No checkpoints/)
  save(dir)
  assert.throws(() => undo(dir), /oldest checkpoint/)
  assert.throws(() => undo(dir, 'nope'), /Unknown checkpoint/)
})

test('refuses to snapshot the home folder', () => {
  assert.throws(() => save(homedir()), /refusing/)
})

test('installs hooks idempotently, keeps existing settings, and removes cleanly', () => {
  const file = join(project({}), '.claude', 'settings.json')
  write(dirname(file), 'settings.json', JSON.stringify({ model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] } }))

  assert.equal(installHooks(file, 'takeback save --hook claude'), true)
  assert.equal(installHooks(file, 'takeback save --hook claude'), false)
  const cfg = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(cfg.model, 'opus')
  assert.equal(cfg.hooks.Stop.length, 2)
  assert.equal(cfg.hooks.UserPromptSubmit[0].hooks[0].command, 'takeback save --hook claude')

  assert.equal(installHooks(file, 'takeback save --hook claude', true), true)
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] } })

  write(dirname(file), 'broken.json', '{ nope')
  assert.throws(() => installHooks(join(dirname(file), 'broken.json'), 'takeback save --hook claude'), /not valid JSON/)
})

test('hook mode reads the agent payload and prints nothing', () => {
  const dir = project({ 'a.txt': 'one' })
  const payload = { cwd: dir, hook_event_name: 'UserPromptSubmit', prompt: 'fix   the\nlogin bug' }
  const r = spawnSync(process.execPath, [cli, 'save', '--hook', 'claude'], { input: JSON.stringify(payload), encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout, '', 'stdout of a UserPromptSubmit hook would be added to the agent context')
  assert.equal(list(dir)[0].label, 'claude · before "fix the login bug"')
})

test('takes back single files without moving the turn position', () => {
  const dir = project({ 'a.txt': 'a1', 'b.txt': 'b1' })
  save(dir, 'before turn')
  write(dir, 'a.txt', 'a2')
  write(dir, 'b.txt', 'b2')
  write(dir, 'c.txt', 'new')
  save(dir, 'after turn')

  assert.deepEqual(undo(dir, undefined, ['a.txt']).changes, [['M', 'a.txt']])
  assert.equal(read(dir, 'a.txt'), 'a1')
  assert.equal(read(dir, 'b.txt'), 'b2', 'other files are untouched')
  assert.deepEqual(undo(dir, undefined, ['a.txt']).changes, [], 'taking back the same file twice is a no-op')
  assert.deepEqual(undo(dir, undefined, ['c.txt']).changes, [['D', 'c.txt']], 'a file the agent created goes away')
  assert.throws(() => undo(dir, undefined, ['nope.txt']), /never appears/)

  // A full take back then finishes the same turn instead of going further back.
  const full = undo(dir)
  assert.equal(full.to.label, 'before turn')
  assert.equal(read(dir, 'b.txt'), 'b1')
})

test('init installs a private copy so hooks run without npx', () => {
  const env = {
    ...process.env,
    CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'takeback-claude-')),
    CODEX_HOME: mkdtempSync(join(tmpdir(), 'takeback-codex-')),
  }
  const r = spawnSync(process.execPath, [cli, 'init'], { env, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  const command = JSON.parse(readFileSync(join(env.CLAUDE_CONFIG_DIR, 'settings.json'), 'utf8')).hooks.UserPromptSubmit[0].hooks[0].command
  assert.match(command, /^node ".+app[\\/]dist[\\/]cli\.ts" save --hook claude$/)
  assert.ok(existsSync(join(env.CODEX_HOME, 'hooks.json')))

  // Run the hook the way Claude Code does: through a shell, payload on stdin.
  const dir = project({ 'a.txt': 'one' })
  const h = spawnSync(command, { shell: true, env, encoding: 'utf8', input: JSON.stringify({ cwd: dir, hook_event_name: 'Stop' }) })
  assert.equal(h.status, 0, h.stderr)
  assert.equal(h.stdout, '')
  assert.equal(list(dir)[0].label, 'claude · after turn')

  // Re-running init doesn't duplicate hooks, and --remove finds them wherever the app lives.
  const settings = () => JSON.parse(readFileSync(join(env.CLAUDE_CONFIG_DIR, 'settings.json'), 'utf8'))
  spawnSync(process.execPath, [cli, 'init'], { env })
  assert.equal(settings().hooks.Stop.length, 1)
  spawnSync(process.execPath, [cli, 'init', '--remove'], { env: { ...env, TAKEBACK_HOME: join(tmpdir(), 'elsewhere') } })
  assert.deepEqual(settings(), {})
})

test('init only sets up agents that are installed', () => {
  const missing = join(tmpdir(), `takeback-none-${process.pid}`)
  const env = { ...process.env, CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'takeback-claude-')), CODEX_HOME: missing }
  const r = spawnSync(process.execPath, [cli, 'init'], { env, encoding: 'utf8' })
  assert.match(r.stdout, /Codex: not installed, skipped/)
  assert.ok(existsSync(join(env.CLAUDE_CONFIG_DIR, 'settings.json')))
  assert.ok(!existsSync(missing), 'no config folder for an agent the user does not have')

  const none = spawnSync(process.execPath, [cli, 'init'], { env: { ...env, CLAUDE_CONFIG_DIR: missing }, encoding: 'utf8' })
  assert.equal(none.status, 0)
  assert.match(none.stdout, /nothing was changed/)
  assert.ok(!existsSync(missing))
})

test('prune keeps the newest checkpoint and deletes stores of deleted folders', () => {
  const home = process.env.TAKEBACK_HOME
  process.env.TAKEBACK_HOME = mkdtempSync(join(tmpdir(), 'takeback-prune-'))
  try {
    const dir = project({ 'a.txt': '1' })
    for (const v of ['2', '3']) {
      save(dir)
      write(dir, 'a.txt', v)
    }
    save(dir)
    const gone = project({ 'b.txt': 'x' })
    save(gone)
    rmSync(gone, { recursive: true })

    const results = prune(0)
    assert.deepEqual(results.map((r) => [r.gone, r.dropped]).sort(), [[false, 2], [true, 0]])
    assert.equal(list(dir).length, 1)
    assert.throws(() => undo(dir), /oldest checkpoint/)
    write(dir, 'a.txt', '4')
    assert.ok(save(dir), 'saving still works after a prune')
  } finally {
    process.env.TAKEBACK_HOME = home
  }
})

test('never deletes or loses files that a checkpoint ignores', () => {
  const dir = project({ '.gitignore': '.env\n', '.env': 'v0', 'app.js': 'a' })
  save(dir, 'before turn')
  // The agent empties .gitignore, so .env lands in the next checkpoint.
  write(dir, '.gitignore', '')
  write(dir, '.env', 'v1')
  write(dir, 'app.js', 'b')
  const after = save(dir, 'after turn')!

  const back = undo(dir)
  assert.deepEqual(back.changes, [['K', '.env'], ['M', '.gitignore'], ['M', 'app.js']])
  assert.equal(read(dir, '.env'), 'v1', '.env is ignored again and stays on disk')

  // .env is untracked now. Restoring a checkpoint that has it must save today's copy first.
  write(dir, '.env', 'v2')
  const forward = undo(dir, after)
  assert.equal(read(dir, '.env'), 'v1')
  undo(dir, forward.saved, ['.env'])
  assert.equal(read(dir, '.env'), 'v2')
})

test('dry run reports exactly what a take back would do, and changes nothing', () => {
  const dir = project({ 'a.txt': 'a1', 'b.txt': 'b1' })
  save(dir, 'before turn')
  write(dir, 'a.txt', 'a2')
  rmSync(join(dir, 'b.txt'))
  write(dir, 'c.txt', 'new')
  save(dir, 'after turn')

  const preview = undo(dir, undefined, [], true)
  assert.equal(read(dir, 'a.txt'), 'a2')
  assert.equal(list(dir)[0].label, 'after turn', 'no checkpoint was saved')
  assert.match(diff(dir).patch, /-a1[\s\S]*\+a2/, 'diff shows what the last turn changed')
  assert.deepEqual(undo(dir).changes, preview.changes)
})

test('one plugin hook file serves Claude Code and Codex, and init defers to an enabled plugin', () => {
  const root = join(dirname(cli), '..')
  const json = (f: string) => JSON.parse(readFileSync(join(root, f), 'utf8'))
  const { version } = json('package.json')
  for (const manifest of ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json']) assert.equal(json(manifest).version, version, manifest)
  const codexPlugin = json('.codex-plugin/plugin.json')
  for (const f of [codexPlugin.hooks, codexPlugin.skills, codexPlugin.interface.logo]) assert.ok(existsSync(join(root, f)), f)
  assert.equal(json('.agents/plugins/marketplace.json').plugins[0].source.path, './')

  const command: string = json('hooks/hooks.json').hooks.UserPromptSubmit[0].hooks[0].command
  const fire = (dir: string, env: Record<string, string>) =>
    spawnSync(command, {
      shell: true, encoding: 'utf8', env: { ...process.env, ...env },
      input: JSON.stringify({ cwd: dir, hook_event_name: 'UserPromptSubmit', prompt: 'refactor it' }),
    })
  const claudeDir = project({ 'a.txt': 'one' })
  assert.equal(fire(claudeDir, { CLAUDE_PLUGIN_ROOT: root }).status, 0)
  assert.equal(list(claudeDir)[0].label, 'claude · before "refactor it"')
  const codexDir = project({ 'a.txt': 'one' })
  fire(codexDir, { CLAUDE_PLUGIN_ROOT: root, PLUGIN_ROOT: root }) // what Codex sets for plugin hooks
  assert.equal(list(codexDir)[0].label, 'codex · before "refactor it"')

  const claude = mkdtempSync(join(tmpdir(), 'takeback-claude-'))
  writeFileSync(join(claude, 'settings.json'), JSON.stringify({ enabledPlugins: { 'takeback@takeback': true } }))
  const env = { ...process.env, CLAUDE_CONFIG_DIR: claude, CODEX_HOME: join(tmpdir(), `takeback-none-${process.pid}`) }
  const r = spawnSync(process.execPath, [cli, 'init'], { env, encoding: 'utf8' })
  assert.match(r.stdout, /covered by the takeback plugin/)
  assert.equal(JSON.parse(readFileSync(join(claude, 'settings.json'), 'utf8')).hooks, undefined)
})

test('reading commands never create a store, and a stale git lock does not block checkpoints', () => {
  const dir = project({ 'a.txt': 'one' })
  const stores = () => readdirSync(process.env.TAKEBACK_HOME!).length
  const before = stores()
  assert.deepEqual(list(dir), [])
  assert.throws(() => undo(dir, undefined, [], true), /No checkpoints/)
  assert.throws(() => diff(dir), /No checkpoints/)
  assert.equal(stores(), before)

  save(dir)
  const store = readdirSync(process.env.TAKEBACK_HOME!).find((d) => d.startsWith(basename(dir)))!
  writeFileSync(join(process.env.TAKEBACK_HOME!, store, 'index.lock'), '') // left by a killed hook
  write(dir, 'a.txt', 'two')
  assert.ok(save(dir))
})

test('hooks skip big folders that are not git repos, but never a git repo or one already tracked', () => {
  const big = project({ 'a.txt': 'x', 'b.txt': 'x', 'c.txt': 'x' })
  const limit = { files: 2, bytes: 1e9 }
  assert.equal(tooBigToStart(big, limit), true)
  spawnSync('git', ['init', '-q'], { cwd: big })
  assert.equal(tooBigToStart(big, limit), false)

  const tracked = project({ 'a.txt': 'x', 'b.txt': 'x', 'c.txt': 'x' })
  save(tracked) // `takeback save` starts it by hand
  assert.equal(tooBigToStart(tracked, limit), false)
})

test('with the plugin enabled, hooks from init stand down and the plugin hook does the work', () => {
  const claude = mkdtempSync(join(tmpdir(), 'takeback-claude-'))
  writeFileSync(join(claude, 'settings.json'), JSON.stringify({ enabledPlugins: { 'takeback@takeback': true } }))
  const dir = project({ 'a.txt': 'one' })
  const fire = (extra: Record<string, string>) =>
    spawnSync(process.execPath, [cli, 'save', '--hook', 'claude'], {
      env: { ...process.env, CLAUDE_CONFIG_DIR: claude, ...extra },
      input: JSON.stringify({ cwd: dir, hook_event_name: 'UserPromptSubmit', prompt: 'go' }),
    })
  fire({})
  assert.deepEqual(list(dir), [], 'the init hook did nothing')
  fire({ CLAUDE_PLUGIN_ROOT: '/plugin' })
  assert.equal(list(dir)[0].label, 'claude · before "go"')
})

test('with the Codex plugin enabled, hooks from init stand down', () => {
  const codexHome = mkdtempSync(join(tmpdir(), 'takeback-codex-'))
  writeFileSync(join(codexHome, 'config.toml'), '[plugins."takeback@takeback"]\nenabled = true\n')
  const dir = project({ 'a.txt': 'one' })
  spawnSync(process.execPath, [cli, 'save', '--hook', 'codex'], {
    env: { ...process.env, CODEX_HOME: codexHome },
    input: JSON.stringify({ cwd: dir, hook_event_name: 'UserPromptSubmit', prompt: 'go' }),
  })
  assert.deepEqual(list(dir), [])
})

test('with --slash, hints name the Claude Code plugin commands', () => {
  const dir = project({ 'a.txt': 'one' })
  save(dir, 'before')
  write(dir, 'a.txt', 'two')
  save(dir, 'after')
  const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8' }).stdout
  assert.match(run('-n'), /Run `takeback` to do it, or `takeback diff`/, 'the terminal keeps terminal commands')
  assert.match(run('--slash', '-n'), /Run `\/takeback:undo` to do it, or `\/takeback:diff` for the full patch/)
  assert.match(run('--slash'), /Changed your mind\? \/takeback:to [0-9a-f]{7}/)
})

test('a take back says when the project moved to another commit or branch since the checkpoint', () => {
  const dir = project({ 'CHANGELOG.md': 'history' })
  const git = (...args: string[]) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, encoding: 'utf8' })
  git('init', '-q', '-b', 'main')
  git('add', '-A')
  git('commit', '-qm', 'init')
  save(dir, 'before turn')
  // The agent deletes a file and commits it on a new branch.
  git('switch', '-qc', 'docs/changelog-remove')
  git('rm', '-q', 'CHANGELOG.md')
  git('commit', '-qm', 'remove changelog')
  save(dir, 'after turn')

  const preview = undo(dir, undefined, [], true)
  assert.match(preview.git!.then, /^main [0-9a-f]{7}$/)
  assert.match(preview.git!.now, /^docs\/changelog-remove [0-9a-f]{7}$/)

  const r = spawnSync(process.execPath, [cli, 'diff'], { cwd: dir, encoding: 'utf8' })
  assert.match(r.stderr, /Changes since [0-9a-f]{7} · before turn .*`takeback` reverts them/)
  assert.match(r.stdout, /^diff --git/, 'stdout is only the patch')
})

test('show prints a file as it was at a checkpoint', () => {
  const dir = project({ 'src/app.js': 'v1' })
  const first = save(dir, 'before')!
  write(dir, 'src/app.js', 'v2')
  save(dir, 'after')
  assert.equal(show(dir, first, 'src/app.js').toString(), 'v1')
  assert.throws(() => show(dir, first, 'nope.js'), /isn't in checkpoint/)
  const r = spawnSync(process.execPath, [cli, 'show', first.slice(0, 7), 'app.js'], { cwd: join(dir, 'src'), encoding: 'utf8' })
  assert.equal(r.stdout, 'v1', 'paths are relative to where you run it')
})

test('reading works in a sandbox that cannot write to the store', { skip: process.platform === 'win32' }, () => {
  const dir = project({ 'a.txt': 'one' })
  const first = save(dir, 'before')!
  write(dir, 'a.txt', 'two')
  save(dir, 'after')
  write(dir, 'a.txt', 'three') // unsaved, so previews stage it somewhere
  const store = readdirSync(process.env.TAKEBACK_HOME!).find((d) => d.startsWith(basename(dir)))!
  const lockDown = (mode: number) => spawnSync('chmod', ['-R', mode.toString(8), join(process.env.TAKEBACK_HOME!, store)])
  lockDown(0o555)
  try {
    assert.equal(list(dir).length, 2)
    assert.match(diff(dir).patch, /\+three/)
    assert.deepEqual(undo(dir, undefined, [], true).changes, [['M', 'a.txt']])
    assert.equal(show(dir, first, 'a.txt').toString(), 'one')
  } finally {
    lockDown(0o755)
  }
})

test('init stops asking to approve the Codex hooks once they are approved', () => {
  const codexHome = mkdtempSync(join(tmpdir(), 'takeback-codex-'))
  const enabled = '[plugins."takeback@takeback"]\nenabled = true\n'
  writeFileSync(join(codexHome, 'config.toml'), enabled)
  const env = { ...process.env, CODEX_HOME: codexHome, CLAUDE_CONFIG_DIR: join(tmpdir(), `takeback-none-${process.pid}`) }
  const init = () => spawnSync(process.execPath, [cli, 'init'], { env, encoding: 'utf8' }).stdout
  assert.match(init(), /covered by the takeback plugin .*to update it/)
  assert.match(init(), /approve them/)
  writeFileSync(join(codexHome, 'config.toml'), enabled + '\n[hooks.state."takeback@takeback:hooks/hooks.json:user_prompt_submit:0:0"]\ntrusted_hash = "sha256:x"\n')
  assert.doesNotMatch(init(), /approve them/)
})

test('without a git record, a commit made after the checkpoint still gets a note', () => {
  const dir = project({ 'app.js': 'v1' })
  save(dir, 'before git') // not a git repo yet, so no record, like checkpoints from before 0.4.1
  write(dir, 'app.js', 'v2')
  const later = `${Math.floor(Date.now() / 1000) + 120} +0000`
  const git = (...args: string[]) =>
    spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, env: { ...process.env, GIT_COMMITTER_DATE: later } })
  git('init', '-q', '-b', 'main')
  git('add', '-A')
  git('commit', '-qm', 'v2')

  const preview = undo(dir, undefined, [], true)
  assert.equal(preview.git?.then, undefined)
  assert.match(preview.git!.now, /^main [0-9a-f]{7}$/)
})
