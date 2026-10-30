import { useAuth } from './auth.ts'
import { BackupsCard } from './BackupsCard.tsx'
import { CalendarCard } from './CalendarCard.tsx'
import { ChangesCard } from './ChangesScreen.tsx'
import { CurrentRmsCard } from './CurrentRmsCard.tsx'
import { DataCard } from './DataCard.tsx'
import { ExportCard } from './ExportCard.tsx'
import { ListsCard } from './ListsCard.tsx'
import { Top } from './jobs/common.tsx'
import { MessagesCard } from './MessagesCard.tsx'
import { OfficeCard } from './OfficeCard.tsx'
import { QuotingCard } from './QuotingCard.tsx'
import { TimesheetsUseCard } from './TimesheetsUseCard.tsx'
import { AssistantCard } from './AssistantCard.tsx'
import { MailboxCard } from './MailboxCard.tsx'
import { TravelCard } from './TravelCard.tsx'
import { ReadingCard } from './ReadingCard.tsx'
import { StatusPanel } from './StatusPanel.tsx'
import { useAccess } from './role.ts'
import { TabPanel, Tabs, useTab } from './Tabs.tsx'
import { useView } from './view.ts'
import { MENU } from './Up.tsx'

/** The company's settings, at #admin from the Menu: how sign-in stands, the office, Google Calendar, backups and data, made-up data and starting fresh, Current RMS (ADR 0078), the way to where each list is brought in (ADR 0041), and the app's version with what changed in it (ADR 0071). A person's own things (their role, signing out, their feed, this device) are under You (YouScreen.tsx). */

/** Admin in parts (ADR 0082), one at a time: the company, what it's connected to, its data, and how everything it relies on stands (ADR 0093). */
type AdminPart = 'company' | 'connections' | 'data' | 'status'
const ADMIN_LABELS: Record<AdminPart, string> = { company: 'Company', connections: 'Connections', data: 'Data', status: 'Status' }

export function AccountScreen() {
  const auth = useAuth()
  const view = useView()
  const access = useAccess()
  const [, asked] = /^#admin\/([a-z]+)$/.exec(location.hash) ?? []
  const settings = access.can('settings')
  const company = access.can('company')
  const shown = auth.status === 'signed-in' || auth.status === 'open'
  const parts: AdminPart[] = !shown ? [] : settings ? ['company', 'connections', 'data', 'status'] : company ? ['company', 'data'] : []
  const [part, pick] = useTab({ parts: parts.length ? parts : (['company'] as AdminPart[]), asked, remember: 'sh.adminPart', address: (p) => `#admin/${p}` })

  return (
    <div className="app account">
      <Top view={view} title="Admin" up={{ steps: [MENU], here: 'Admin' }} heading="Admin" />

      {auth.status === 'open' && auth.passcode && (
        <section className="card">
          <h2>Demo copy</h2>
          <p>
            This copy is locked with a shared passcode instead of Google sign-in, so anyone who has the passcode can use it. Keep to made-up jobs and
            people here.
          </p>
        </section>
      )}

      {auth.status === 'open' && !auth.passcode && (
        <section className="card attention">
          <h2>Sign-in is off</h2>
          <p>
            Anyone with this app's address can use it, so keep to made-up jobs and people for now. Sign-in with Google switches on once it is set up
            on the server.
          </p>
        </section>
      )}

      {auth.status === 'unknown' && (
        <section className="card">
          <h2>Not checked yet</h2>
          <p>This device hasn't reached the server yet to find out who it's signed in as.</p>
        </section>
      )}

      {/* Settings are for the office and directors, and the data's own switches for directors (ADR 0034); a role without them doesn't see them. */}
      {parts.length > 0 && (
        <>
          <Tabs label="Parts of Admin" id="admin" parts={parts} labels={ADMIN_LABELS} current={part} onPick={pick} />
          <TabPanel id="admin" current={part}>
            {part === 'company' && (
              <>
                {settings && <OfficeCard office={view.office} />}
                {settings && access.can('money') && <QuotingCard money={view.money} />}
                {settings && access.can('money') && <TravelCard money={view.money} />}
                {settings && <MessagesCard office={view.office} />}
                {settings && <TimesheetsUseCard office={view.office} />}
                {settings && access.can('money') && <AssistantCard office={view.office} />}
                {company && !access.rolesOff && <ReadingCard office={view.office} />}
              </>
            )}
            {part === 'connections' && (
              <>
                <CalendarCard view={view} available={auth.status === 'signed-in'} />
                {access.can('money') && <MailboxCard money={view.money} />}
                {access.can('money') && <CurrentRmsCard />}
              </>
            )}
            {part === 'data' && (
              <>
                {settings && <BackupsCard />}
                {settings && <ExportCard />}
                {settings && <ListsCard calendar={access.can('jobs')} />}
                {company && <DataCard view={view} />}
              </>
            )}
            {part === 'status' && <StatusPanel />}
          </TabPanel>
        </>
      )}

      <ChangesCard />
    </div>
  )
}
