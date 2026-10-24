/**
 * Import an exported Windrun /abilities response into existing client DBs.
 * Close the desktop client first. Each target is backed up before replacement.
 *
 * node scripts/import-windrun-data.mjs --input D:/Downloads/abilities.json \
 *   --db resources/dota_ad_data.db --db <APPDATA>/ability-draft-plus/dota_ad_data.db
 *
 * --ability-catalog accepts Valve's public abilitylist JSON when importing into
 * an old DB without Windrun IDs. The newly populated IDs make later imports
 * independent of this optional metadata file.
 */
import { readFile, writeFile, mkdir, rename, stat } from 'node:fs/promises'
import { dirname, basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import ts from 'typescript'
import initSqlJs from 'sql.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const arguments_ = process.argv.slice(2)
let input
let catalog
let backupDirectory
const targets = []
for (let index = 0; index < arguments_.length; index += 2) {
  const flag = arguments_[index]
  const value = arguments_[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`)
  if (flag === '--input') input = resolve(value)
  else if (flag === '--db') targets.push(resolve(value))
  else if (flag === '--ability-catalog') catalog = resolve(value)
  else if (flag === '--backup-dir') backupDirectory = resolve(value)
  else throw new Error(`Unknown argument: ${flag}`)
}
if (!input || targets.length === 0 || new Set(targets).size !== targets.length) {
  throw new Error(
    'Usage: node scripts/import-windrun-data.mjs --input abilities.json --db path/to/dota_ad_data.db [--db another.db]',
  )
}

function requireClosedClient() {
  if (process.platform !== 'win32') return
  const output = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(Dota 2 Ability Draft Plus|ability-draft-plus|electron)\\.exe$' } | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress",
    ],
    { encoding: 'utf8', windowsHide: true },
  ).trim()
  const found = output ? JSON.parse(output) : []
  const active = (Array.isArray(found) ? found : [found]).filter(
    (item) =>
      item.Name.toLowerCase() !== 'electron.exe' ||
      (item.CommandLine ?? '').toLowerCase().includes('ability-draft-plus'),
  )
  if (active.length)
    throw new Error(
      'Close the Ability Draft Plus desktop client before importing; its in-memory DB could overwrite this update',
    )
}
requireClosedClient()

const bytes = await readFile(input)
const source = {
  filename: basename(input),
  sha256: createHash('sha256').update(bytes).digest('hex'),
  importedAt: new Date().toISOString(),
}
const importerSource = await readFile(
  resolve(root, 'src/core/scraper/windrun-snapshot-import.ts'),
  'utf8',
)
const compiled = ts.transpileModule(importerSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
})
const { validateWindrunSnapshot, importWindrunSnapshot } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`
)
const snapshot = validateWindrunSnapshot(JSON.parse(bytes.toString('utf8')))
const abilityNames = new Map()
if (catalog) {
  const items = JSON.parse(await readFile(catalog, 'utf8')).result?.data?.itemabilities
  if (!Array.isArray(items)) throw new Error('Expected a Valve abilitylist JSON catalog')
  for (const item of items)
    if (Number.isSafeInteger(item.id) && typeof item.name === 'string')
      abilityNames.set(item.id, item.name)
}
const SQL = await initSqlJs()
const prepared = []
// Validate and prepare every database before replacing any target.
for (const path of targets) {
  try {
    if ((await stat(`${path}-wal`)).size > 0)
      throw new Error(`Non-empty WAL at ${path}; close/checkpoint its owning client first`)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const original = await readFile(path)
  // sql.js may reuse and mutate its input buffer during export(). Keep the
  // original bytes isolated for the exact backup and concurrent-write check.
  const db = new SQL.Database(Uint8Array.from(original))
  try {
    const result = importWindrunSnapshot(db, snapshot, source, abilityNames)
    const integrity = db.exec('PRAGMA integrity_check')[0]?.values[0]?.[0]
    if (integrity !== 'ok') throw new Error(`Database integrity check failed: ${path}`)
    prepared.push({
      path,
      original,
      data: Buffer.from(db.export()),
      abilities: result.abilities,
      heroes: result.heroes,
      population: result.population.length,
    })
  } finally {
    db.close()
  }
}
const stamp = source.importedAt.replaceAll(/[:.]/g, '-')
backupDirectory ??= resolve(root, 'test-results/windrun-import', stamp)
await mkdir(backupDirectory, { recursive: true })
for (let index = 0; index < prepared.length; index++) {
  const item = prepared[index]
  item.backup = resolve(backupDirectory, `${index + 1}-${basename(item.path)}`)
  await writeFile(item.backup, item.original, { flag: 'wx' })
}
// Recheck both process state and file hashes after preparation to avoid replacing
// a DB which was changed by a client launched while the import was being built.
requireClosedClient()
for (const item of prepared) {
  const current = await readFile(item.path)
  if (!current.equals(item.original))
    throw new Error(`Database changed during import: ${item.path}; retry after closing the client`)
}
for (const item of prepared) {
  const temporary = `${item.path}.windrun-import-${process.pid}.tmp`
  await writeFile(temporary, item.data, { flag: 'wx' })
  await rename(temporary, item.path)
}
await writeFile(
  resolve(backupDirectory, 'import-report.json'),
  JSON.stringify(
    {
      source,
      patch: snapshot.patches,
      sourceUpdatedAt: snapshot.updatedAt,
      databases: prepared.map(({ path, backup, abilities, heroes, population }) => ({
        path,
        backup,
        abilities,
        heroes,
        population,
      })),
    },
    null,
    2,
  ),
)
console.log(
  JSON.stringify(
    {
      source,
      patch: snapshot.patches,
      sourceUpdatedAt: snapshot.updatedAt,
      databases: prepared.map(({ path, backup, abilities, heroes, population }) => ({
        path,
        backup,
        abilities,
        heroes,
        population,
      })),
    },
    null,
    2,
  ),
)
