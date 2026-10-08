<div align="center">

# takeback

**Ctrl+Z for AI coding agents.**

Undo any turn of Claude Code, Codex, Cursor & co, including the files they changed through Bash.

[![CI](https://github.com/hichipli/takeback/actions/workflows/ci.yml/badge.svg)](https://github.com/hichipli/takeback/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/takeback)](https://www.npmjs.com/package/takeback)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

English · [简体中文](README.zh-CN.md)

<img src="docs/demo.svg" alt="An agent deletes scripts/ through Bash, and takeback restores it with one command" width="860">

</div>

## Quick start

takeback is a small command-line tool, and it protects your files wherever you use your agent: in a terminal, in the Claude or ChatGPT desktop app, or in your IDE ([details](#where-it-works)). Set it up once:

```bash
npx takeback init
```

From now on, Claude Code and Codex save a checkpoint before every prompt and after every turn, in every project. Nothing else to install or run. `init` only touches the agents it finds on your computer and tells you what it skipped.

When an agent breaks something, run this in the project folder:

```bash
npx takeback
```

> [!TIP]
> No need to leave your session. In Claude Code in the terminal, type `!npx takeback` and Claude sees what was restored. In the desktop app, run it in the built-in terminal (<kbd>Ctrl</kbd>+<kbd>`</kbd>).

## Why

Built-in undo has holes:

- **Claude Code**'s `/rewind` does not restore files changed through Bash (`rm`, `mv`, `sed -i`, codegen, formatters), edits made by most subagents, or changes from other sessions ([docs](https://code.claude.com/docs/en/checkpointing#limitations)).
- **Codex** dropped `/undo`. ["Please make /undo back"](https://github.com/openai/codex/issues/9203) is one of its most upvoted open issues.
- **Every other tool** has its own undo or none, and none of them know what the other agents did.

Git only helps if you remembered to commit right before you pressed Enter. takeback snapshots the **whole project folder** at every turn, no matter which tool touched the files.

## Using it

| You want to | Run |
| --- | --- |
| Undo the agent's last turn | `takeback` |
| Go back one more turn | `takeback` again |
| Undo the last turn for one file only | `takeback src/app.ts` |
| See every checkpoint | `takeback log` |
| Jump to any checkpoint, or redo | `takeback to 3f9c2a1` |
| Restore one file from any checkpoint | `takeback to 3f9c2a1 src/app.ts` |
| See what changed since a checkpoint | `takeback diff [id]` (`--stat` for a summary) |
| Save a checkpoint by hand | `takeback save "before the big refactor"` |

Every take back saves where you are first and prints how to get back, so you can't lose work by taking back too far.

```console
$ takeback log
  42f4f3e  just now        takeback to 966e3c5 · 3 files
  bb9958d  2 minutes ago   claude · after turn · 3 files
  966e3c5  3 minutes ago   claude · before "clean up the build scripts" · 3 files
```

## Where it works

takeback protects the files on your computer that coding agents change.

| Where you run the agent | Setup |
| --- | --- |
| Claude Code in the terminal, the Claude desktop app (Code tab), or VS Code / JetBrains | `npx takeback init`. They all read the same hooks from `~/.claude/settings.json` ([docs](https://code.claude.com/docs/en/desktop#shared-configuration)). |
| Codex in the terminal or in the ChatGPT desktop app (local threads) | `npx takeback init`, then approve the new hooks once when Codex asks (`/hooks` in the terminal). The app runs the same Codex engine and reads the same `~/.codex` config. |
| Cursor, Windsurf, Gemini CLI, OpenCode, Aider, Cline, your own scripts: anything that edits files in a folder | Keep `npx takeback watch` running in that folder. It saves a checkpoint 1.5 s after files stop changing. |
| Claude Code on the web, Codex cloud tasks and other cloud agents | Not covered: those files live on the provider's machines, not yours. |
| Plain chat in ChatGPT, Claude and other apps | Not needed: chat doesn't change files on your computer. If you run `init` anyway, it finds no coding agent and changes nothing. |

## How it works

- `init` adds two hooks to Claude Code and Codex: one before every prompt, one after every turn. It also copies takeback (about 20 KB, zero dependencies) to `~/.takeback/app`, so hooks take about 0.1 s and don't depend on npm.
- Checkpoints go to a separate git repository in `~/.takeback/`. Your project's `.git`, branches, index and stash are never touched, and the project doesn't need to be a git repo at all.
- It follows your `.gitignore` and always skips `node_modules`, `.venv` and `__pycache__`.
- Checkpoints older than 30 days are dropped automatically, the same retention Claude Code uses for its own.
- Everything stays on your machine. No daemon, no account, no telemetry.

## FAQ

**Does takeback replace git?** No. Commit what you want to keep. takeback is the safety net for the minutes between commits, when an agent is changing many files at once.

**What can't it take back?** Files your `.gitignore` excludes (such as `.env` or `dist/`), anything outside the project folder, and side effects like database writes, package installs or `git push`.

**Does it slow my agent down?** The first checkpoint of a project stores a compressed copy of it, which takes a few seconds on large projects (3.6 s for an 850-file app). After that each hook call takes about 0.1 s.

**How much disk does it use?** Git stores each version of a file once, compressed. Old checkpoints go after 30 days. To free space now, run `takeback prune`; `takeback prune --keep 7d` keeps only the last week. Prune also deletes checkpoints of folders that no longer exist.

**How do I update?** `npx takeback@latest init`.

**How do I uninstall?** `npx takeback init --remove`, then `rm -rf ~/.takeback`.

## Roadmap

- [ ] Native hooks for Gemini CLI, OpenCode and DeepSeek Harness
- [ ] Claude Code plugin
- [ ] Interactive timeline picker

## Contributing

Issues and pull requests are welcome; start with [CONTRIBUTING.md](CONTRIBUTING.md). If takeback saved your afternoon, a ⭐ helps other people find it.

## License

[MIT](LICENSE)
