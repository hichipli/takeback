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

<img src="assets/readme/banner.png" width="880" alt="Ctrl+Z for AI coding agents. Every turn saved, one command back: npx takeback. 0.1 s per checkpoint, 0 dependencies, about 900 lines to read, 30 days of history.">

**Every prompt you send Claude Code or Codex becomes a save point, in the terminal, desktop apps and IDEs.**<br>
**You don't need to know git. When a turn goes wrong, tell the agent to go back.**<br>
<sub>Other agents: `takeback watch`. Your `.git` is never touched, files your `.gitignore` protects are never deleted, and nothing leaves your machine.</sub>

<img src="docs/demo.svg" width="860" alt="An agent deletes scripts/ through Bash, and npx takeback restores it with one command">

</div>

## Quick start

Set it up once. From then on, Claude Code and Codex save a checkpoint before every prompt and after every turn, in every project:

```bash
npx takeback init
```

When an agent breaks something, run this in the project folder. Add `-n` to see what it would do first:

```bash
npx takeback
```

Or skip the command and tell the agent: "go back to before your last change". `init` installs the Claude Code and Codex plugins when it finds their commands, and they teach the agent to restore from checkpoints.

> [!NOTE]
> Codex runs new hooks only after you approve them. Run `/hooks` in Codex once, or open Hooks in the ChatGPT app, and trust the two listed under takeback.

## Why takeback

<img src="assets/readme/compare.png" width="880" alt="Claude Code's /rewind misses files changed through Bash, subagents and other sessions; git only has what was committed; takeback covers all of them and works with any agent.">

- **It catches what built-in undo misses.** Claude Code's `/rewind` skips files changed through Bash, most subagents and other sessions ([docs](https://code.claude.com/docs/en/checkpointing#limitations)), and the Codex CLI [dropped `/undo`](https://github.com/openai/codex/issues/9203).
- **You don't need to know git.** Checkpoints live in their own store, and the project doesn't have to be a git repo. Ask the agent to go back and it restores from them.
- **Your agent gets the real history.** After many turns nobody committed, an agent asked for "the old version" rebuilds it from memory and gets parts wrong. With checkpoints it reads the exact files. [More below](#your-agent-can-use-it-too).
- **One setup for every project and agent.** `init` covers Claude Code and Codex in the terminal, desktop app or IDE. [`takeback watch`](#where-it-works) covers everything else.
- **Going back can always be undone.** Every take back saves where you are first. Your `.git` is never touched, and files your `.gitignore` protects, like `.env`, are never deleted.
- **Small enough to read.** About 900 lines in [two files](#read-the-code), zero dependencies, nothing leaves your machine.

## How it works

<img src="assets/readme/how.png" width="880" alt="A checkpoint is saved when you send a prompt and when the turn ends. npx takeback puts every file back as it was before the prompt.">

- Two hooks per agent, one before every prompt and one after every turn. The plugins register them in [`hooks/hooks.json`](hooks/hooks.json); for Claude Code without the plugin, `init` writes the same two into `~/.claude/settings.json`. Each takes about 0.1 s.
- Checkpoints are commits in a separate git repository under `~/.takeback/`. takeback never writes to your own repository, so your branches, staging area and stash stay as they were, and the project doesn't need to be a git repo at all.
- It follows your `.gitignore` and always skips `node_modules`, `.venv` and `__pycache__`.
- Hooks don't start on a folder that isn't a git repo and holds more than 5,000 files or 500 MB, such as `~/Downloads`. Run `takeback save` there to start anyway.
- Checkpoints older than 30 days are dropped automatically, the same retention Claude Code uses for its own.
- No daemon, no account, no telemetry.

## Commands

Shown without `npx`; add it if you haven't installed takeback globally. The plugin commands link to what they tell the agent.

| You want to | Terminal | Claude Code plugin |
| --- | --- | --- |
| Undo the agent's last turn | `takeback` | [`/takeback:takeback`](claude-skills/takeback/SKILL.md) |
| See what that would change first | `takeback -n` | `/takeback:takeback -n` |
| Go back one more turn | `takeback` again | `/takeback:takeback` again |
| Undo the last turn for one file only | `takeback src/app.ts` | `/takeback:takeback src/app.ts` |
| See every checkpoint | `takeback log` | [`/takeback:takeback-log`](claude-skills/takeback-log/SKILL.md) |
| Jump to any checkpoint, or redo | `takeback to 3f9c2a1` | [`/takeback:takeback-to 3f9c2a1`](claude-skills/takeback-to/SKILL.md) |
| See the last turn as a patch | `takeback diff` | [`/takeback:takeback-diff`](claude-skills/takeback-diff/SKILL.md) |
| See a file as it was at a checkpoint | `takeback show 3f9c2a1 src/app.ts` | [Ask Claude](claude-skills/takeback-checkpoints/SKILL.md) |
| Save a checkpoint by hand | `takeback save "before the refactor"` | |

Every take back prints how to undo it, so going back too far never loses work.

```console
$ takeback log
  42f4f3e  just now        takeback to 966e3c5 · 3 files
  bb9958d  2 minutes ago   claude · after "clean up the build scripts" · 3 files
  966e3c5  9 minutes ago   claude · after "add a release script" · 2 files
```

## Your agent can use it too

<img src="assets/readme/agents.png" width="880" alt="Asked what app.js looked like before its last change, Codex runs takeback log and takeback show and reads the old file from a checkpoint.">

"Go back to the version from before" is hard for an agent: in a long conversation its memory of earlier files gets summarized, and git only has what was committed. Checkpoints hold every turn exactly, and an agent reads them the way you do:

```bash
takeback log                        # which turn was which
takeback show 3f9c2a1 src/app.ts    # a file exactly as it was
takeback diff 3f9c2a1               # everything that changed since
```

With the plugins, the agent looks there on its own and restores only when you ask: see the skill for [Claude Code](claude-skills/takeback-checkpoints/SKILL.md) and for [Codex](codex-skills/takeback-checkpoints/SKILL.md). Reading needs no write access, so it works inside Codex's sandbox too. Any other agent can run the same commands when you tell it to.

## Where it works

takeback protects the files on your computer that coding agents change.

| Where you run the agent | Setup |
| --- | --- |
| Claude Code in the terminal, the Claude desktop app (Code tab), or VS Code / JetBrains | `npx takeback init`, or the [plugin](#plugins) |
| Codex in the terminal or the ChatGPT desktop app | `npx takeback init` installs the [plugin](#plugins). Approve its two hooks once with `/hooks`; until then Codex skips them. |
| Cursor, Windsurf, Gemini CLI, OpenCode, Aider, Cline, your own scripts: anything that edits files in a folder | Keep `npx takeback watch` running in that folder. It saves a checkpoint 1.5 s after files stop changing. |
| Claude Code on the web, Codex cloud tasks and other cloud agents | Not covered: those files live on the provider's machines, not yours. |
| Plain chat in ChatGPT, Claude and other apps | Not needed: chat doesn't change files on your computer. If you run `init` anyway, it finds no coding agent and changes nothing. |

## Plugins

takeback is also a plugin for Claude Code and for Codex, so each agent lists its hooks by name. Both run takeback's TypeScript source directly and need Node 22.18 or newer.

**Claude Code.** `npx takeback init` installs the plugin when the `claude` command is available. It brings the same checkpoints, the [slash commands](#commands), and the skill that has Claude read earlier versions from checkpoints. To install it yourself, inside Claude Code:

```text
/plugin install takeback --marketplace hichipli/takeback
```

Without the `claude` command (say, you only use the desktop app), `init` adds the two hooks to `~/.claude/settings.json` instead. Installing the plugin later takes over from them.

<details>
<summary>On Claude Code older than 2.1.275</summary>

```text
/plugin marketplace add hichipli/takeback
```

```text
/plugin install takeback@takeback
```

</details>

**Codex.** `npx takeback init` installs the plugin when the `codex` command is available. Then approve its two hooks once, in `/hooks` or the ChatGPT app's Hooks page, where they're listed under takeback.

<details>
<summary>Install the Codex plugin yourself</summary>

```bash
codex plugin marketplace add hichipli/takeback
```

```bash
codex plugin add takeback@takeback
```

</details>

## FAQ

<details>
<summary><b>Does takeback replace git?</b></summary>

No. Commit what you want to keep. takeback is the safety net for the minutes between commits, when an agent is changing many files at once.

</details>

<details>
<summary><b>What if the agent already committed?</b></summary>

takeback puts the files back and leaves git history alone, so they show up as uncommitted changes. It says so whenever the branch or commit moved since the checkpoint. To undo the commit itself, use `git revert` or `git reset`.

</details>

<details>
<summary><b>What can't it take back?</b></summary>

- Files your `.gitignore` excludes, such as `.env` or `dist/`.
- Anything outside the project folder, and side effects like database writes, package installs or `git push`.
- Files inside a git repo nested in the project, such as a submodule. Checkpoints hold only its commit, so a take back names it and leaves it alone.
- Empty folders, which git doesn't store.
- On macOS and Windows, a rename that only changes letter case. The content comes back; the name keeps its new case.

</details>

<details>
<summary><b>Does it slow my agent down?</b></summary>

The first checkpoint has to copy the whole project into the store: a few seconds for a big one (3.6 s for an 850-file app). After that only what changed is stored, and a hook takes about 0.1 s.

</details>

<details>
<summary><b>How much disk does it use?</b></summary>

Git stores each version of a file once, compressed. Old checkpoints go after 30 days. To free space now, run `takeback prune`; `takeback prune --keep 7d` keeps only the last week. Prune also deletes checkpoints of folders that no longer exist.

</details>

<details>
<summary><b>Why does takeback say there are no checkpoints?</b></summary>

Either setup hasn't run (`npx takeback init`), Codex hasn't been allowed to run the hooks yet (`/hooks` in Codex), or the folder is a big one that isn't a git repo (`takeback save` starts it). takeback prints these hints itself.

</details>

<details>
<summary><b>How do I update?</b></summary>

`npx takeback@latest init` updates everything, the Claude Code and Codex plugins included. If the `claude` or `codex` command isn't on your PATH, it tells you how to update that plugin from the agent instead. If an update changes the hooks, Codex asks you to approve them again.

</details>

<details>
<summary><b>How do I uninstall?</b></summary>

`npx takeback init --remove` removes the hooks and both plugins, then delete `~/.takeback`. If the `claude` command isn't available, remove the Claude Code plugin inside Claude Code with `/plugin uninstall takeback@takeback`.

</details>

## Similar tools

takeback isn't the only way to get an undo for a coding agent. Depending on how you work, one of these may suit you better:

- **Built into the agent.** Claude Code's checkpoints cover edits made through its own file tools. Cline, Roo Code and Gemini CLI keep a shadow git repo too, and Aider commits every edit to your repo.
- **[jj](https://github.com/jj-vcs/jj).** It snapshots your working copy whenever you run it, so `jj undo` covers much of this if jj is your version control.
- **Other standalone tools**, such as [snap-back](https://github.com/Abelo9996/snap-back), [turnback](https://github.com/MFaizR77/turnback) and [bashback](https://github.com/trouties/bashback). They hook into several agents and snapshot around each tool call or shell command.

takeback saves once before each prompt and once after each turn, and names each checkpoint after your prompt, because a turn is usually what you want to take back. Your project doesn't need to be a git repo, there are no dependencies besides git itself, and the code is small enough to read in one sitting.

## Read the code

Read it before you run it. There's not much:

| File | What it does |
| --- | --- |
| [`src/takeback.ts`](src/takeback.ts) | The checkpoint store: save, take back, diff, show and prune |
| [`src/cli.ts`](src/cli.ts) | Commands, the hook entry point and `init` |
| [`hooks/hooks.json`](hooks/hooks.json) | The two hooks both plugins register |
| [`claude-skills/`](claude-skills/) | The Claude Code slash commands and the skill for reading checkpoints |
| [`codex-skills/`](codex-skills/) | The same skill for Codex |
| [`test/takeback.test.ts`](test/takeback.test.ts) | 24 tests, run on Linux, macOS and Windows |

## Roadmap

- [ ] Native hooks for Gemini CLI, OpenCode and DeepSeek Harness
- [ ] Interactive timeline picker

## Contributing

Issues and pull requests are welcome; start with [CONTRIBUTING.md](CONTRIBUTING.md). If takeback saved your afternoon, a ⭐ helps other people find it.

## License

[MIT](LICENSE)
