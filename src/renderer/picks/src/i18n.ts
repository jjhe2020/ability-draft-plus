import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import en from './locales/en.json'
import ru from './locales/ru.json'
import zhCN from './locales/zh-CN.json'
import es from './locales/es.json'
import ptBR from './locales/pt-BR.json'
import uk from './locales/uk.json'
import fil from './locales/fil.json'
import fi from './locales/fi.json'

// Language is driven by the server: PicksViewState.meta.language mirrors the app's
// language setting, and App.tsx calls i18n.changeLanguage() when it changes.
i18n.use(initReactI18next).init({
  resources: {
    en: { picks: en },
    ru: { picks: ru },
    'zh-CN': { picks: zhCN },
    es: { picks: es },
    'pt-BR': { picks: ptBR },
    uk: { picks: uk },
    fil: { picks: fil },
    fi: { picks: fi },
  },
  defaultNS: 'picks',
  lng: 'zh-CN',
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
})

export default i18n
