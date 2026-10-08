<div align="center">

# takeback

**AI 编程智能体的 Ctrl+Z。**

一条命令撤销 Claude Code、Codex、Cursor 等智能体的任意一轮操作，包括它们通过 Bash 改动的文件。

[English](README.md) · 简体中文

<img src="docs/demo.svg" alt="智能体通过 Bash 删掉了 scripts/，takeback 一条命令恢复" width="860">

</div>

## 快速开始

takeback 是一个小巧的命令行工具，但不管你在哪里用智能体（终端、Claude 或 ChatGPT 桌面 App，还是 IDE），它都能保护你的文件（[详见](#在哪里能用)）。只需设置一次：

```bash
npx takeback init
```

之后在所有项目里，Claude Code 和 Codex 都会在每次发送提示词之前、每轮结束之后各保存一个检查点。不用再装别的，也不用常驻运行什么。`init` 只会配置你电脑上装了的智能体，并告诉你跳过了哪些。

智能体把东西改坏了，就在项目文件夹里运行：

```bash
npx takeback
```

> [!TIP]
> 不用离开当前会话。在终端版 Claude Code 里输入 `!npx takeback`，Claude 也能看到恢复了哪些文件；在桌面 App 里，用自带的终端（<kbd>Ctrl</kbd>+<kbd>`</kbd>）运行。

## 为什么需要它

智能体自带的撤销功能有漏洞：

- **Claude Code** 的 `/rewind` 不会恢复通过 Bash 改动的文件（`rm`、`mv`、`sed -i`、代码生成、格式化工具），也不恢复大多数子智能体的修改和其他会话的改动（[官方文档](https://code.claude.com/docs/en/checkpointing#limitations)）。
- **Codex** 去掉了 `/undo`，["Please make /undo back"](https://github.com/openai/codex/issues/9203) 是它点赞最多的未关闭 issue 之一。
- **其他工具**各有各的撤销，或者干脆没有，而且彼此不知道别的智能体做了什么。

git 只有在你按下回车前刚好提交过时才有用。takeback 在每一轮都给**整个项目文件夹**拍快照，不管是哪个工具改的文件。

## 怎么用

| 你想 | 运行 |
| --- | --- |
| 撤销智能体的上一轮 | `takeback` |
| 再往前退一轮 | 再运行一次 `takeback` |
| 只撤销上一轮对某个文件的改动 | `takeback src/app.ts` |
| 查看所有检查点 | `takeback log` |
| 跳到任意检查点，或者重做 | `takeback to 3f9c2a1` |
| 从任意检查点恢复单个文件 | `takeback to 3f9c2a1 src/app.ts` |
| 查看某个检查点之后改了什么 | `takeback diff [id]`（加 `--stat` 看摘要） |
| 手动保存一个检查点 | `takeback save "大重构之前"` |

每次撤销都会先保存当前状态，并告诉你怎么回去，所以退过头也不会丢东西。

## 在哪里能用

takeback 保护的是编程智能体在你电脑上改动的文件。

| 你在哪里用智能体 | 设置 |
| --- | --- |
| Claude Code：终端、Claude 桌面 App（Code 标签页）、VS Code / JetBrains 插件 | `npx takeback init` |
| 终端或 ChatGPT 桌面 App 里的 Codex | `npx takeback init`，然后在 Codex 提示时批准一次新钩子 |
| Cursor、Windsurf、Gemini CLI、OpenCode、Aider、Cline、你自己的脚本：任何会改文件夹里文件的工具 | 在那个文件夹里保持运行 `npx takeback watch`，文件停止变化 1.5 秒后自动存检查点 |
| 网页版 Claude Code、Codex 云端任务等云端智能体 | 不适用：文件在服务商的机器上，不在你的电脑上 |
| ChatGPT、Claude 等应用里的普通聊天 | 不需要：聊天不会改你电脑上的文件。就算运行了 `init`，它也找不到编程智能体，什么都不会改 |

## 工作原理

- `init` 给 Claude Code 和 Codex 加两个钩子：每次提示词之前一个，每轮结束之后一个。同时把 takeback 本身（约 20 KB，零依赖）复制到 `~/.takeback/app`，所以钩子每次只要约 0.1 秒，也不依赖 npm。
- 检查点存放在 `~/.takeback/` 下一个独立的 git 仓库里。项目自己的 `.git`、分支、暂存区和 stash 都不会被碰，项目本身也不需要是 git 仓库。
- 遵守你的 `.gitignore`，并始终跳过 `node_modules`、`.venv`、`__pycache__`。
- 超过 30 天的检查点会自动清理，和 Claude Code 自己的保留期一样。
- 所有数据都留在本机：没有后台进程，没有账号，没有遥测。

## 常见问题

**takeback 能代替 git 吗？** 不能。想保留的东西请提交。takeback 是两次提交之间的安全网，专门应对智能体一口气改很多文件的时候。

**哪些东西撤销不了？** `.gitignore` 排除的文件（比如 `.env`、`dist/`）、项目文件夹以外的东西，以及数据库写入、安装依赖、`git push` 这类副作用。

**会拖慢智能体吗？** 项目的第一个检查点会存一份压缩副本，大项目要几秒（一个 850 个文件的应用用了 3.6 秒）。之后每次钩子调用约 0.1 秒。

**占多少磁盘？** git 对每个文件版本只存一份并压缩。旧检查点 30 天后自动清理。想马上释放空间就运行 `takeback prune`，`takeback prune --keep 7d` 只保留最近一周。prune 也会删除已经不存在的文件夹的检查点。

**怎么更新？** `npx takeback@latest init`。

**怎么卸载？** 先运行 `npx takeback init --remove`，再 `rm -rf ~/.takeback`。

## 许可证

[MIT](LICENSE)
