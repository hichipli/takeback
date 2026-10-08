"""Generate the README cards as SVG. Run from the repo root, then render each to a 2x PNG:

    python3 assets/readme/cards.py <banner|compare|how|agents> > assets/readme/<name>.svg
    rsvg-convert -w 1760 assets/readme/<name>.svg -o assets/readme/<name>.png

Add `zh` after the name for the Chinese cards, written to assets/readme/zh-CN/. They use PingFang SC,
which macOS keeps outside the folders fontconfig searches: add its folder (find / -name PingFang.ttc)
as a <dir> in a fonts.conf and render with FONTCONFIG_FILE=fonts.conf.
"""
import sys
from xml.sax.saxutils import escape as esc

W = 1760
PAD = 96
BG, LINE, TEXT, MUTED, DIM, GREEN, RED = '#0d1117', '#21262d', '#e6edf3', '#8b949e', '#6e7681', '#3fb950', '#f85149'
ZH = sys.argv[2:] == ['zh']
SANS, MONO = ('PingFang SC', 'Menlo, PingFang SC') if ZH else ('Avenir Next', 'Menlo')


def t(en, zh):
    return zh if ZH else en


def card(h, body, label, headline):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {h}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#161b22"/><stop offset="1" stop-color="{BG}"/></linearGradient>
  </defs>
  <rect width="{W}" height="{h}" rx="32" fill="url(#bg)"/>
  <rect x="1" y="1" width="{W-2}" height="{h-2}" rx="31" fill="none" stroke="#30363d" stroke-width="2"/>
  <text x="{PAD}" y="132" font-family="{MONO}" font-size="22" letter-spacing="{t(6, 3)}" fill="{GREEN}">{esc(label)}</text>
  <text x="{PAD}" y="214" font-family="{SANS}" font-weight="600" font-size="58" letter-spacing="{t(-1, 0)}" fill="{TEXT}">{esc(headline)}</text>
{body}
</svg>
'''


def check(cx, cy, color=GREEN):
    return f'<path d="M{cx-13} {cy} l9 9 l17 -18" fill="none" stroke="{color}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>'


def cross(cx, cy, color=RED):
    return f'<path d="M{cx-10} {cy-10} l20 20 M{cx+10} {cy-10} l-20 20" fill="none" stroke="{color}" stroke-width="5" stroke-linecap="round"/>'


def compare():
    cols = [('Claude /rewind', 1084), ('git', 1324), ('takeback', W - PAD - 110)]
    c = t('if committed', '提交过才有')
    rows = [
        (t("Edits through the agent's file tools", '通过智能体文件工具做的修改'), ['y', c, 'y']),
        (t('Files changed through Bash: rm, mv, codegen', '通过 Bash 改动的文件：rm、mv、代码生成'), ['n', c, 'y']),
        (t('Edits made by subagents', '子智能体做的修改'), ['n', c, 'y']),
        (t('Changes from other sessions and agents', '其他会话和其他智能体的修改'), ['n', c, 'y']),
        (t('Nothing to remember before each prompt', '发提示词前什么都不用记着做'), ['y', 'n', 'y']),
        (t('Works with Codex, Cursor and any agent', '适用于 Codex、Cursor 等任何智能体'), ['n', 'y', 'y']),
    ]
    top, rh = 300, 86
    out = []
    # takeback column, tinted
    out.append(f'  <rect x="{cols[2][1]-110}" y="{top-58}" width="220" height="{58 + rh*len(rows) + 10}" rx="18" fill="{GREEN}" fill-opacity="0.07"/>')
    for name, x in cols:
        color = GREEN if name == 'takeback' else MUTED
        out.append(f'  <text x="{x}" y="{top-18}" text-anchor="middle" font-family="{MONO}" font-size="24" fill="{color}">{esc(name)}</text>')
    for i, (text, cells) in enumerate(rows):
        y = top + i * rh
        out.append(f'  <line x1="{PAD}" y1="{y}" x2="{W-PAD}" y2="{y}" stroke="{LINE}" stroke-width="2"/>')
        cy = y + rh / 2
        out.append(f'  <text x="{PAD}" y="{cy+11}" font-family="{SANS}" font-size="31" fill="{TEXT}">{esc(text)}</text>')
        for (name, x), v in zip(cols, cells):
            if v == 'y':
                out.append('  ' + check(x, cy))
            elif v == 'n':
                out.append('  ' + cross(x, cy))
            else:
                out.append(f'  <text x="{x}" y="{cy+9}" text-anchor="middle" font-family="{SANS}" font-size="26" fill="{MUTED}">{esc(v)}</text>')
    end = top + rh * len(rows)
    out.append(f'  <line x1="{PAD}" y1="{end}" x2="{W-PAD}" y2="{end}" stroke="{LINE}" stroke-width="2"/>')
    out.append(f'  <text x="{PAD}" y="{end+78}" font-family="{SANS}" font-size="27" fill="{MUTED}">{t("takeback snapshots the whole project folder at every turn, whoever changed the files.", "takeback 每一轮都给整个项目文件夹拍快照，不管是谁改的文件。")}</text>')
    return card(end + 136, '\n'.join(out), t('WHY TAKEBACK', '为什么用 TAKEBACK'), t('Built-in undo misses what agents do in the shell.', '自带的撤销，管不到智能体在 Bash 里做的事。'))


def how():
    p = t('clean up the build scripts', '清理一下构建脚本')
    steps = [
        ('dot', t('You send a prompt', '你发送提示词'), f'claude · before "{p}"', GREEN),
        ('ring', t('The agent edits files and runs commands', '智能体改文件、跑命令'), "rm -rf scripts  ·  sed -i 's/1.4/2.0/' package.json", MUTED),
        ('dot', t('The turn ends', '这一轮结束'), f'claude · after "{p}"', GREEN),
        ('arrow', 'npx takeback', t('every file back as it was before the prompt', '所有文件回到提示词之前的样子'), GREEN),
    ]
    top, rh, nx = 300, 112, PAD + 14
    out = [f'  <line x1="{nx}" y1="{top + rh/2}" x2="{nx}" y2="{top + rh*(len(steps)-1) + rh/2}" stroke="#30363d" stroke-width="3"/>']
    for i, (kind, text, note, color) in enumerate(steps):
        y = top + i * rh
        cy = y + rh / 2
        if i:
            out.append(f'  <line x1="{PAD + 64}" y1="{y}" x2="{W-PAD}" y2="{y}" stroke="{LINE}" stroke-width="2"/>')
        if kind == 'dot':
            out.append(f'  <circle cx="{nx}" cy="{cy}" r="13" fill="{GREEN}"/>')
        elif kind == 'ring':
            out.append(f'  <circle cx="{nx}" cy="{cy}" r="11" fill="{BG}" stroke="{MUTED}" stroke-width="4"/>')
        else:
            out.append(f'  <circle cx="{nx}" cy="{cy}" r="22" fill="{BG}" stroke="{GREEN}" stroke-width="3"/>')
            out.append(f'  <g transform="translate({nx-11} {cy-10}) scale(0.0625)" fill="none" stroke="{GREEN}" stroke-width="64" stroke-linecap="round" stroke-linejoin="round"><path d="M120 0 L0 120 L120 240"/><path d="M0 120 H200 a80 80 0 0 1 0 160 H100"/></g>')
        family, size, fill = (MONO, 32, GREEN) if kind == 'arrow' else (SANS, 31, TEXT)
        out.append(f'  <text x="{PAD + 64}" y="{cy+11}" font-family="{family}" font-size="{size}" fill="{fill}">{esc(text)}</text>')
        out.append(f'  <text x="{W-PAD}" y="{cy+9}" text-anchor="end" font-family="{MONO if kind != "arrow" else SANS}" font-size="{24 if kind != "arrow" else 28}" fill="{color}">{esc(note)}</text>')
    end = top + rh * len(steps)
    out.append(f'  <text x="{PAD}" y="{end+62}" font-family="{SANS}" font-size="27" fill="{MUTED}">{t('Checkpoints live in a separate git repo in ~/.takeback. Your project&#8217;s .git is never touched.', '检查点存在 ~/.takeback 里一个独立的 git 仓库，项目自己的 .git 从不被碰。')}</text>')
    return card(end + 120, '\n'.join(out), t('HOW IT WORKS', '工作原理'), t('A checkpoint before every prompt and after every turn.', '每次提示词之前、每轮结束之后，各存一个检查点。'))


def agents():
    out = []
    p = t('make app.js louder', '把输出改成大写')
    rows = [
        (t('you', '你'), [('sans', TEXT, t('What did app.js look like before your last change?', 'app.js 在你上次修改之前是什么样？'))]),
        ('codex', [('mono', GREEN, '$ takeback log'),
                   ('mono', MUTED, f'  71412bb  codex · after "{p}"'),
                   ('mono', MUTED, f'  d9444d5  codex · before "{p}"'),
                   ('mono', GREEN, '$ takeback show d9444d5 app.js'),
                   ('mono', TEXT, 'console.log("v1: hello")')]),
        ('codex', [('sans', TEXT, t('Read it from checkpoint d9444d5, from before the change. It was never committed.', '从修改之前的检查点 d9444d5 读出来的。这个改动从没提交过。'))]),
    ]
    y = 296
    for who, lines in rows:
        h = 40 + 46 * len(lines) + (24 if lines[0][0] == 'mono' else 0)
        out.append(f'  <line x1="{PAD}" y1="{y}" x2="{W-PAD}" y2="{y}" stroke="{LINE}" stroke-width="2"/>')
        out.append(f'  <text x="{PAD}" y="{y + 64}" font-family="{MONO}" font-size="24" fill="{DIM}">{who}</text>')
        ly = y + 64
        if lines[0][0] == 'mono':
            out.append(f'  <rect x="{PAD + 172}" y="{y + 24}" width="{W - 2*PAD - 172}" height="{46*len(lines) + 34}" rx="14" fill="#010409" stroke="{LINE}" stroke-width="2"/>')
            ly += 8
        for kind, color, text in lines:
            x = PAD + 172 + (28 if kind == 'mono' else 0)
            fam, size = (MONO, 26) if kind == 'mono' else (SANS, 31)
            out.append(f'  <text x="{x}" y="{ly}" font-family="{fam}" font-size="{size}" fill="{color}" xml:space="preserve">{esc(text)}</text>')
            ly += 46
        y += h
    out.append(f'  <line x1="{PAD}" y1="{y}" x2="{W-PAD}" y2="{y}" stroke="{LINE}" stroke-width="2"/>')
    out.append(f'  <text x="{PAD}" y="{y+62}" font-family="{SANS}" font-size="27" fill="{MUTED}">{t('Memory of old files gets summarized in a long chat, and git only has what was committed. Checkpoints have every turn.', '长对话里，对旧文件的记忆会被压缩成摘要；git 里只有提交过的内容。检查点保存了每一轮。')}</text>')
    return card(y + 120, '\n'.join(out), t('FOR AGENTS', '智能体也能用'), t('Your agent reads the past instead of guessing it.', '智能体直接读出过去，不用凭记忆去猜。'))


def banner():
    h = 560
    stats = [('0.1', t('s', '秒'), t('per checkpoint', '存一个检查点')), ('0', '', t('dependencies', '依赖')),
             ('~900', '', t('lines to read', '行代码，读得完')), ('30', t('days', '天'), t('of history', '历史保留'))]
    out = [f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {h}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#161b22"/><stop offset="1" stop-color="{BG}"/></linearGradient>
    <radialGradient id="glow" cx="0.25" cy="0.5" r="0.5"><stop offset="0" stop-color="{GREEN}" stop-opacity="0.12"/><stop offset="1" stop-color="{GREEN}" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="{W}" height="{h}" rx="32" fill="url(#bg)"/><rect width="{W}" height="{h}" rx="32" fill="url(#glow)"/>
  <rect x="1" y="1" width="{W-2}" height="{h-2}" rx="31" fill="none" stroke="#30363d" stroke-width="2"/>
  <text x="{PAD+16}" y="180" font-family="{SANS}" font-weight="600" font-size="84" letter-spacing="{t(-2, 2)}" fill="{TEXT}">{t("Ctrl+Z for", "AI 编程智能体的")}</text>
  <text x="{PAD+16}" y="274" font-family="{SANS}" font-weight="600" font-size="84" letter-spacing="{t(-2, 2)}" fill="{TEXT}">{t("AI coding agents.", "Ctrl+Z")}</text>
  <text x="{PAD+18}" y="358" font-family="{SANS}" font-size="34" fill="{MUTED}">{t("Every turn saved. One command back.", "每一轮都有存档，一条命令就回去。")}</text>
  <text x="{PAD+20}" y="434" font-family="{MONO}" font-size="34" fill="{GREEN}"><tspan fill="{DIM}">$</tspan><tspan dx="21">npx takeback</tspan></text>
  <line x1="1020" y1="128" x2="1020" y2="{h-128}" stroke="{LINE}" stroke-width="2"/>''']
    for i, (num, unit, label) in enumerate(stats):
        x, y = 1110 + (i % 2) * 300, 200 + (i // 2) * 168
        u = f'<tspan font-family="{SANS}" font-size="34" font-weight="500" fill="{MUTED}" dx="{t(8, 12)}">{unit}</tspan>' if unit else ''
        out.append(f'  <text x="{x}" y="{y}" font-family="Avenir Next" font-weight="600" font-size="72" letter-spacing="-1" fill="{TEXT}">{esc(num)}{u}</text>')
        out.append(f'  <text x="{x+2}" y="{y+46}" font-family="{SANS}" font-size="28" fill="{MUTED}">{esc(label)}</text>')
    return '\n'.join(out) + '\n</svg>\n'


if __name__ == '__main__':
    print({'banner': banner, 'compare': compare, 'how': how, 'agents': agents}[sys.argv[1]]())
