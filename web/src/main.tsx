import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './app.css'
import './crew/crew.css'
import './jobs/jobs.css'
import { startErrorReporting } from './errors.ts'
import { watchForUpdates } from './update.tsx'

void startErrorReporting()
watchForUpdates()

const root = createRoot(document.getElementById('root')!)

/** The app couldn't load its copy of the data, so a plain page says so rather than nothing at all. */
function CouldNotStart({ why }: { why: string }) {
  return (
    <div className="app">
      <section className="card attention">
        <h2>The app couldn't start</h2>
        <p>{why}</p>
        <div className="actions">
          <button type="button" className="primary" onClick={() => location.reload()}>
            Try again
          </button>
        </div>
      </section>
    </div>
  )
}

// The app waits on its copy of the data before it draws anything (sync.ts),
// which on a slow IndexedDB can be a while: a word meanwhile, rather than a
// white page. And that's why the shell is loaded here rather than imported:
// should it fail, for whatever reason storage.ts hasn't caught, the page
// still says something.
root.render(
  <div className="app">
    <p className="hint">Loading…</p>
  </div>
)
import('./Shell.tsx').then(
  ({ Shell }) =>
    root.render(
      <StrictMode>
        <Shell />
      </StrictMode>
    ),
  (err: unknown) => root.render(<CouldNotStart why={err instanceof Error ? err.message : String(err)} />)
)
