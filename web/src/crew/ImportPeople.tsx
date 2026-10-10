import {
  bringInLabel,
  companyLine,
  EMAIL_HINT,
  euro,
  importCounts,
  levelLine,
  NAME_HINT,
  parseEuro,
  PHONE_HINT,
  previewRows,
  type CrewListPreview,
  type CrewListPreviewRow,
  type CrewListResult,
  type KnownPerson,
  type View,
} from '@sh/shared'
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Confirm, Refusal, useAct } from '../act.tsx'
import { Top } from '../jobs/common.tsx'
import { post } from '../server.ts'

/**
 * Bringing in the crew list (ADR 0025), at #account/import-people: choose
 * the spreadsheet saved as a .csv file, see every row as the app read it
 * with anything it couldn't read marked, fix those in place or skip them,
 * then bring them all in at once. The server reads the file and matches
 * rows to people already on the Crew tab, so this needs signal; as a row
 * is fixed here, the same shared checks and matching run again against
 * the people this device holds, so the row says who it updates before
 * the server is asked.
 */

/** A row as the office is fixing it: what was typed in each field it can change, and the row as the shared rules read that. */
interface Row extends CrewListPreviewRow {
  skip: boolean
  /** Decided once, from the preview: a row the app couldn't read keeps its fields for the rest of the preview, so they don't vanish mid-word as the problem clears. */
  fix: boolean
  typed: { name: string; email: string; phone: string }
}

type Step =
  | { at: 'choose'; problem?: string }
  | { at: 'reading' }
  | { at: 'preview'; preview: CrewListPreview; rows: Row[] }
  | { at: 'done'; result: CrewListResult }

/** The server takes up to this much; said here first, so a bigger file is told in words rather than by the server's cut-off. */
const MOST_BYTES = 5_000_000

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-IE')} ${n === 1 ? one : many}`

const typedOf = (r: CrewListPreviewRow) => ({ name: r.name, email: r.email ?? '', phone: r.phone ?? '' })

/** The people this device holds, as the rows are matched against them. */
const knownOn = (view: View): KnownPerson[] => view.crew.people.map((p) => ({ id: p.id, name: p.name, email: p.email, phone: p.phone, archived: p.archived }))

/** Which field a problem is said beside; null for one about the row as a whole. */
function fieldOf(problem: string): 'name' | 'email' | 'phone' | null {
  if (problem === 'No name.' || problem === NAME_HINT) return 'name'
  if (problem === EMAIL_HINT || problem.startsWith('The same email')) return 'email'
  if (problem === PHONE_HINT || problem.startsWith('The same phone') || problem.startsWith('This phone is')) return 'phone'
  return null
}

/** The file's text, read on the device. */
const readFile = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error("Couldn't read that file."))
    reader.readAsText(file)
  })

export function ImportPeopleScreen({ view }: { view: View }) {
  const [step, setStep] = useState<Step>({ at: 'choose' })
  const heading = useRef<HTMLHeadingElement>(null)
  const offline = view.connection === 'offline'
  // A new step is announced by moving to its heading.
  useEffect(() => heading.current?.focus(), [step.at])

  const choose = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > MOST_BYTES) {
      setStep({ at: 'choose', problem: 'The file is bigger than 5 MB.' })
      return
    }
    setStep({ at: 'reading' })
    try {
      const text = await readFile(file)
      const preview = await post<CrewListPreview>('/api/people/import/preview', { text })
      setStep({ at: 'preview', preview, rows: preview.rows.map((r) => ({ ...r, skip: false, fix: r.problems.length > 0, typed: typedOf(r) })) })
    } catch (err) {
      setStep({ at: 'choose', problem: (err as Error).message })
    }
  }

  return (
    <div className="app crew jobs import import-people">
      <Top view={view} title="Account" />
      <a className="back" href="#account">
        ‹ Account
      </a>
      <header className="title">
        {/* Where it's up to (rule 13): choosing the file, then checking every row before anything is saved. */}
        {step.at !== 'done' && <p className="kicker">{step.at === 'preview' ? 'Step 2 of 2: check every row' : 'Step 1 of 2: choose the file'}</p>}
        <h1 ref={heading} tabIndex={-1}>
          {step.at === 'done' ? 'Brought in' : 'Bring in a list'}
        </h1>
      </header>
      {step.at === 'choose' || step.at === 'reading' ? (
        <Choose reading={step.at === 'reading'} offline={offline} problem={step.at === 'choose' ? step.problem : undefined} onChoose={choose} />
      ) : step.at === 'done' ? (
        <Done result={step.result} onAgain={() => setStep({ at: 'choose' })} />
      ) : (
        <Preview
          preview={step.preview}
          rows={step.rows}
          view={view}
          offline={offline}
          onRows={(rows) => setStep({ ...step, rows })}
          onBack={() => setStep({ at: 'choose' })}
          onDone={(result) => setStep({ at: 'done', result })}
        />
      )}
    </div>
  )
}

function Choose(p: { reading: boolean; offline: boolean; problem: string | undefined; onChoose: (e: ChangeEvent<HTMLInputElement>) => void }) {
  return (
    <section className="card" aria-label="Choose a file">
      <p>
        Save the crew list as a .csv file and choose it here. The first row names the columns (First Name, Last Name, Department, Phone, Email, and
        so on), in any order. Nothing is saved until you've seen every row.
      </p>
      <label className="field">
        Crew list file
        <input type="file" accept=".csv,text/csv" onChange={p.onChoose} disabled={p.reading || p.offline} />
      </label>
      {p.reading && <p className="hint">Reading the file…</p>}
      {p.problem && (
        <p className="alert" role="alert">
          {p.problem}
        </p>
      )}
      {p.offline && <p className="hint">This needs signal: the server reads the file and matches rows to the people already on the Crew tab.</p>}
    </section>
  )
}

function Preview(p: {
  preview: CrewListPreview
  rows: Row[]
  view: View
  offline: boolean
  onRows: (rows: Row[]) => void
  onBack: () => void
  onDone: (result: CrewListResult) => void
}) {
  const { rows } = p
  const { run, error } = useAct()
  const [bringing, setBringing] = useState(false)
  const [asking, setAsking] = useState(false)
  // Rows fixed or skipped here are the office's work: choosing another file drops them, so that's asked first (rule 11).
  const [leaving, setLeaving] = useState(false)
  const read = new Map(p.preview.rows.map((r) => [r.row, typedOf(r)]))
  const worked = rows.filter((r) => r.skip || JSON.stringify(r.typed) !== JSON.stringify(read.get(r.row))).length
  const counts = importCounts(rows)
  const live = counts.rows - counts.skipped

  /** Every row checked and matched again by the shared rules, so a problem clears as it's fixed and the row says who it updates now. */
  const recheck = (next: Row[]) =>
    p.onRows(previewRows(next.map((r) => ({ ...r, name: r.typed.name, email: r.typed.email || null, phone: r.typed.phone || null })), p.preview.officeDomain, knownOn(p.view)))
  const typed = (row: number, field: keyof Row['typed'], value: string) => recheck(rows.map((r) => (r.row === row ? { ...r, typed: { ...r.typed, [field]: value } } : r)))
  const skip = (row: number, on: boolean) => recheck(rows.map((r) => (r.row === row ? { ...r, skip: on } : r)))

  const bring = async () => {
    setBringing(true)
    let result: CrewListResult | undefined
    const ok = await run(async () => {
      result = await post<CrewListResult>('/api/people/import', { rows: rows.map(({ typed: _typed, fix: _fix, ...r }) => r) })
    })
    setBringing(false)
    if (ok && result) p.onDone(result)
  }

  const said = [
    plural(counts.new, 'new person', 'new people'),
    counts.updates > 0 && plural(counts.updates, 'update', 'updates'),
    counts.skipped > 0 && plural(counts.skipped, 'skipped', 'skipped'),
    counts.problems > 0 && `${counts.problems} with ${counts.problems === 1 ? 'a problem' : 'problems'}`,
  ].filter(Boolean)
  const question = [
    counts.new > 0 && `${plural(counts.new, 'new person', 'new people')} added`,
    counts.updates > 0 && `${plural(counts.updates, 'person', 'people')} already here updated with the file's name and details`,
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <>
      <section className="card" aria-label="What was read">
        <p role="status">
          <b>{plural(counts.rows, 'row', 'rows')}</b> read: {said.join(', ')}.
        </p>
        {p.preview.officeDomain === null ? (
          <p className="warn-line">No office email is set on the Account tab, so everyone comes in as a freelancer. Set it first to have company emails come in as staff.</p>
        ) : (
          <p className="hint">Emails at {p.preview.officeDomain} come in as staff; the rest as freelancers. Levels come from Preferred and Onboarded; the office's own level is kept for anyone already here.</p>
        )}
        {leaving ? (
          <Confirm
            question={`Drop ${plural(worked, 'row', 'rows')} fixed or skipped here and choose another file?`}
            yes="Choose another file"
            no="Keep working on this one"
            onYes={p.onBack}
            onNo={() => setLeaving(false)}
          />
        ) : (
          <button type="button" className="link" onClick={() => (worked > 0 ? setLeaving(true) : p.onBack())} disabled={bringing}>
            Choose another file
          </button>
        )}
      </section>

      <section className="card" aria-label="Rows">
        <ul className="found people-rows">
          {rows.map((r) => (
            <RowCard key={r.row} row={r} onTyped={(field, value) => typed(r.row, field, value)} onSkip={(on) => skip(r.row, on)} />
          ))}
        </ul>
      </section>

      <div className="bring">
        <Refusal error={error} />
        {counts.problems > 0 && <p className="hint">{counts.problems === 1 ? '1 row still has a problem: fix it or skip it.' : `${counts.problems} rows still have problems: fix them or skip them.`}</p>}
        {p.offline && <p className="hint">This needs signal.</p>}
        {asking ? (
          <Confirm
            question={`${question}. Each can be edited afterwards, but this can't be undone in one go.`}
            yes="Bring them in"
            no="Not yet"
            onYes={() => {
              setAsking(false)
              void bring()
            }}
            onNo={() => setAsking(false)}
          />
        ) : (
          <button type="button" className="primary" disabled={bringing || p.offline || live === 0 || counts.problems > 0} onClick={() => setAsking(true)}>
            {bringing ? 'Bringing in…' : bringInLabel(counts)}
          </button>
        )}
      </div>
    </>
  )
}

/** One row as the app read it, with its fields to fix where it couldn't, and Skip. */
function RowCard({ row: r, onTyped, onSkip }: { row: Row; onTyped: (field: keyof Row['typed'], value: string) => void; onSkip: (on: boolean) => void }) {
  const by = (field: 'name' | 'email' | 'phone' | null) => r.problems.filter((x) => fieldOf(x) === field)
  const rate = parseEuro(r.dayRate)
  const facts = [
    r.kind === 'staff' ? 'Staff' : 'Freelancer',
    r.department ?? 'no department',
    levelLine(r.level),
    r.skills.length ? plural(r.skills.length, 'skill', 'skills') : null,
    rate.reason === undefined && rate.cents !== null ? `${euro(rate.cents)}/day` : null,
    r.company ? companyLine(r) : null,
    r.knownAs ? `goes by ${r.knownAs}` : null,
  ].filter(Boolean)
  return (
    <li className={r.skip ? 'is-off' : 'is-on'} aria-label={`Row ${r.row}`}>
      <div className="head">
        <b>{r.name || `Row ${r.row}`}</b>
        <label className="skip">
          <input type="checkbox" checked={r.skip} onChange={(e) => onSkip(e.target.checked)} aria-label={`Skip row ${r.row}`} />
          Skip
        </label>
      </div>
      <p>{facts.join(' · ')}</p>
      {!r.fix && <p>{[r.email, r.phone].filter(Boolean).join(' · ') || 'No email or phone'}</p>}
      {r.matched && (
        <p className="updates">
          Updates <b>{r.matched.name}</b> (matched by {r.matched.by})
        </p>
      )}
      {by(null).map((x) => (
        <p key={x} className="warn-line">
          {x}
        </p>
      ))}
      {r.fix && (
        <div className="fix">
          <Fix label="Name" field="name" row={r} problems={by('name')} onTyped={onTyped} />
          <Fix label="Email" field="email" row={r} problems={by('email')} onTyped={onTyped} />
          <Fix label="Phone" field="phone" row={r} problems={by('phone')} onTyped={onTyped} />
        </div>
      )}
    </li>
  )
}

function Fix({ label, field, row: r, problems, onTyped }: { label: string; field: keyof Row['typed']; row: Row; problems: string[]; onTyped: (field: keyof Row['typed'], value: string) => void }) {
  return (
    <label>
      {label}
      <input
        type={field === 'email' ? 'email' : field === 'phone' ? 'tel' : 'text'}
        value={r.typed[field]}
        onChange={(e) => onTyped(field, e.target.value)}
        aria-label={`${label} for row ${r.row}`}
        disabled={r.skip}
      />
      {problems.map((x) => (
        <small key={x} className="warn-line">
          {x}
        </small>
      ))}
    </label>
  )
}

function Done({ result, onAgain }: { result: CrewListResult; onAgain: () => void }) {
  return (
    <section className="card" aria-label="Brought in">
      <p role="status">
        Added {result.added}, updated {result.updated}, skipped {result.skipped}.
        {result.unchanged > 0 && ` ${result.unchanged} ${result.unchanged === 1 ? 'was' : 'were'} already up to date.`}
      </p>
      <div className="actions">
        <a className="button primary" href="#crew">
          Crew tab
        </a>
        <button type="button" onClick={onAgain}>
          Bring in another list
        </button>
      </div>
    </section>
  )
}
