import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/fonts.css'
import './styles/themes.css'
import './styles/global.css'
import App from './App'

const container = document.getElementById('root')
if (!container) throw new Error('root element not found')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
