import type { Table } from '@tanstack/react-table'
import { Input } from '@/components/ui/input'
import { useTranslation } from 'react-i18next'

interface DataTableToolbarProps<TData> {
  table: Table<TData>
  searchKey: string
  searchPlaceholder?: string
}

export function DataTableToolbar<TData>({
  table,
  searchKey,
  searchPlaceholder,
}: DataTableToolbarProps<TData>) {
  const { t } = useTranslation('data')
  return (
    <div className="flex items-center gap-2">
      <Input
        placeholder={searchPlaceholder ?? t('table.filter')}
        value={(table.getColumn(searchKey)?.getFilterValue() as string) ?? ''}
        onChange={(e) => table.getColumn(searchKey)?.setFilterValue(e.target.value)}
        className="max-w-sm h-8"
      />
    </div>
  )
}
