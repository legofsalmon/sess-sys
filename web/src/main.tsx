import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './app.css'
import './crew/crew.css'
import './jobs/jobs.css'
import { startErrorReporting } from './errors.ts'
import { Shell } from './Shell.tsx'
import { watchForUpdates } from './update.tsx'

void startErrorReporting()
watchForUpdates()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Shell />
  </StrictMode>
)
