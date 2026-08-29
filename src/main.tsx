import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { I18nProvider } from './utils/i18n'
import '@fontsource-variable/plus-jakarta-sans'
import './styles/tokens.css'
import './index.css'
import './styles/base.css'
import './styles/chrome.css'
import './styles/table.css'
import './styles/charts.css'
import './styles/drawer.css'
import './styles/traces.css'
import './styles/dashboard.css'
import './styles/cards.css'
import './styles/shell.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <I18nProvider>
        <App />
      </I18nProvider>
    </BrowserRouter>
  </React.StrictMode>
)
