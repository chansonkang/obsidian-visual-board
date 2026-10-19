# 产品展示图

当前版本：0.1.26。所有图片用于展示 Visual Board 的玻璃文件夹、纸张卡片、浅灰网格、留白与胶囊工具栏。

| 文件 | 类型 | 来源 |
| --- | --- | --- |
| [hero-v0.1.26.png](images/hero-v0.1.26.png) | AI 品牌概念图 | 内置 imagegen 生成，参考当前真实界面和早期设计图；不是实际运行截图 |
| [board-overview-v0.1.26.png](images/board-overview-v0.1.26.png) | 当前版本真实界面 | 实际构建的插件界面，公开演示文章、文件夹、图片、便签和播放器 |
| [markdown-editor-v0.1.26.png](images/markdown-editor-v0.1.26.png) | 当前版本真实界面 | 嵌套 Board 与 Markdown 卡片就地编辑、标题、列表、表格和工具栏 |

截图不读取个人 Vault、文章、账号或密钥。播放器演示使用生成的静音 WAV；图片使用项目自带演示素材。截图脚本为 [capture-showcase.mjs](../scripts/capture-showcase.mjs)，可在安装 Chrome 和 playwright-core 后重现：

```sh
npm run build
node scripts/capture-showcase.mjs
```

## 品牌图生成提示词

使用内置 imagegen，不使用 CLI 或个人生图 API Key。参考图分别为实际的 `docs/images/board-overview-v0.1.26.png` 和早期的 `vendor/prototype/design/home-v2.png`。

```text
Use case: ads-marketing. Asset: GitHub README hero, wide landscape 2:1,
premium crafted product art for Visual Board, an actual Obsidian plugin
by Chanson, version 0.1.26.
Input image 1 is the ACTUAL CURRENT PRODUCT visual reference; image 2
is the earlier design reference for aesthetic continuity. Generate a new
editorial product cover, not a screenshot and not an invented dashboard.
Preserve this exact understated product family: translucent frosted
lavender/mint/peach glass folders with white-bordered photo cards peeking
out, white-filled clean black outline sticker icons, tactile matte white
paper Markdown cards with a slightly turned lower corner, one pale mint
sticky note, subtle fine cross grid, soft grey backdrop, charcoal capsule
dock, warm daylight, beautifully soft contact shadows.
Composition: generous calm negative space on left ~40 percent with a big
crisp typographic title, neatly composed product objects on right ~60
percent. Main focus one lavender glass folder, a smaller mint folder
behind, one elegant white note card with small real headings and text
lines (avoid unreadable dense gibberish), tiny thin curved link between
cards, restrained sense of depth. Bottom right a discreet charcoal capsule
with actual tool outline icons (pointer/document/image/folder/link).
No monitor, no laptop, no neon, no gradients as decoration, no dark
background, no unnecessary floating ornaments, no fake controls, no logos
borrowed from other brands.
Typography exact and legible, only these cover texts:
"Visual Board" (large dark charcoal),
"让本地知识，也有设计感。" (Chinese subtitle directly below),
"for Obsidian · by Chanson" (small), "0.1.26" (small discreet).
The note card may read "灵感，从这里生长". Keep all Chinese words exact.
Materials and spacing should feel calm, refined, tactile and plausibly
consistent with the actual current UI. The aesthetic is the main value:
beautiful knowledge workspace, delightful clarity, sophisticated restraint.
Production-quality polished 3D/editorial product visualization.
```
