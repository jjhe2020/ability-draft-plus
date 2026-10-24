import { useTranslation } from 'react-i18next'
import './formula-priority-badge.css'

interface FormulaPriorityBadgeProps {
  priority: number | null | undefined
  frameWidth: number
  priorityColor?: string
  reserveBottomCorners?: boolean
}

/** Uses the same GGXGG result as the detail tooltip, visible without hovering. */
export function FormulaPriorityBadge({
  priority,
  frameWidth,
  priorityColor,
  reserveBottomCorners = false,
}: FormulaPriorityBadgeProps): React.ReactElement | null {
  const { t } = useTranslation('overlay')
  if (priority === undefined) return null

  const hasValue = typeof priority === 'number' && Number.isFinite(priority)
  const value = hasValue ? priority.toFixed(2) : '—'
  const label = hasValue
    ? t('tooltip.formulaPriority', { value })
    : t('tooltip.formulaPriorityMissing')
  // Reserve the frame border and badge padding. Extreme custom-formula values
  // remain intact in the DOM/accessible label even when the visual label elides.
  const fontSize = Math.max(8, Math.min(11, Math.floor((frameWidth - 12) / (value.length * 0.65))))
  const compact = frameWidth < 36

  return (
    <span
      className={`formula-priority-badge${reserveBottomCorners ? ' formula-priority-badge-raised' : ''}${hasValue ? '' : ' formula-priority-badge-missing'}`}
      aria-label={label}
      style={{
        fontSize,
        ...(hasValue && priorityColor ? { color: priorityColor } : {}),
        ...(compact ? { paddingInline: 1, maxWidth: '100%' } : {}),
      }}
    >
      {value}
    </span>
  )
}
