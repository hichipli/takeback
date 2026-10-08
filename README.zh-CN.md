<div align="center">

# takeback

**AI 编程智能体的 Ctrl+Z。**

一条命令撤销 Claude Code、Codex、Cursor 等智能体的任意一轮操作，包括它们通过 Bash 改动的文件。

[English](README.md) · 简体中文

<img src="docs/demo.svg" alt="智能体通过 Bash 删掉了 scripts/，takeback 一条命令恢复" width="860">

</div>

## 快速开始

```bash
npx takeback init
```

这样就设置好了。之后 Claude Code 和 Codex 会在每次发送提示词之前、每轮结束之后各保存一个检查点。智能体把东西改坏了，就运行：

```bash
npx takeback
```

用的是 Cursor、Gemini CLI、OpenCode、Aider 或其他工具？在旁边的终端里运行 `npx takeback watch` 即可。

> [!TIP]
> `npm i -g takeback` 全局安装后钩子启动比 `npx` 更快，装好后再运行一次 `takeback init`。

## 为什么需要它

智能体自带的撤销功能有漏洞：

- **Claude Code** 的 `/rewind` 不会恢复通过 Bash 改动的文件（`rm`、`mv`、`sed -i`、代码生成、格式化工具），也不恢复大多数子智能体的修改和其他会话的改动（[官方文档](https://code.claude.com/docs/en/checkpointing#limitations)）。
- **Codex** 去掉了 `/undo`，["Please make /undo back"](https://github.com/openai/codex/issues/9203) 是它点赞最多的未关闭 issue 之一。
- **其他工具**各有各的撤销，或者干脆没有，而且彼此不知道别的智能体做了什么。

git 只有在你按下回车前刚好提交过时才有用。takeback 在每一轮都给**整个项目文件夹**拍快照，不管是哪个工具改的文件。

## 工作原理

- `takeback init` 给 Claude Code 和 Codex 加两个钩子：**每次提示词之前**和**每轮结束之后**各存一个检查点。
- 检查点存放在 `~/.takeback/` 下一个独立的 git 仓库里。项目自己的 `.git`、分支、暂存区和 stash 都不会被碰，项目本身也不需要是 git 仓库。
- 遵守你的 `.gitignore`，并始终跳过 `node_modules`、`.venv`、`__pycache__`，被忽略的构建产物和密钥文件不会进入快照。
- `takeback` 恢复之前会先保存当前状态，所以每一次撤销本身也能撤销。
- 所有数据都留在本机：没有后台进程，没有账号，没有遥测，零运行时依赖。

## 命令

| 命令 | 作用 |
| --- | --- |
| `takeback` | 撤销上一轮；再运行一次继续往回退 |
| `takeback log` | 列出检查点，最新的在前 |
| `takeback to <id>` | 恢复到任意检查点（重做也用它） |
| `takeback diff [from] [to]` | 查看某个检查点之后的改动（加 `--stat` 看摘要） |
| `takeback save [message]` | 手动保存一个检查点 |
| `takeback watch` | 文件停止变化后自动保存检查点，适用于任何工具 |
| `takeback init [claude\|codex]` | 全局安装钩子；`--project` 只装在当前项目，`--remove` 卸载 |

## 支持的智能体

| 智能体 | 设置 | 何时保存检查点 |
| --- | --- | --- |
| Claude Code | `takeback init claude` | 每次提示词之前、每轮结束之后 |
| Codex CLI | `takeback init codex`，然后在 Codex 里用 `/hooks` 信任一次 | 每次提示词之前、每轮结束之后 |
| Cursor、Gemini CLI、OpenCode、Aider、Cline、DeepSeek Harness、你自己的脚本 | `takeback watch` | 文件停止变化 1.5 秒后 |

欢迎为更多智能体贡献原生钩子，见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 常见问题

**takeback 能代替 git 吗？** 不能。想保留的东西请提交。takeback 是两次提交之间的安全网，专门应对智能体一口气改很多文件的时候。

**哪些东西撤销不了？** `.gitignore` 排除的文件（比如 `.env`、`dist/`）、项目文件夹以外的东西，以及数据库写入、安装依赖、`git push` 这类副作用。

**会拖慢智能体吗？** 项目的第一个检查点会存一份压缩副本，大项目要几秒（一个 850 个文件的应用用了 3.6 秒）。之后每次钩子调用约 0.1 秒。

**数据存在哪里？** `~/.takeback/<项目名>-<hash>/`，每个项目一个，随时可以删除。检查点标签包含提示词的前 60 个字符。没有任何数据离开你的电脑。

**怎么卸载？** 先运行 `takeback init --remove`，再 `rm -rf ~/.takeback`。

## 许可证

[MIT](LICENSE)
