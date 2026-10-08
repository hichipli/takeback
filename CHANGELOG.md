# Changelog

## 0.4.2 (2026-10-08)

- The "git moved" note also covers checkpoints that have no git record: ones saved before 0.4.1, or before the project's first commit. If the current commit was made after the checkpoint, takeback says so.
- Windows: a folder keeps the same checkpoints when it becomes a git repo. Before, a short 8.3 path (like `RUNNER~1`) and git's long path counted as two different folders.

## 0.4.1 (2026-10-08)

- Claude Code plugin: commands show takeback's output as it is instead of a summary, and their hints name the plugin commands (`/takeback:undo`, `/takeback:to`, `/takeback:diff`) rather than terminal ones.
- New `/takeback:diff` shows what `/takeback:undo` would undo, as a patch.
- Take backs and previews say when the project's git branch or commit moved since the checkpoint: files come back as uncommitted changes, and commits stay.
- `takeback diff` opens with a line naming the checkpoint and the command that reverts the changes. It goes to stderr, so a piped patch stays clean.
- `takeback show <id> <file>` prints a file exactly as it was at a checkpoint.
- Claude Code and Codex plugins: a skill tells the agent to read earlier versions from checkpoints instead of rebuilding them from memory. It restores only when you ask.
- The Codex plugin shows three example prompts in the ChatGPT app.
- `npx takeback@latest init` also updates the Claude Code and Codex plugins, so one command updates everything.
- `init` stops asking you to approve the Codex hooks once you have.
- Reading (`log`, `diff`, `show`, previews) takes no lock and writes nothing to the store, so agents can run it inside a sandbox such as Codex's.
- Outside git, takeback run from a subfolder finds the checkpoints of the folder above.

## 0.4.0 (2026-10-08)

- Codex plugin. `init` installs it when the `codex` command is available, so Codex and the ChatGPT app list takeback's hooks by name, with its logo, when they ask you to approve them. Without it they showed up as an anonymous "User config · Hook 1".
- Claude Code and Codex share one plugin hook file; the Claude Code commands moved to `claude-skills/`.
- A logo, used in the README and in both plugin listings.
- `init` says plainly that Codex skips new hooks until you approve them, and `takeback` explains the usual reasons a folder has no checkpoints.
- With a takeback plugin enabled, the hooks from `init` stand down, and re-running `init` removes them, so checkpoints aren't saved twice.
- Hooks don't start checkpointing a folder that isn't a git repo and holds more than 5,000 files or 500 MB. `takeback save` starts one by hand.
- `takeback log`, `diff` and `-n` no longer create an empty store in folders without checkpoints.
- A git lock left behind by a killed hook no longer blocks later checkpoints.

## 0.3.0 (2026-10-08)

- Claude Code plugin: `/plugin marketplace add hichipli/takeback`, then `/plugin install takeback@takeback`. Same automatic checkpoints, plus `/takeback:undo`, `/takeback:to` and `/takeback:log`.
- `-n` (or `--dry-run`) previews any take back and changes nothing.
- `takeback diff` without arguments shows what `takeback` would undo.
- `takeback log [count]` replaces `takeback log -n <count>`.
- Fixed: if an agent un-ignored a file (for example by emptying `.gitignore`, so `.env` got into a checkpoint), taking back deleted it. Files the target checkpoint ignores are now kept, and ignored files a restore would overwrite are saved first.
- `init` leaves Claude Code alone when the takeback plugin is enabled.
- Fixed: `takeback diff` could miss an edit made in the same second as the last checkpoint.

## 0.2.0 (2026-10-08)

- `takeback <file>` takes back the last turn for just those files; `takeback to <id> <file>` restores them from any checkpoint.
- Every take back lists the files it restored, removed and reverted.
- Checkpoints older than 30 days are dropped automatically. `takeback prune [--keep 7d]` frees space right away and removes checkpoints of folders that no longer exist.
- Setup is one command: `npx takeback init` copies takeback to `~/.takeback/app`, so hooks take about 0.1 s without a global install.
- `init` only sets up the agents installed on this computer and says what it skipped, so running it without Claude Code or Codex changes nothing.
- Fixed: re-running `init` could add duplicate hooks, and `init --remove` could miss them, when `TAKEBACK_HOME` was set.

## 0.1.0 (2026-10-08)

- Checkpoints before every prompt and after every turn in Claude Code and Codex, installed with `takeback init`.
- `takeback watch` saves checkpoints for any other tool.
- `takeback`, `takeback to`, `log`, `diff` and `save`.
