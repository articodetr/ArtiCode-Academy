import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './i18n'
import './index.css'
import App from './app/App'
import { labelUnlabelledSelects } from './common/selectLabels'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Drop-downs that show only a placeholder get it as their accessible name (common/selectLabels.ts).
labelUnlabelledSelects()
