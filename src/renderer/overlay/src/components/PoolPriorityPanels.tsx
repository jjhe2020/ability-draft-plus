import { useTranslation } from 'react-i18next'
import type { OverlayDataPayload } from '@shared/types'
import { useMousePassthrough } from '../hooks/use-mouse-passthrough'
import {
  modelPriorityRows,
  poolPriorityColor,
  summarizePoolPriorities,
  ultimatePriorityRows,
  type PoolPriorityRow,
} from '../pool-priority'
import './pool-priority-panels.css'

const format = (value: number | null): string =>
  value === null || !Number.isFinite(value) ? '—' : value.toFixed(2)

function PriorityTable({
  title,
  nameLabel,
  rows,
}: {
  title: string
  nameLabel: string
  rows: PoolPriorityRow[]
}): React.ReactElement {
  const { t } = useTranslation('overlay')
  const summary = summarizePoolPriorities(rows)
  return (
    <details className="pool-priority-panel" open>
      <summary className="pool-priority-heading">
        <span>{title}</span>
        <span className="pool-priority-count">{rows.length}</span>
      </summary>
      <div className="pool-priority-content">
        <p className="pool-priority-legend">{t('poolPriority.legend')}</p>
        <div className="pool-priority-scroll">
          <table className="pool-priority-table" aria-label={title}>
            <thead>
              <tr>
                <th scope="col">{nameLabel}</th>
                <th scope="col">{t('poolPriority.priority')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} data-priority={row.priority ?? undefined}>
                  <th scope="row">
                    <span>{row.name}</span>
                    {row.picked && (
                      <span className="pool-priority-picked">{t('poolPriority.picked')}</span>
                    )}
                  </th>
                  <td
                    className={`pool-priority-value${row.priority === null ? ' pool-priority-missing' : ''}`}
                    style={{ backgroundColor: poolPriorityColor(row.priority, summary) }}
                  >
                    {format(row.priority)}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={2} className="pool-priority-empty">
                    {t('poolPriority.empty')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <dl className="pool-priority-stats" aria-label={t('poolPriority.stats')}>
          <div>
            <dt>{t('poolPriority.mean')}</dt>
            <dd>{format(summary.mean)}</dd>
          </div>
          <div>
            <dt>{t('poolPriority.variance')}</dt>
            <dd>{format(summary.variance)}</dd>
          </div>
          <div>
            <dt>{t('poolPriority.std')}</dt>
            <dd>{format(summary.std)}</dd>
          </div>
        </dl>
        <p className="pool-priority-note">
          {t('poolPriority.populationNote', { count: summary.count })}
        </p>
        {summary.missing > 0 && (
          <p className="pool-priority-warning" role="status">
            {t('poolPriority.missing', { count: summary.missing })}
          </p>
        )}
      </div>
    </details>
  )
}

export function PoolPriorityPanels({
  overlayData,
  controlsAnchor,
  opacity,
}: {
  overlayData: OverlayDataPayload
  controlsAnchor: 'left' | 'right'
  opacity: number
}): React.ReactElement | null {
  const { t } = useTranslation('overlay')
  const passthrough = useMousePassthrough()
  if (!overlayData.scanData) return null
  return (
    <aside
      className={`pool-priority-panels overlay-interactive pool-priority-panels-${controlsAnchor === 'left' ? 'right' : 'left'}`}
      style={{ opacity }}
      aria-label={t('poolPriority.title')}
      {...passthrough}
    >
      <PriorityTable
        title={t('poolPriority.ultimates')}
        nameLabel={t('poolPriority.abilityName')}
        rows={ultimatePriorityRows(
          overlayData.scanData,
          t('poolPriority.unknown'),
          overlayData.modelsCoords.length,
        )}
      />
      <PriorityTable
        title={t('poolPriority.models')}
        nameLabel={t('poolPriority.modelName')}
        rows={modelPriorityRows(overlayData.heroModels)}
      />
    </aside>
  )
}
