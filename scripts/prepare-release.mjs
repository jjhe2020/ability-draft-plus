import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Invalid release version: ${version}`)
const dist = join(root, 'dist')
const share = join(dist, 'share')
const installer = `AbilityDraftPlus-Setup-${version}-x64.exe`
const portable = `AbilityDraftPlus-Portable-${version}-x64.exe`
for (const name of [installer, portable]) {
  if (!(await stat(join(dist, name))).isFile()) throw new Error(`Missing build artifact: ${name}`)
}
await mkdir(share, { recursive: true })
// This directory contains only generated release files. Refuse unexpected folders.
for (const entry of await readdir(share, { withFileTypes: true })) {
  if (!entry.isFile()) throw new Error(`Unexpected directory in release output: ${entry.name}`)
}
for (const name of await readdir(share)) await unlink(join(share, name))
for (const name of [installer, portable]) await copyFile(join(dist, name), join(share, name))

const instructions = `Dota 2 Ability Draft Plus 中文分享版 ${version}

适用系统：Windows 10/11，64 位。无需安装 Node.js 或其他开发工具。

推荐：解压 ZIP 后双击 ${portable} 即可启动。
长期使用：运行 ${installer}，按向导安装，可创建桌面和开始菜单快捷方式。
免安装版仍会在 Windows 用户目录保存设置和数据；请不要同时运行两个版本。

首次使用
1. 界面和 Dota 英雄、技能名称默认简体中文。
2. 已附带技能统计数据、识别模型及常用分辨率布局，可以直接开始。
3. 在设置中按需调整“单技能选位规则”和 ggxgg 系数，公式选位越低越优先。
4. 打开 Dota 2，进入技能征召。主界面点击“激活悬浮窗”。
5. 选技界面加载完后按 Ctrl+Shift+S 扫描；选技过程中按 Ctrl+Shift+R 重新扫描。
6. 需要个性化推荐时，在悬浮窗选择自己的位置和英雄模型。
7. 识别位置不准确时，检查游戏分辨率并使用校准功能。

数据与更新
已附带本次发布的统计快照。需要较新数据时，可在“数据”页尝试更新 Windrun 数据；
在线数据更新、Twitch 等功能依赖相应网络服务。首次使用 OCR 会联网下载英文识别数据。
截图上传和崩溃上报需要单独配置，本分享版默认未配置。
此版本通过私人 GitHub 仓库发布，默认关闭应用内在线更新。收到新版安装文件后，
退出旧版，再运行新安装器或新免安装文件即可。私有 Release 链接需要仓库访问权限。
本机的账号、Twitch 配对、玩家资料和个人设置没有包含在分享包内。

Windows 提示
此个人分发版没有商业代码签名。首次启动可能出现“Windows 已保护你的电脑”；
请先确认文件来自朋友本人并核对 SHA256SUMS.txt，再根据系统提示选择运行。

完整项目及发布记录：https://github.com/jjhe2020/ability-draft-plus
基于 Tiarin Hino 的 Ability Draft Plus 项目修改，原 ISC 许可证见 LICENSE.txt。
`
await writeFile(join(share, '使用说明.txt'), '\uFEFF' + instructions.replaceAll('\n', '\r\n'), 'utf8')
await copyFile(join(root, 'LICENSE'), join(share, 'LICENSE.txt'))

const zipName = `AbilityDraftPlus-${version}-Windows-x64.zip`
const zip = new AdmZip()
for (const name of [portable, '使用说明.txt', 'LICENSE.txt']) zip.addLocalFile(join(share, name))
zip.writeZip(join(share, zipName))

const assetNames = [installer, portable, zipName, '使用说明.txt', 'LICENSE.txt']
const checksums = []
for (const name of assetNames) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(join(share, name))) hash.update(chunk)
  checksums.push(`${hash.digest('hex')}  ${name}`)
}
await writeFile(join(share, 'SHA256SUMS.txt'), checksums.join('\n') + '\n', 'utf8')
await writeFile(join(share, 'release-notes.md'), `# 中文分享版 v${version}

- 推荐朋友使用：下载并解压 **${zipName}**，双击其中的免安装 EXE。
- 长期使用：下载 **${installer}**，按向导安装。
- 默认简体中文，含当前统计快照、技能识别模型、自定义选位和 ggxgg 系数设置。
- 内附中文使用说明、ISC 许可证和 SHA-256 校验文件。
- 私有仓库 Release 需要访问权限；可以直接将 ZIP 或 EXE 转发给朋友。
- 默认关闭应用内自动更新；之后推送 main 的代码通过检查后会自动生成新版 Release。

源码保留基础版本号；自动发布时采用标签版本写入安装包，具体版本以本 Release 和应用“关于”为准。
`, 'utf8')
console.log(`Release ${version} prepared in ${share}`)
for (const name of [...assetNames, 'SHA256SUMS.txt']) {
  console.log(`${name}: ${((await stat(join(share, name))).size / 1024 / 1024).toFixed(1)} MiB`)
}
