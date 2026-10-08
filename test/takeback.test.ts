import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

process.env.TAKEBACK_HOME = mkdtempSync(join(tmpdir(), 'takeback-store-'))
const { diff, installHooks, list, save, undo } = await import('../src/takeback.ts')

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

  // Again: walks back past turn 1.
  undo(dir)
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
  const patch = diff(dir)
  assert.match(patch, /\+two/)
  assert.match(patch, /b\.txt/, 'new files show up before they are saved')

  save(dir, 'second')
  const [latest, previous] = list(dir)
  assert.deepEqual([latest.label, latest.files, previous.id], ['second', 2, first])
  assert.match(diff(dir, previous.id, latest.id), /\+two/)
})

test('undo explains when there is nothing to take back', () => {
  const dir = project({ 'a.txt': 'one' })
  assert.throws(() => undo(dir), /No checkpoints yet/)
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
