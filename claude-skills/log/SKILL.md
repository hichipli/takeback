---
description: List this project's takeback checkpoints, newest first.
argument-hint: "[count]"
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/src/cli.ts" --slash log $ARGUMENTS 2>&1 || true`

Show the list above to the user exactly as it is, in a code block. After it, add one short sentence: `/takeback:to <id>` restores a checkpoint and `/takeback:undo -n` previews the last turn. Don't run anything else.
