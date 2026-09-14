import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { TimersWindow } from './components/TimersWindow'
import './styles.css'

// Separate floating timer window loads the same bundle with #timers.
const isTimerWindow = window.location.hash === '#timers'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isTimerWindow ? <TimersWindow /> : <App />}
  </React.StrictMode>
)