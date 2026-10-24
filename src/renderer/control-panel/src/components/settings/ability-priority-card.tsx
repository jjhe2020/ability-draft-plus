import { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RotateCcw } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import { useIpcQuery } from '../../hooks/use-ipc-query'
import {
  DEFAULT_ABILITY_PRIORITY,
  PRIORITY_VARIABLES,
  calculateAbilityPriorities,
  validateAbilityPrioritySettings,
  type AbilityPrioritySettings,
  type PriorityRow,
} from '@shared/ability-priority'
import { localizeAbilityName } from '@shared/localization/dota-names'
import type { AppSettings } from '@shared/types'

interface AbilityPriorityCardProps {
  currentValue: AbilityPrioritySettings | null
  loading?: boolean
  loadError?: string | null
  onSave: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>
}

interface EditorDraft {
  mode: AbilityPrioritySettings['mode']
  winWeight: string
  pickWeight: string
  formula: string
}

function toDraft(config: AbilityPrioritySettings): EditorDraft {
  return {
    mode: config.mode,
    winWeight: String(config.winWeight),
    pickWeight: String(config.pickWeight),
    formula: config.formula,
  }
}

export function AbilityPriorityCard({
  currentValue,
  loading = false,
  loadError = null,
  onSave,
}: AbilityPriorityCardProps) {
  const { t, i18n } = useTranslation('settings')
  const id = useId()
  const abilitiesQuery = useIpcQuery('ability:getAll')
  const populationQuery = useIpcQuery('ability:getPriorityPopulation')
  const heroesQuery = useIpcQuery('hero:getAll')
  const [draft, setDraft] = useState<EditorDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const persisted = currentValue ?? DEFAULT_ABILITY_PRIORITY
  const editor = draft ?? toDraft(persisted)
  const dirty =
    draft !== null &&
    (editor.mode !== persisted.mode ||
      editor.winWeight !== String(persisted.winWeight) ||
      editor.pickWeight !== String(persisted.pickWeight) ||
      editor.formula !== persisted.formula)
  const dataLoading =
    abilitiesQuery.loading ||
    populationQuery.loading ||
    (populationQuery.data === null && heroesQuery.loading)
  const dataError =
    loadError ??
    abilitiesQuery.error ??
    populationQuery.error ??
    (populationQuery.data === null ? heroesQuery.error : null)

  const preview = useMemo(() => {
    const rows: PriorityRow[] = populationQuery.data ?? [
      ...(abilitiesQuery.data ?? []),
      ...(heroesQuery.data ?? []).map((hero) => ({ ...hero, name: `hero:${hero.name}` })),
    ]
    try {
      if (editor.winWeight.trim() === '' || editor.pickWeight.trim() === '') {
        throw new Error(t('abilityPriority.invalidWeights'))
      }
      const config = validateAbilityPrioritySettings({
        mode: editor.mode,
        winWeight: Number(editor.winWeight),
        pickWeight: Number(editor.pickWeight),
        formula: editor.formula,
      })
      const result = calculateAbilityPriorities(rows, config)
      const strongest = (abilitiesQuery.data ?? [])
        .flatMap((ability) => {
          const priority = result.priorities.get(ability.name)
          return priority === undefined ? [] : [{ ability, priority }]
        })
        .sort((left, right) => left.priority - right.priority)
        .slice(0, 5)
      return { config, count: result.count, total: rows.length, strongest, error: null }
    } catch (error) {
      return {
        config: null,
        count: 0,
        total: rows.length,
        strongest: [],
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }, [
    editor.mode,
    editor.winWeight,
    editor.pickWeight,
    editor.formula,
    abilitiesQuery.data,
    populationQuery.data,
    heroesQuery.data,
    t,
  ])

  const edit = (change: Partial<EditorDraft>) => {
    setDraft((previous) => ({ ...(previous ?? toDraft(persisted)), ...change }))
    setSaved(false)
    setSaveError(null)
  }
  const saveDisabled =
    !dirty ||
    loading ||
    saving ||
    dataLoading ||
    dataError !== null ||
    preview.error !== null ||
    (editor.mode === 'custom' && preview.count === 0)
  const isDefault =
    editor.mode === DEFAULT_ABILITY_PRIORITY.mode &&
    editor.winWeight === String(DEFAULT_ABILITY_PRIORITY.winWeight) &&
    editor.pickWeight === String(DEFAULT_ABILITY_PRIORITY.pickWeight) &&
    editor.formula === DEFAULT_ABILITY_PRIORITY.formula

  const handleSave = async () => {
    if (saveDisabled || preview.config === null) return
    setSaving(true)
    setSaveError(null)
    try {
      await onSave('abilityPriority', preview.config)
      setDraft(null)
      setSaved(true)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('abilityPriority.title')}</CardTitle>
        <CardDescription>{t('abilityPriority.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <fieldset disabled={loading || saving} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor={`${id}-mode`} className="text-sm font-medium">
              {t('abilityPriority.mode')}
            </label>
            <select
              id={`${id}-mode`}
              value={editor.mode}
              onChange={(event) =>
                edit({ mode: event.target.value as AbilityPrioritySettings['mode'] })
              }
              className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm disabled:opacity-50"
            >
              <option value="custom">{t('abilityPriority.custom')}</option>
              <option value="standard">{t('abilityPriority.standard')}</option>
            </select>
          </div>
          {editor.mode === 'standard' && (
            <p className="text-xs text-muted-foreground">{t('abilityPriority.standardHint')}</p>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor={`${id}-win`} className="text-sm font-medium">
                {t('abilityPriority.winWeight')}
              </label>
              <Input
                id={`${id}-win`}
                type="number"
                step="any"
                value={editor.winWeight}
                onChange={(event) => edit({ winWeight: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor={`${id}-pick`} className="text-sm font-medium">
                {t('abilityPriority.pickWeight')}
              </label>
              <Input
                id={`${id}-pick`}
                type="number"
                step="any"
                value={editor.pickWeight}
                onChange={(event) => edit({ pickWeight: event.target.value })}
              />
            </div>
          </div>
          <div className="space-y-2">
            <label htmlFor={`${id}-formula`} className="text-sm font-medium">
              {t('abilityPriority.formula')}
            </label>
            <textarea
              id={`${id}-formula`}
              value={editor.formula}
              onChange={(event) => edit({ formula: event.target.value })}
              rows={3}
              spellCheck={false}
              aria-invalid={preview.error !== null}
              aria-describedby={`${id}-formula-help`}
              className="border-input bg-background focus-visible:ring-ring/50 w-full resize-y rounded-md border px-3 py-2 font-mono text-sm outline-none focus-visible:ring-2 disabled:opacity-50"
            />
            <p id={`${id}-formula-help`} className="text-xs text-muted-foreground">
              {t('abilityPriority.formulaHint')}
            </p>
          </div>
          <details className="text-xs">
            <summary className="cursor-pointer font-medium">
              {t('abilityPriority.variablesTitle')}
            </summary>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-muted-foreground">
              {PRIORITY_VARIABLES.map((variable) => (
                <div key={variable} className="contents">
                  <dt className="font-mono">{variable}</dt>
                  <dd>{t(`abilityPriority.variables.${variable}`)}</dd>
                </div>
              ))}
            </dl>
          </details>
        </fieldset>

        {preview.error && (
          <p role="alert" className="text-sm text-destructive">
            {preview.error}
          </p>
        )}
        {dataError && (
          <p role="alert" className="text-sm text-destructive">
            {t('abilityPriority.loadFailed', { error: dataError })}
          </p>
        )}
        {editor.mode === 'custom' && (
          <div className="space-y-2 rounded-md border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">{t('abilityPriority.previewTitle')}</p>
              <Button
                size="sm"
                variant="outline"
                disabled={dataLoading || saving}
                onClick={() => {
                  abilitiesQuery.refetch()
                  populationQuery.refetch()
                  heroesQuery.refetch()
                }}
              >
                {t('abilityPriority.refresh')}
              </Button>
            </div>
            {dataLoading ? (
              <p className="text-xs text-muted-foreground">{t('abilityPriority.loading')}</p>
            ) : !dataError && !preview.error ? (
              <>
                <p className="text-xs text-muted-foreground">
                  {t('abilityPriority.previewPopulation', {
                    valid: preview.count,
                    total: preview.total,
                  })}
                </p>
                {preview.count < preview.total && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    {t('abilityPriority.missingData', { missing: preview.total - preview.count })}
                  </p>
                )}
                {preview.strongest.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {t('abilityPriority.previewEmpty')}
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted-foreground">
                      <tr>
                        <th className="py-1 text-left font-medium">
                          {t('abilityPriority.ability')}
                        </th>
                        <th className="py-1 text-right font-medium">
                          {t('abilityPriority.priority')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.strongest.map(({ ability, priority }) => (
                        <tr key={ability.name}>
                          <td className="py-1">
                            {localizeAbilityName(ability.name, ability.displayName, i18n.language)}
                          </td>
                          <td className="py-1 text-right tabular-nums">{priority.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            ) : null}
          </div>
        )}

        <p className="text-xs text-muted-foreground">{t('abilityPriority.applyHint')}</p>
        {saveError && (
          <p role="alert" className="text-sm text-destructive">
            {t('abilityPriority.saveFailed', { error: saveError })}
          </p>
        )}
        {saved && (
          <p role="status" className="text-sm text-muted-foreground">
            {t('abilityPriority.saved')}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={handleSave} disabled={saveDisabled}>
            {t(saving ? 'abilityPriority.saving' : 'abilityPriority.save')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={isDefault || loading || saving}
            onClick={() => edit(toDraft(DEFAULT_ABILITY_PRIORITY))}
          >
            <RotateCcw className="mr-1 h-4 w-4" aria-hidden="true" />
            {t('abilityPriority.reset')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
