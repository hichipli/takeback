---
description: Restore this project, or only some files, to a takeback checkpoint. Get ids from /takeback:log. Add -n to preview.
argument-hint: "<checkpoint> [-n] [file...]"
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/src/cli.ts" --slash to $ARGUMENTS 2>&1 || true`

takeback has already run; its output is above. Show that output to the user exactly as it is, in a code block, without rewording or translating it. After the block, add at most one short sentence, and only if something needs explaining.

Files you edited earlier in this conversation may now have older contents, so read a file again before you change it. Don't run commands or edit files in this turn.
