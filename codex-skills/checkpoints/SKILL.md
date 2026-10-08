---
name: checkpoints
description: Use when the user wants an earlier version back, asks to undo something from an earlier turn, or asks what a file looked like before. takeback saved a checkpoint of this project before every prompt and after every turn, so earlier versions can be read exactly instead of rebuilt from memory.
---

# takeback checkpoints

takeback keeps checkpoints of the user's project outside its git history. Stay in the project folder and run the CLI that ships with this plugin, two folders above this SKILL.md:

```bash
node <plugin root>/src/cli.ts <command>
```

- `log [count]`: checkpoints, newest first. Each label names the prompt it was saved before, or the turn it was saved after.
- `show <id> <file>`: a file exactly as it was at a checkpoint.
- `diff [id]`: what changed since a checkpoint (default: since the last turn started).
- `to <id> -n [file...]`: preview restoring the project, or only some files, to a checkpoint.
- `to <id> [file...]`: restore. The current state is saved first; the output names the checkpoint that brings it back.

Reading (`log`, `show`, `diff`, previews) works inside the sandbox. Restoring writes to `~/.takeback`, outside the workspace, so request escalated permissions for it. If `node` can't run the TypeScript file (Node older than 22.18), use `npx takeback <command>` instead.

Read whenever it helps. Restore only when the user asked to go back, preview with `-n` first, and afterwards tell the user that `npx takeback to <id>` (the id from the output) undoes the restore.

Prefer checkpoints over your memory of earlier versions: after a long conversation, what you remember may be summarized or wrong, and changes that were never committed are not in git.
