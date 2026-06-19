import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles/app.css'
import { registerUpdatePrompt } from './pwa/registerUpdate.js'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

// Register the service worker and surface the "new version available" banner.
registerUpdatePrompt()
