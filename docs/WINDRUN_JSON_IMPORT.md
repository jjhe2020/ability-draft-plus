# 从 Windrun JSON 刷新客户端数据

关闭 Ability Draft Plus 客户端后，在项目根目录运行：

```powershell
node scripts/import-windrun-data.mjs --input "D:\Downloads\abilities.json" --db "resources\dota_ad_data.db" --db "$env:APPDATA\ability-draft-plus\dota_ad_data.db"
```

`--db` 可以重复指定：`resources` 内的文件是新安装使用的种子数据库，`APPDATA` 内的文件是本机客户端正在使用的数据库。运行完成后再启动客户端即可使用新数据。脚本检查客户端进程和数据库文件变化，避免已运行的客户端把内存中的旧数据写回。

导入会校验整份 `data.abilityStats`，更新技能及英雄的整体胜率、平均选位与实际选取频率，并保留全部英雄行作为 ggxgg 公式的标准化总体。`pick_rate` 仍保存平均选位；JSON 中的 `pickRate` 保存到 `draft_frequency`。不会修改用户公式、界面设置、高分段数据、组合数据或个人战绩，也不会把本次整体数据导入计为一次完整数据抓取。

每个数据库替换前均备份原始文件。默认备份目录为 `test-results/windrun-import/<时间>/`，其中的 `import-report.json` 记录目标路径、源文件 SHA256、Windrun 更新时间和条目数；可用 `--backup-dir` 指定其他目录。

非常旧的种子数据库可能没有技能的 Windrun ID；首次导入可以用 `--ability-catalog <文件路径>` 指定 Valve `abilitylist` 接口保存的 JSON 文件，按内部技能名补上 ID。后续刷新不再需要此参数。遇到本地完全没有的新技能或英雄时，脚本会中止整次导入，需先抓取对应静态元数据。

2026-10-15 导入的 `abilities.json` 为 **7.41f**，Windrun 标记更新时间 **2026-10-15 16:06:11（北京时间）**，包含 **513 个技能、127 个英雄**。
