import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/ibm-plex-sans-arabic/400.css'
import '@fontsource/ibm-plex-sans-arabic/500.css'
import '@fontsource/ibm-plex-sans-arabic/600.css'
import '@fontsource/ibm-plex-sans-arabic/700.css'
import './i18n'
import './index.css'
import App from './app/App'
import { labelUnlabelledSelects } from './common/selectLabels'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Drop-downs that show only a placeholder get it as their accessible name (quality pass — common/selectLabels.ts).
labelUnlabelledSelects()
