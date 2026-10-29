import { CHANGELOG, APP_VERSION, type Release } from '@sh/shared'
import { Top } from './jobs/common.tsx'
import { ADMIN, MENU } from './Up.tsx'
import { useView } from './view.ts'

/**
 * Admin › What's changed (#admin/changes, ADR 0071): every version of the
 * app, newest first, in plain words, each with the pull requests and
 * decisions behind it for anyone who wants the detail. Read only; the list
 * itself is shared/src/changelog.ts.
 */

const REPO = 'https://github.com/sessionhire/sess-sys'

export const pad = (n: number) => String(n).padStart(4, '0')

export const day = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-IE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

export function ReleaseEntry({ release, heading: H = 'h2' }: { release: Release; heading?: 'h2' | 'h3' }) {
  return (
    <article className="release">
      <H>
        <span className="release-version">{release.version}</span> {release.title}
      </H>
      <p className="hint">{day(release.date)}</p>
      <p>{release.what}</p>
      <p className="hint release-refs">
        {release.prs.map((n) => (
          <a key={`pr${n}`} href={`${REPO}/pull/${n}`} target="_blank" rel="noreferrer">
            PR #{n}
          </a>
        ))}
        {release.adrs?.map((n) => (
          <a key={`adr${n}`} href={`${REPO}/tree/main/docs/adr`} target="_blank" rel="noreferrer">
            Decision {pad(n)}
          </a>
        ))}
      </p>
    </article>
  )
}

export function ChangesScreen() {
  const view = useView()
  return (
    <div className="app account changes">
      <Top view={view} title="What's changed" up={{ steps: [MENU, ADMIN], here: "What's changed" }} heading="What's changed" />
      <p className="hint">You're on version {APP_VERSION}. Newest first. The middle number goes up for something new, the last for a fix.</p>
      <section className="card">
        {CHANGELOG.map((r) => (
          <ReleaseEntry key={r.version} release={r} />
        ))}
      </section>
    </div>
  )
}

/** On Admin: the version, the latest change, and the way to the rest. */
export function ChangesCard() {
  const latest = CHANGELOG[0]!
  return (
    <section className="card">
      <h2>Version {APP_VERSION}</h2>
      <ReleaseEntry release={latest} heading="h3" />
      <a href="#admin/changes">See every change</a>
    </section>
  )
}
