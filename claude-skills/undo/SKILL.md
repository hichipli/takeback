---
description: Take back the last turn in this project, or only some files. Add -n to preview without changing anything.
argument-hint: "[-n] [file...]"
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/src/cli.ts" $ARGUMENTS 2>&1 || true`

takeback has already run; its output is above. In one or two short sentences, tell the user what was taken back (or, for a preview, what would be). If the output ends with `takeback to <id>`, tell them `/takeback:to <id>` brings the previous state back.

Files you edited earlier in this conversation may now have older contents, so read a file again before you change it. Don't run commands or edit files in this turn.
