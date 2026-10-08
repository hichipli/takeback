---
description: Show what /takeback:undo would undo, as a patch. Give a checkpoint id to see the changes since it.
argument-hint: "[checkpoint] [checkpoint]"
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/src/cli.ts" --slash diff $ARGUMENTS 2>&1 || true`

takeback has already run; its output is above. Show it to the user exactly as it is, in a diff code block. After the block, add at most one short sentence. Don't run commands or edit files in this turn.
