import { useTranslation } from 'react-i18next'
import { DataTable } from '@/components/data-table/data-table'
import { useHeroColumns } from '@/components/statistics/hero-columns'
import { useIpcQuery } from '@/hooks/use-ipc-query'
import { useMemo } from 'react'
import { localizeHeroName } from '@shared/localization/dota-names'

export function HeroesPage() {
  const { t, i18n } = useTranslation('data')
  const { data, loading } = useIpcQuery('hero:getAll')
  const heroColumns = useHeroColumns()
  const localizedHeroes = useMemo(
    () =>
      (data ?? []).map((hero) => ({
        ...hero,
        displayName: localizeHeroName(hero.name, hero.displayName, i18n.language),
      })),
    [data, i18n.language],
  )

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 bg-muted animate-pulse rounded" />
        <div className="h-96 bg-muted animate-pulse rounded" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <DataTable
        columns={heroColumns}
        data={localizedHeroes}
        searchKey="displayName"
        searchPlaceholder={t('heroes.filterPlaceholder')}
      />
    </div>
  )
}
