# Changelog

## 0.3.0 (2026-10-08)

- Claude Code plugin: `/plugin marketplace add hichipli/takeback`, then `/plugin install takeback@takeback`. Same automatic checkpoints, plus `/takeback:undo`, `/takeback:to` and `/takeback:log`.
- `-n` (or `--dry-run`) previews any take back and changes nothing.
- `takeback diff` without arguments shows what `takeback` would undo.
- `takeback log [count]` replaces `takeback log -n <count>`.
- Fixed: if an agent un-ignored a file (for example by emptying `.gitignore`, so `.env` got into a checkpoint), taking back deleted it. Files the target checkpoint ignores are now kept, and ignored files a restore would overwrite are saved first.
- `init` leaves Claude Code alone when the takeback plugin is enabled.

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
