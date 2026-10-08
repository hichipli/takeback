# Contributing

Thanks for helping. takeback is small on purpose: one core file, one CLI file, zero runtime dependencies. Please keep it that way.

## Setup

You need Node 22.18+ (it runs the TypeScript sources directly) and git 2.23+.

```bash
git clone https://github.com/hichipli/takeback && cd takeback
npm install
npm test
node src/cli.ts --help      # run from source
```

To try your changes with real agents, run `node src/cli.ts init`: the hooks then run your working copy until you run `npx takeback@latest init` again.

The Claude Code plugin (`.claude-plugin/`, `hooks/`, `skills/`) runs `src/cli.ts` directly, with no build step. Load your working copy with `claude --plugin-dir .` and check it with `claude plugin validate .`. Keep the `version` in `.claude-plugin/plugin.json` equal to the one in `package.json`; a test enforces it.

## Pull requests

- One change per pull request. If it changes behavior, add or update a test in `test/takeback.test.ts`.
- Use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages and PR titles, for example `feat(cli): add prune command` or `fix(core): keep file modes on restore`.
- CI runs on Linux, macOS and Windows with Node 22 and 24.

## Adding a native hook for another agent

You need three facts about the agent: the file it reads hooks from, the events it fires before a prompt and after a turn, and the JSON it sends to the hook on stdin (at least the working directory). Add the agent to `AGENTS` and `hookFile` in `src/takeback.ts`, and map its events to labels in the `hook` function in `src/cli.ts`. A hook must print nothing to stdout and must never exit non-zero, because some agents feed hook output back to the model.

## Releasing (maintainers)

```bash
npm version <patch|minor|major>
git push --follow-tags
npm publish
```
