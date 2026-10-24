import { eq } from 'drizzle-orm'
import type { SQLJsDatabase } from 'drizzle-orm/sql-js'
import { metadata } from '../schema'
import type { AppSettings } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/constants/defaults'
import { validateAbilityPrioritySettings, type PriorityRow } from '@shared/ability-priority'

// @DEV-GUIDE: Key-value store backed by the Metadata table. Used for:
// - App settings (OP threshold, trap threshold, language) — getSettings/setSettings
// - Last successful scrape date — getLastScrapeDate/setLastScrapeDate
// - Any future app-level configuration
// All values stored as text strings; numeric settings parsed on read with defaults fallback.

export interface MetadataRepository {
  get(key: string): string | null
  set(key: string, value: string): void
  getSettings(): AppSettings
  getPriorityPopulation(): PriorityRow[] | null
  setSettings(settings: Partial<AppSettings>): void
  getLastScrapeDate(): string | null
  setLastScrapeDate(date: string): void
}

export function createMetadataRepository(db: SQLJsDatabase): MetadataRepository {
  function get(key: string): string | null {
    const row = db.select().from(metadata).where(eq(metadata.key, key)).get()
    return row?.value ?? null
  }

  function set(key: string, value: string): void {
    db.insert(metadata)
      .values({ key, value })
      .onConflictDoUpdate({ target: metadata.key, set: { value } })
      .run()
  }

  return {
    get,
    set,

    getPriorityPopulation(): PriorityRow[] | null {
      const stored = get('windrun_priority_population')
      if (!stored) return null
      try {
        const rows: unknown = JSON.parse(stored)
        if (
          !Array.isArray(rows) ||
          !rows.every(
            (row) =>
              row &&
              typeof row === 'object' &&
              typeof row.name === 'string' &&
              (row.winrate === null || typeof row.winrate === 'number') &&
              (row.pickRate === null || typeof row.pickRate === 'number') &&
              (row.draftFrequency === null || typeof row.draftFrequency === 'number'),
          )
        )
          return null
        return rows as PriorityRow[]
      } catch {
        return null
      }
    },

    getSettings(): AppSettings {
      let abilityPriority = DEFAULT_SETTINGS.abilityPriority
      const storedPriority = get('ability_priority')
      if (storedPriority !== null) {
        try {
          abilityPriority = validateAbilityPrioritySettings(JSON.parse(storedPriority))
        } catch {
          /* Invalid legacy metadata falls back to the documented default. */
        }
      }
      const opThreshold = get('op_threshold')
      const trapThreshold = get('trap_threshold')
      const language = get('language')
      const themeMode = get('theme_mode')
      const overlayOpacity = get('overlay_opacity')
      const overlayAnchor = get('overlay_anchor')
      const streamPort = get('stream_port')
      const streamAutostart = get('stream_autostart')
      const autoDraftTracking = get('experimental_auto_draft_tracking')
      const overlayAutoClose = get('overlay_auto_close')
      const autoInitialScanDelayS = get('auto_initial_scan_delay_s')
      const roleMode = get('role_mode')
      const roleFixedPositions = get('role_fixed_positions')
      const aghsMarkersEnabled = get('aghs_markers_enabled')
      const twitchBroadcastEnabled = get('twitch_broadcast_enabled')
      const overlayBackgroundMode = get('overlay_background_mode')

      return {
        abilityPriority,
        opThreshold: opThreshold !== null ? parseFloat(opThreshold) : DEFAULT_SETTINGS.opThreshold,
        trapThreshold:
          trapThreshold !== null ? parseFloat(trapThreshold) : DEFAULT_SETTINGS.trapThreshold,
        language: language ?? DEFAULT_SETTINGS.language,
        themeMode:
          themeMode === 'light' || themeMode === 'dark' || themeMode === 'system'
            ? themeMode
            : DEFAULT_SETTINGS.themeMode,
        overlayOpacity:
          overlayOpacity !== null ? parseFloat(overlayOpacity) : DEFAULT_SETTINGS.overlayOpacity,
        overlayAnchor:
          overlayAnchor === 'left' || overlayAnchor === 'right'
            ? overlayAnchor
            : DEFAULT_SETTINGS.overlayAnchor,
        streamPort: streamPort !== null ? parseInt(streamPort, 10) : DEFAULT_SETTINGS.streamPort,
        streamAutostart:
          streamAutostart !== null ? streamAutostart === 'true' : DEFAULT_SETTINGS.streamAutostart,
        experimentalAutoDraftTracking:
          autoDraftTracking !== null
            ? autoDraftTracking === 'true'
            : DEFAULT_SETTINGS.experimentalAutoDraftTracking,
        overlayAutoCloseEnabled:
          overlayAutoClose !== null
            ? overlayAutoClose === 'true'
            : DEFAULT_SETTINGS.overlayAutoCloseEnabled,
        autoInitialScanDelayS:
          autoInitialScanDelayS !== null
            ? parseInt(autoInitialScanDelayS, 10)
            : DEFAULT_SETTINGS.autoInitialScanDelayS,
        roleMode:
          roleMode === 'off' || roleMode === 'fixed' || roleMode === 'dynamic'
            ? roleMode
            : DEFAULT_SETTINGS.roleMode,
        // Stored as CSV ("4,5"); junk entries are dropped, not defaulted
        roleFixedPositions:
          roleFixedPositions !== null
            ? roleFixedPositions
                .split(',')
                .map((v) => parseInt(v, 10))
                .filter((v) => Number.isInteger(v) && v >= 1 && v <= 5)
            : DEFAULT_SETTINGS.roleFixedPositions,
        aghsMarkersEnabled:
          aghsMarkersEnabled !== null
            ? aghsMarkersEnabled === 'true'
            : DEFAULT_SETTINGS.aghsMarkersEnabled,
        twitchBroadcastEnabled:
          twitchBroadcastEnabled !== null
            ? twitchBroadcastEnabled === 'true'
            : DEFAULT_SETTINGS.twitchBroadcastEnabled,
        overlayBackgroundMode:
          overlayBackgroundMode !== null
            ? overlayBackgroundMode === 'true'
            : DEFAULT_SETTINGS.overlayBackgroundMode,
      }
    },

    setSettings(settings: Partial<AppSettings>): void {
      // Validate before any write so a rejected rule cannot partly update settings.
      const abilityPriority =
        settings.abilityPriority !== undefined
          ? validateAbilityPrioritySettings(settings.abilityPriority)
          : undefined
      if (abilityPriority !== undefined) {
        set('ability_priority', JSON.stringify(abilityPriority))
      }
      if (settings.opThreshold !== undefined) {
        set('op_threshold', String(settings.opThreshold))
      }
      if (settings.trapThreshold !== undefined) {
        set('trap_threshold', String(settings.trapThreshold))
      }
      if (settings.language !== undefined) {
        set('language', settings.language)
      }
      if (settings.themeMode !== undefined) {
        set('theme_mode', settings.themeMode)
      }
      if (settings.overlayOpacity !== undefined) {
        set('overlay_opacity', String(settings.overlayOpacity))
      }
      if (settings.overlayAnchor !== undefined) {
        set('overlay_anchor', settings.overlayAnchor)
      }
      if (settings.streamPort !== undefined) {
        set('stream_port', String(settings.streamPort))
      }
      if (settings.streamAutostart !== undefined) {
        set('stream_autostart', String(settings.streamAutostart))
      }
      if (settings.experimentalAutoDraftTracking !== undefined) {
        set('experimental_auto_draft_tracking', String(settings.experimentalAutoDraftTracking))
      }
      if (settings.overlayAutoCloseEnabled !== undefined) {
        set('overlay_auto_close', String(settings.overlayAutoCloseEnabled))
      }
      if (settings.autoInitialScanDelayS !== undefined) {
        set('auto_initial_scan_delay_s', String(settings.autoInitialScanDelayS))
      }
      if (settings.roleMode !== undefined) {
        set('role_mode', settings.roleMode)
      }
      if (settings.roleFixedPositions !== undefined) {
        set('role_fixed_positions', settings.roleFixedPositions.join(','))
      }
      if (settings.aghsMarkersEnabled !== undefined) {
        set('aghs_markers_enabled', String(settings.aghsMarkersEnabled))
      }
      if (settings.twitchBroadcastEnabled !== undefined) {
        set('twitch_broadcast_enabled', String(settings.twitchBroadcastEnabled))
      }
      if (settings.overlayBackgroundMode !== undefined) {
        set('overlay_background_mode', String(settings.overlayBackgroundMode))
      }
    },

    getLastScrapeDate(): string | null {
      return get('last_successful_scrape_date')
    },

    setLastScrapeDate(date: string): void {
      set('last_successful_scrape_date', date)
    },
  }
}
