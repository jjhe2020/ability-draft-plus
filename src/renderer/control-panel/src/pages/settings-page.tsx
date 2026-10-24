import { useSettings } from '@/hooks/use-settings'
import { ThresholdCard } from '@/components/settings/threshold-card'
import { AppearanceCard } from '@/components/settings/appearance-card'
import { AutoTrackingCard } from '@/components/settings/auto-tracking-card'
import { PlayerProfileCard } from '@/components/settings/player-profile-card'
import { RoleCard } from '@/components/settings/role-card'
import { BackupCard } from '@/components/settings/backup-card'
import { FeedbackCard } from '@/components/settings/feedback-card'
import { AbilityPriorityCard } from '@/components/settings/ability-priority-card'
import { DEFAULT_OP_THRESHOLD, DEFAULT_TRAP_THRESHOLD } from '@shared/constants/thresholds'

export function SettingsPage() {
  const { settings, loading, error, updateSetting } = useSettings()

  return (
    <div className="space-y-6">
      <AbilityPriorityCard
        currentValue={settings?.abilityPriority ?? null}
        loading={loading}
        loadError={error}
        onSave={updateSetting}
      />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ThresholdCard
          settingsKey="opThreshold"
          currentValue={settings?.opThreshold ?? null}
          defaultValue={DEFAULT_OP_THRESHOLD}
          onSave={updateSetting}
        />
        <ThresholdCard
          settingsKey="trapThreshold"
          currentValue={settings?.trapThreshold ?? null}
          defaultValue={DEFAULT_TRAP_THRESHOLD}
          onSave={updateSetting}
        />
      </div>

      <PlayerProfileCard />
      <RoleCard />
      <AutoTrackingCard />
      <AppearanceCard />
      <BackupCard />
      <FeedbackCard />
    </div>
  )
}
