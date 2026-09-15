import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { TimersWindow } from './components/TimersWindow'
import { SpotWindow } from './components/SpotWindow'
import './styles.css'

// Separate floating windows load the same bundle with a hash:
// #timers (timer float), #spot (F9 match popup).
const hash = window.location.hash
const isTimerWindow = hash === '#timers'
const isSpotWindow = hash === '#spot'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isTimerWindow ? <TimersWindow /> : isSpotWindow ? <SpotWindow /> : <App />}
  </React.StrictMode>
)