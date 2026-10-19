# GitHub 发布与更新

本项目已经准备好 GitHub Release 构建工作流，更新源配置为 [`chansonkang/obsidian-visual-board`](https://github.com/chansonkang/obsidian-visual-board)。仓库页面与 [Releases](https://github.com/chansonkang/obsidian-visual-board/releases) 可分别核对源码和已公开的安装版本；配置仓库地址并不代表首个 Release 已发布。请将这个插件源码目录作为仓库根目录，不要把整个 Obsidian 知识库上传。

## 首次连接仓库

1. 创建或打开公开仓库 `chansonkang/obsidian-visual-board`。
2. 当前 `update-source.json` 已配置该仓库。以后迁移仓库时，在本源码目录运行 `node scripts/configure-repository.mjs 新用户名/新仓库名`，提交生成的 `update-source.json`。也支持完整的 `https://github.com/用户名/仓库名` 地址。
3. 提交源码、`vendor/`、`scripts/`、`tests/`、`package-lock.json`、`manifest.json`、`versions.json` 和 `.github/`。`vendor/prototype/` 是可独立构建所需的界面资源，不能省略。
4. 按下文准备版本并推送对应标签。GitHub Actions 会自动从 `GITHUB_REPOSITORY` 读取实际仓库，在构建时写入更新源。

`.gitignore` 已排除本地布局、恢复草稿、证据目录、环境变量、依赖和构建产物。它不会移除已经提交过的文件；首次公开前应检查 GitHub 的待提交文件列表。不要上传 Vault、API Key 或 `.obsidian/`。

## 发布一个新版本

以 `0.1.28` 为示例（请使用下一个尚未发布的版本号）：

```sh
node scripts/version-bump.mjs 0.1.28
# 在 docs/CHANGELOG.md 添加完整的「## 0.1.28 更新」段落
npm ci
npm run typecheck
npm run build
npm test
node scripts/release-package.mjs 0.1.28
node scripts/release-notes.mjs 0.1.28
git add .
git commit -m "Release 0.1.28"
git push origin HEAD
git tag 0.1.28
git push origin 0.1.28
```

标签必须是 `0.1.28`，不要写成 `v0.1.28`。版本脚本同步根目录 manifest、package、lockfile 和 `versions.json`。Release 工作流会重新安装依赖、检查、测试、构建和打包，随后发布正式 GitHub Release。不要重复覆盖已经发布的标签；修复时发布一个新的版本。

每次发版先在 `docs/CHANGELOG.md` 添加对应版本的完整更新说明。工作流从这份已提交历史中提取**完全匹配当前版本**的段落，生成 `release/RELEASE-NOTES.md` 并作为 GitHub Release 正文；文末链接该标签下的 README 和完整更新记录。缺少、重复或空白的版本段落会中止发布，避免把旧版本说明贴到新版。生成的说明不会改写历史文件，也不作为安装附件上传。旧标签、旧记录保持不变，包括被检查阻止而未产生正式 Release 的版本。

Release 附件包括供 Obsidian 使用的独立 `main.js`、`manifest.json`、`styles.css`，第三方许可证，朋友手动安装用的 `Visual-Board-v版本-Chanson.zip` 和 `SHA256SUMS.txt`。ZIP 由明确的文件清单生成，只含运行文件、第三方许可证及 README，不会打包 `data.json`、恢复草稿、布局备份或本地设置。

GitHub 工作流使用仓库提供的短期 `GITHUB_TOKEN`，不需要把个人 Token 或生图 API Key 放进插件。发布步骤需要仓库允许工作流的 `contents: write` 权限。私有仓库的更新检查不在本方案范围内；使用公开仓库可避免让朋友配置 GitHub Token。

## 用户怎样获得更新

安装包含更新入口的新版后，插件可从配置的公开 GitHub Release 获取最新正式版本。朋友仍在使用 `0.1.25` 或更早版本时，需要先手动更新一次；旧版本无法凭空获得后续加入的检查功能。0.1.26 已包含实际仓库更新源，发布完成后可从 [最新正式 Release](https://github.com/chansonkang/obsidian-visual-board/releases/latest) 获取安装包。

插件更新入口只检查版本、显示说明并打开浏览器中的发布页或下载链接，不在插件内自动安装或执行新代码。手动安装只更新运行文件并保留现有 `data.json`、恢复草稿、文章和布局，不删除整个插件目录。也可通过 [BRAT](https://github.com/TfTHacker/obsidian42-brat) 添加本仓库，由 BRAT 管理下载和重载。不能保证 GitHub 在所有网络环境均可访问；网络失败时继续使用本地版本并允许以后重试。

自动检查默认每天一次，可关闭，仍保留主动检查入口。联网仅请求公开 Release 元数据和 manifest，不上传笔记、布局、文件名或 API Key；浏览器下载另行访问 GitHub。不支持私有仓库更新，也不要求朋友配置 GitHub Token。

## 未来提交 Obsidian 社区目录

公开 GitHub Release 与进入 Obsidian 官方社区目录是两个步骤。目前插件 id 为 `obsidian-visual-board`，已有用户以此 id 存储设置。官方当前要求新提交的 id 不包含 `obsidian`；不能直接改 id，否则已有安装可能被识别为另一个插件。正式提交前需要准备明确的数据迁移方案。

社区目录还要求根目录 `LICENSE`、README、manifest、合规名称/描述及审核。当前没有替作者选择或授予源码许可证；已有第三方许可证不能代替插件自身的 LICENSE。作者确定许可方式后再添加该文件。

Obsidian 官方文档要求 Release tag 和 manifest 版本完全匹配，安装时读取 Release 附件中的 `main.js`、`manifest.json` 和可选的 `styles.css`。插件进入社区目录后，用户可以从 Obsidian 下载后续 GitHub Releases。公开 GitHub 仓库或 Release 不等于通过官方社区目录审核。[官方提交和发布说明](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin)、[manifest 规范](https://docs.obsidian.md/Reference/Manifest)。

## 构建工作流依据

工作流使用 Node.js 24、`actions/checkout@v7.0.1` 和 `actions/setup-node@v7.1.0`，版本于 2026-10-19 按官方 Release 页面核对。[checkout Release](https://github.com/actions/checkout/releases/tag/v7.0.1)、[setup-node Release](https://github.com/actions/setup-node/releases/tag/v7.1.0)。发布权限遵循 [GitHub Token 权限说明](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token)，附件发布使用 [GitHub CLI release create](https://cli.github.com/manual/gh_release_create) 的 `--verify-tag` 与 `--notes-file`，直接读取本版本的完整说明。
