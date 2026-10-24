import type enCommon from '../locales/en/common.json'
import type enSettings from '../locales/en/settings.json'
import type enDashboard from '../locales/en/dashboard.json'
import type enData from '../locales/en/data.json'
import type enUpdate from '../locales/en/update.json'
import type enFeedback from '../locales/en/feedback.json'
import type enStreaming from '../locales/en/streaming.json'
import type enOverlay from '../../../overlay/src/locales/en/overlay.json'
import type enStream from '../../../stream/src/locales/en.json'
import type enPicks from '../../../picks/src/locales/en.json'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common'
    resources: {
      common: typeof enCommon
      settings: typeof enSettings
      dashboard: typeof enDashboard
      data: typeof enData
      update: typeof enUpdate
      feedback: typeof enFeedback
      streaming: typeof enStreaming
      overlay: typeof enOverlay
      stream: typeof enStream
      picks: typeof enPicks
    }
  }
}
