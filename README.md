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

```bash
npx takeback init
```

That's the whole setup. From now on Claude Code and Codex save a checkpoint before every prompt and after every turn. When an agent wrecks something:

```bash
npx takeback
```

Using Cursor, Gemini CLI, OpenCode, Aider, or anything else? Run `npx takeback watch` in a terminal next to it.

> [!TIP]
> `npm i -g takeback` makes the hooks start faster than `npx`. Run `takeback init` again after installing.

## Why

Built-in undo has holes:

- **Claude Code**'s `/rewind` does not restore files changed through Bash (`rm`, `mv`, `sed -i`, codegen, formatters), edits made by most subagents, or changes from other sessions ([docs](https://code.claude.com/docs/en/checkpointing#limitations)).
- **Codex** dropped `/undo`. ["Please make /undo back"](https://github.com/openai/codex/issues/9203) is one of its most upvoted open issues.
- **Every other tool** has its own undo or none, and none of them know what the other agents did.

Git only helps if you remembered to commit right before you pressed Enter. takeback snapshots the **whole project folder** at every turn, no matter which tool touched the files.

## How it works

- `takeback init` adds two hooks to Claude Code and Codex: one saves a checkpoint **before every prompt**, the other **after every turn**.
- Checkpoints go to a separate git repository in `~/.takeback/`. Your project's `.git`, branches, index and stash are never touched, and the project doesn't need to be a git repo at all.
- It follows your `.gitignore` and always skips `node_modules`, `.venv` and `__pycache__`, so ignored builds and secrets stay out.
- `takeback` saves where you are before it restores anything, so every take back can be taken back.
- Everything stays on your machine. No daemon, no account, no telemetry, zero runtime dependencies.

## Commands

| Command | What it does |
| --- | --- |
| `takeback` | Take back the last turn. Run it again to keep going back. |
| `takeback log` | List checkpoints, newest first |
| `takeback to <id>` | Restore any checkpoint (this is also how you redo) |
| `takeback diff [from] [to]` | Show what changed since a checkpoint (`--stat` for a summary) |
| `takeback save [message]` | Save a checkpoint by hand |
| `takeback watch` | Save a checkpoint whenever files settle; works with any tool |
| `takeback init [claude\|codex]` | Install the hooks globally; `--project` for this project only, `--remove` to uninstall |

```console
$ takeback log
  42f4f3e  just now        takeback to 966e3c5 · 3 files
  bb9958d  2 minutes ago   claude · after turn · 3 files
  966e3c5  3 minutes ago   claude · before "clean up the build scripts" · 3 files
```

## Supported agents

| Agent | Setup | When checkpoints are saved |
| --- | --- | --- |
| Claude Code | `takeback init claude` | Before every prompt, after every turn |
| Codex CLI | `takeback init codex`, then trust the hook once with `/hooks` | Before every prompt, after every turn |
| Cursor, Gemini CLI, OpenCode, Aider, Cline, DeepSeek Harness, your own scripts | `takeback watch` | 1.5 s after files stop changing |

Native hooks for more agents are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## FAQ

**Does takeback replace git?** No. Commit what you want to keep. takeback is the safety net for the minutes between commits, when an agent is changing many files at once.

**What can't it take back?** Files your `.gitignore` excludes (such as `.env` or `dist/`), anything outside the project folder, and side effects like database writes, package installs or `git push`.

**Does it slow my agent down?** The first checkpoint of a project stores a compressed copy of it, which takes a few seconds on large projects (3.6 s for an 850-file app). After that a hook call takes about 0.1 s.

**Where is my data?** In `~/.takeback/<project>-<hash>/`, one store per project. Delete it any time. Checkpoint labels include the first 60 characters of your prompt. Nothing leaves your machine.

**How do I uninstall?** `takeback init --remove`, then `rm -rf ~/.takeback`.

## Roadmap

- [ ] Native hooks for Gemini CLI, OpenCode and DeepSeek Harness
- [ ] `takeback prune` to cap disk usage
- [ ] Take back a single file: `takeback to <id> -- path`
- [ ] Interactive timeline picker

## Contributing

Issues and pull requests are welcome; start with [CONTRIBUTING.md](CONTRIBUTING.md). If takeback saved your afternoon, a ⭐ helps other people find it.

## License

[MIT](LICENSE)
