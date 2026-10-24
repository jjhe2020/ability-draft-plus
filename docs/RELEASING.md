# 中文个人版发布

私有仓库：https://github.com/jjhe2020/ability-draft-plus

## 给朋友分享

在 `dist/share/` 或仓库 Release 下载 `AbilityDraftPlus-版本-Windows-x64.zip`，直接转发即可。朋友解压后双击其中的 Portable EXE。长期使用可选择 Setup EXE 安装版。支持 Windows 10/11 x64，不需要 Node.js。

ZIP 内附中文说明和原项目 ISC 许可证。`SHA256SUMS.txt` 校验 Release 中的安装器、免安装程序、ZIP、说明及许可证。可以用 PowerShell 的 `Get-FileHash -Algorithm SHA256 文件路径` 核对。

GitHub 私有仓库的 Release 也需要访问权限。朋友无需获得源码权限即可接收你转发的文件。分享包不包含本机用户目录、账号配对、玩家资料或个人设置；默认没有截图上传和 Sentry 服务配置。

安装版及免安装版使用同一个 Windows 用户数据目录，不要同时运行。此版本沿用原版应用身份，安装时可能覆盖原版。首次使用 OCR 会联网下载识别语言数据，在线统计更新和 Twitch 功能也需要对应服务可访问。

## 本地打包

使用 Windows x64、Node.js 22 和 npm：

```powershell
npm ci
npm run typecheck
npm run lint
npm test
node --test scripts/release-version.test.mjs
npm run package:release
npm run test:e2e
```

`npm run build:dist` 构建安装器和 Portable EXE，明确禁用上传。`npm run package:release` 还会整理 `dist/share/`，生成中文说明、分享 ZIP、校验文件和发布说明。该目录仅存放生成文件，重新打包会替换其中的旧文件。

## 自动发布

1. 完成功能后，提交并推送到本仓库的 `main` 分支。
2. `Release` 工作流安装锁文件指定的依赖，检查类型、代码规范和测试，再构建安装器及分享包。
3. 工作流运行真实 Electron 的启动、直播服务、中文设置与悬浮窗测试。失败时不会发布正式 Release。
4. 全部通过后，以当前提交为来源创建版本标签和私有 Release，并上传分享包与校验文件。

发布默认版本为 `package.json` 的基础版本。若该版本已用，自动递增当前最高正式版本的 patch，例如 `3.2.1`、`3.2.2`。同一提交已有版本标签时复用该版本；已经发布的 Release 重跑时保留原附件。CI 只在打包工作区写入分配的版本，不会生成机器人提交或再次触发发布。源码中的版本作为基础版本，安装包内实际版本以 Release 标签为准。

需要指定新版本系列时，更新并提交 `package.json` 和 `package-lock.json` 中的版本，再推送 main。也可推送 `vX.Y.Z` 标签发布指定稳定版本，或在 GitHub Actions 手动运行 `Release`。不要向个人仓库推送原作者的历史版本标签。

`Release` 使用 GitHub 自动提供的 `GITHUB_TOKEN`（`contents: write`）发布到当前个人仓库，不需要创建 PAT 或把 token 放进应用。发布作业串行执行，避免并行分配相同版本。草稿上传中途失败时保持草稿，可重跑工作流。

## 应用内更新与服务配置

自动制作 Release 与应用内自动更新分别控制。此私有分发默认 `AUTO_UPDATE_ENABLED=false`，避免朋友没有 GitHub 权限时不断收到更新错误；用户点击检查更新会看到通过分享安装包更新的说明。

只有为用户提供可访问的更新源后，才应显式设置 `AUTO_UPDATE_ENABLED=true` 构建。不要将个人 GitHub token 放入安装包。

截图上传、崩溃上报等为可选服务。发布工作流不向分享包注入这些服务的凭据。本地 `.env` 可控制开发构建，生成配置属于忽略文件；`node_modules/`、构建中间产物及本机账号数据也不上传源码仓库。

原仓库地址保存在本地 `upstream` 远程，个人私有仓库使用 `origin`。本仓库保留原提交历史和许可证。
