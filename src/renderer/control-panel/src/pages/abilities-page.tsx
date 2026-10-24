import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { DataTable } from '@/components/data-table/data-table'
import { Skeleton } from '@/components/ui/skeleton'
import { useAbilityColumns } from '@/components/abilities/ability-columns'
import { useIpcQuery } from '@/hooks/use-ipc-query'
import { localizeAbilityName, localizeHeroName } from '@shared/localization/dota-names'

export function AbilitiesPage() {
  const { t, i18n } = useTranslation('data')
  const { data: abilities, loading: abilitiesLoading } = useIpcQuery('ability:getAll')
  const { data: heroes, loading: heroesLoading } = useIpcQuery('hero:getAll')

  const heroMap = useMemo(() => {
    if (!heroes) return new Map<number, string>()
    return new Map(
      heroes.map((h) => [h.heroId, localizeHeroName(h.name, h.displayName, i18n.language)]),
    )
  }, [heroes, i18n.language])
  const localizedAbilities = useMemo(
    () =>
      (abilities ?? []).map((ability) => ({
        ...ability,
        displayName: localizeAbilityName(ability.name, ability.displayName, i18n.language),
      })),
    [abilities, i18n.language],
  )

  const columns = useAbilityColumns(heroMap)

  if (abilitiesLoading || heroesLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <DataTable
        columns={columns}
        data={localizedAbilities.filter((a) => a.heroId !== 0)}
        searchKey="displayName"
        searchPlaceholder={t('abilities.filterPlaceholder')}
      />
    </div>
  )
}
