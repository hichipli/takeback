<div align="center">

<img src="assets/logo.svg" width="88" alt="takeback">

# takeback

**Ctrl+Z for AI coding agents.**

Your agent ran `rm -rf`, rewrote 40 files, or "fixed" the wrong thing.<br>
One command puts it all back, including what it changed through Bash.

[![CI](https://github.com/hichipli/takeback/actions/workflows/ci.yml/badge.svg)](https://github.com/hichipli/takeback/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/takeback)](https://www.npmjs.com/package/takeback)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

English · [简体中文](README.zh-CN.md)

<img src="docs/demo.svg" alt="An agent deletes scripts/ through Bash, and takeback restores it with one command" width="860">

</div>

## Quick start

Set it up once. From then on, Claude Code and Codex save a checkpoint before every prompt and after every turn, in every project:

```bash
npx takeback init
```

When an agent breaks something, run this in the project folder:

```bash
npx takeback
```

That's it. Add `-n` to see what it would do first.

Using Codex? `init` installs the takeback plugin for it. Codex runs new hooks only after you approve them, so run `/hooks` in Codex (or open Hooks in the ChatGPT app) once and trust the two listed under takeback.

## Why takeback

- **It catches what built-in undo misses.** Claude Code's `/rewind` skips files changed through Bash, most subagents and other sessions ([docs](https://code.claude.com/docs/en/checkpointing#limitations)). The Codex CLI [dropped `/undo`](https://github.com/openai/codex/issues/9203). takeback snapshots the whole folder, whoever changed it.
- **One setup for every project and agent.** `init` covers Claude Code and Codex wherever you run them: terminal, desktop app or IDE. `takeback watch` covers everything else.
- **It can't make things worse.** Every take back saves where you are first. Your `.git` is never touched, and files your `.gitignore` protects, like `.env`, are never deleted.
- **Your agent can use it too.** Ask it to go back to an earlier version and it reads the exact files from a checkpoint instead of rebuilding them from memory. [More below](#your-agent-can-use-it-too).
- **Small enough to read.** Under 900 lines of TypeScript, zero dependencies, nothing leaves your machine. [Read it](src/) before you run it.

|  | takeback | Claude Code `/rewind` | git |
| --- | --- | --- | --- |
| Restores files changed through Bash (`rm`, `mv`, codegen) | ✓ | ✗ | Only what you committed |
| Works with every agent | ✓ | Claude Code only | ✓ |
| Nothing to remember before each prompt | ✓ | ✓ | Commit first |

## Using it

Commands are shown without `npx`; add it if you haven't installed takeback globally.

| You want to | Terminal | Claude Code plugin |
| --- | --- | --- |
| Undo the agent's last turn | `takeback` | `/takeback:undo` |
| See what that would change first | `takeback -n` | `/takeback:undo -n` |
| Go back one more turn | `takeback` again | `/takeback:undo` again |
| Undo the last turn for one file only | `takeback src/app.ts` | `/takeback:undo src/app.ts` |
| See every checkpoint | `takeback log` | `/takeback:log` |
| Jump to any checkpoint, or redo | `takeback to 3f9c2a1` | `/takeback:to 3f9c2a1` |
| See the last turn as a patch | `takeback diff` | `/takeback:diff` |
| See a file as it was at a checkpoint | `takeback show 3f9c2a1 src/app.ts` | Ask Claude |
| Save a checkpoint by hand | `takeback save "before the refactor"` | |

Every take back prints how to undo it, so you can't lose work by going back too far.

```console
$ takeback log
  42f4f3e  just now        takeback to 966e3c5 · 3 files
  bb9958d  2 minutes ago   claude · after turn · 3 files
  966e3c5  3 minutes ago   claude · before "clean up the build scripts" · 3 files
```

### Your agent can use it too

"Go back to the version from before" is hard for an agent. In a long conversation its memory of earlier files gets summarized, and git only has what was committed. Checkpoints hold every turn exactly, and an agent can read them like you do:

```bash
takeback log                        # which turn was which
takeback show 3f9c2a1 src/app.ts    # a file exactly as it was
takeback diff 3f9c2a1               # everything that changed since
```

With the Claude Code plugin, Claude knows to look there on its own, and restores only when you ask. Any other agent can run the same commands when you tell it to; reading needs no write access, so it works inside Codex's sandbox too.

### Plugins

takeback is also a plugin for Claude Code and for Codex, so each agent lists its hooks by name.

**Claude Code.** Prefer slash commands? Inside Claude Code:

```text
/plugin install takeback --marketplace hichipli/takeback
```

On Claude Code older than 2.1.275, run `/plugin marketplace add hichipli/takeback` first, then `/plugin install takeback@takeback`.

You get the same automatic checkpoints plus `/takeback:undo`, `/takeback:to`, `/takeback:diff` and `/takeback:log`, and Claude sees what was taken back. Claude also learns to read earlier versions from checkpoints when you ask for one. If you also ran `npx takeback init`, the plugin takes over for Claude Code and the hooks from `init` stand down.

**Codex.** `npx takeback init` installs the plugin for you when the `codex` command is available. To install it yourself:

```bash
codex plugin marketplace add hichipli/takeback
```

```bash
codex plugin add takeback@takeback
```

Then approve its two hooks once, in `/hooks` or the ChatGPT app's Hooks page, where they're listed under takeback.

Both plugins run takeback's TypeScript source directly, so they need Node 22.18 or newer.

## Where it works

takeback protects the files on your computer that coding agents change.

| Where you run the agent | Setup |
| --- | --- |
| Claude Code in the terminal, the Claude desktop app (Code tab), or VS Code / JetBrains | `npx takeback init`, or the [plugin](#plugins) |
| Codex in the terminal or the ChatGPT desktop app | `npx takeback init` installs the takeback plugin. Approve its two hooks once with `/hooks`; until then Codex skips them. |
| Cursor, Windsurf, Gemini CLI, OpenCode, Aider, Cline, your own scripts: anything that edits files in a folder | Keep `npx takeback watch` running in that folder. It saves a checkpoint 1.5 s after files stop changing. |
| Claude Code on the web, Codex cloud tasks and other cloud agents | Not covered: those files live on the provider's machines, not yours. |
| Plain chat in ChatGPT, Claude and other apps | Not needed: chat doesn't change files on your computer. If you run `init` anyway, it finds no coding agent and changes nothing. |

## How it works

- `init` sets up two hooks per agent: one before every prompt, one after every turn. For Codex it installs the takeback plugin, so Codex names them when it asks you to approve them. For Claude Code it adds them to `~/.claude/settings.json`, running a copy of takeback in `~/.takeback/app`. Either way a hook takes about 0.1 s.
- Checkpoints go to a separate git repository in `~/.takeback/`. Your project's `.git`, branches, index and stash are never touched, and the project doesn't need to be a git repo at all.
- It follows your `.gitignore` and always skips `node_modules`, `.venv` and `__pycache__`.
- Hooks don't start on a folder that isn't a git repo and holds more than 5,000 files or 500 MB, such as `~/Downloads`. Run `takeback save` there to start anyway.
- Checkpoints older than 30 days are dropped automatically, the same retention Claude Code uses for its own.
- No daemon, no account, no telemetry.

## FAQ

**Does takeback replace git?** No. Commit what you want to keep. takeback is the safety net for the minutes between commits, when an agent is changing many files at once.

**What if the agent already committed?** takeback puts the files back and leaves git history alone, so they show up as uncommitted changes. It says so whenever the branch or commit moved since the checkpoint. To undo the commit itself, use `git revert` or `git reset`.

**What can't it take back?** Files your `.gitignore` excludes (such as `.env` or `dist/`), anything outside the project folder, and side effects like database writes, package installs or `git push`.

**Does it slow my agent down?** The first checkpoint of a project stores a compressed copy of it, which takes a few seconds on large projects (3.6 s for an 850-file app). After that each hook call takes about 0.1 s.

**How much disk does it use?** Git stores each version of a file once, compressed. Old checkpoints go after 30 days. To free space now, run `takeback prune`; `takeback prune --keep 7d` keeps only the last week. Prune also deletes checkpoints of folders that no longer exist.

**Why does takeback say there are no checkpoints?** Either setup hasn't run (`npx takeback init`), Codex hasn't been allowed to run the hooks yet (`/hooks` in Codex), or the folder is a big one that isn't a git repo (`takeback save` starts it). takeback prints these hints itself.

**How do I update?** `npx takeback@latest init`. Plugins update through their agent: `claude plugin update takeback@takeback` for Claude Code; for Codex, `codex plugin marketplace upgrade takeback`, then `codex plugin add takeback@takeback`. If an update changes the hooks, Codex asks you to approve them again.

**How do I uninstall?** `npx takeback init --remove` removes the hooks and the Codex plugin. Remove the Claude Code plugin with `/plugin uninstall takeback@takeback`, then delete `~/.takeback`.

## Roadmap

- [ ] Native hooks for Gemini CLI, OpenCode and DeepSeek Harness
- [ ] Interactive timeline picker

## Contributing

Issues and pull requests are welcome; start with [CONTRIBUTING.md](CONTRIBUTING.md). If takeback saved your afternoon, a ⭐ helps other people find it.

## License

[MIT](LICENSE)
