import { emailsOf, keptOf, mergedPerson, mergeRefusal, nameKey, plural, samePeople, SAME_BECAUSE_WORDS, type PersonView, type SamePerson, type View } from '@sh/shared'
import { useMemo, useState } from 'react'
import { Confirm, Refusal, useAct } from '../act.tsx'
import { Heading } from '../Icon.tsx'
import { client } from '../sync.ts'
import { personHref } from './PersonScreen.tsx'

/**
 * Combining people brought in twice (ADR 0055): someone the calendars met
 * under two addresses is two people with half their work each. The office
 * ticks who is the same person and confirms; everything of theirs becomes
 * the one person's, and every address stays with them, so the next
 * bring-in and their Google sign-in find them. It can't be split again in
 * one go, so it's a press and a question, never a single tap.
 */

/** Bookings and offers each person has, to tell two of the same name apart and to pick who is kept. */
export function useOfferCounts(view: View): (id: string) => number {
  return useMemo(() => {
    const counts = new Map<string, number>()
    for (const c of view.crew.calls) for (const o of c.offers) counts.set(o.personId, (counts.get(o.personId) ?? 0) + 1)
    return (id: string) => counts.get(id) ?? 0
  }, [view.crew.calls])
}

/** Groups of people who look like one person, for Tidy up and a person's page. */
export function useSamePeople(view: View): SamePerson<PersonView>[] {
  return useMemo(() => samePeople(view.crew.people), [view.crew.people])
}

/** One line under a person's name: their addresses, staff or freelancer, and how much work they have. */
export function whoLine(p: PersonView, offers: number) {
  return [...emailsOf(p), p.phone, p.kind === 'staff' ? 'staff' : 'freelancer', offers ? plural(offers, 'booking or offer', 'bookings and offers') : 'nothing booked']
    .filter(Boolean)
    .join(' · ')
}

/** The button, the question before it, and the change: `into` is kept, `from` made part of it. */
export function CombineButton({ into, from, onDone }: { into: PersonView | undefined; from: readonly PersonView[]; onDone: (said: string) => void }) {
  const [asking, setAsking] = useState(false)
  const { run, error, refuse } = useAct()
  const one = into && from.length ? mergedPerson(into, from) : undefined
  const names = from.map((p) => p.name)
  // Two of the same name are told apart as this one and the other, not "Aoife Byrne part of Aoife Byrne".
  const same = !!into && from.every((p) => nameKey(p.name) === nameKey(into.name))
  const listed = same ? (from.length === 1 ? 'the other one' : 'the others') : names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
  const Listed = listed.charAt(0).toUpperCase() + listed.slice(1)
  const ask = () => {
    if (!into || !from.length) return refuse('Tick who is the same person first.')
    // The same test as the server's, so a question that can't end well isn't asked.
    const why = mergeRefusal(into, from)
    if (why) return refuse(why)
    refuse('')
    setAsking(true)
  }
  const combine = () => {
    setAsking(false)
    if (!into || !one) return
    void run(() => client.mutate('person.merge', { id: into.id, from: from.map((p) => p.id) })).then((ok) => ok && onDone(same ? `${one.name} is one person now.` : `${listed} ${from.length === 1 ? 'is' : 'are'} now part of ${one.name}.`))
  }
  return (
    <>
      <Refusal error={error} />
      {asking && into && one ? (
        <Confirm question={same ? `Combine ${plural(from.length + 1, 'person', 'people')} called ${into.name} into one?` : `Make ${listed} part of ${into.name}, as one person?`} yes="Combine them" no="Not now" onYes={combine} onNo={() => setAsking(false)}>
          <p>
            Their bookings, offers, timesheets, days off, leave, documents and history become {one.name}'s, and {one.name} is found by{' '}
            {emailsOf(one).length ? emailsOf(one).join(', ') : 'no email yet'} when bringing in a calendar or signing in. {same ? 'These' : `${into.name}'s`} details are kept, filled
            in from the others where they have none. {Listed} {from.length === 1 ? 'is' : 'are'} removed, and their private links open {one.name}'s page. It
            can't be split again in one go.
          </p>
        </Confirm>
      ) : (
        <div className="actions">
          <button type="button" className="primary" onClick={ask} disabled={!into || !from.length}>
            {from.length ? `Combine ${plural(from.length + 1, 'person', 'people')}` : 'Combine'}
          </button>
        </div>
      )}
    </>
  )
}

/** On Jobs › Tidy up: people who look like one person, a group at a time. */
export function SamePeople({ view, groups }: { view: View; groups: readonly SamePerson<PersonView>[] }) {
  // What was combined stays said where it was: the group itself goes once they're one person.
  const [done, setDone] = useState<readonly { key: string; said: string; id: string }[]>([])
  const said = done.filter((d) => !groups.some((g) => g.key === d.key))
  if (!groups.length && !said.length) return null
  return (
    <section className="card" aria-label="The same person, brought in twice">
      <Heading icon="person">The same person, brought in twice</Heading>
      <p className="hint">
        Someone invited under two addresses, their own and the company's say, came in as two people with half their work each. Tick the ones who are one person
        and combine them: everything of theirs goes onto one, and every address stays with them, so the next bring-in finds them.
      </p>
      <ul className="found">
        {said.map((d) => (
          <li key={d.key}>
            <p className="added" role="status">
              {d.said} <a href={personHref(d.id)}>Open their page</a>
            </p>
          </li>
        ))}
        {groups.map((g) => (
          <SameGroup key={g.key} view={view} group={g} onDone={(d) => setDone((was) => [...was, { key: g.key, ...d }])} />
        ))}
      </ul>
    </section>
  )
}

function SameGroup({ view, group, onDone }: { view: View; group: SamePerson<PersonView>; onDone: (d: { said: string; id: string }) => void }) {
  const offers = useOfferCounts(view)
  // Sure groups start ticked, by the Default Effect; a first name alone doesn't, as a wrong tick joins two people's work.
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set(group.sure ? group.people.map((p) => p.id) : []))
  const chosen = group.people.filter((p) => ticked.has(p.id))
  const [keep, setKeep] = useState(() => keptOf(group.people, (p) => offers(p.id)).id)
  const into = chosen.find((p) => p.id === keep) ?? (chosen.length ? keptOf(chosen, (p) => offers(p.id)) : undefined)
  return (
    <li className="is-on">
      <p>{SAME_BECAUSE_WORDS[group.because]}</p>
      <ul className="found people">
        {group.people.map((p) => (
          <li key={p.id} className={ticked.has(p.id) ? 'is-on' : 'is-off'}>
            <label className="tick">
              <input
                type="checkbox"
                checked={ticked.has(p.id)}
                onChange={() => {
                  const next = new Set(ticked)
                  if (!next.delete(p.id)) next.add(p.id)
                  setTicked(next)
                }}
              />
              <span>
                <b>{p.name}</b>
                <small>{whoLine(p, offers(p.id))}</small>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {chosen.length >= 2 && into && (
        <label className="kind">
          Keep the details of
          <select value={into.id} onChange={(e) => setKeep(e.target.value)}>
            {chosen.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {chosen.some((q) => q.id !== p.id && nameKey(q.name) === nameKey(p.name)) ? ` (${emailsOf(p)[0] ?? p.kind})` : ''}
              </option>
            ))}
          </select>
        </label>
      )}
      <CombineButton into={chosen.length >= 2 ? into : undefined} from={chosen.filter((p) => p.id !== into?.id)} onDone={(said) => into && onDone({ said, id: into.id })} />
    </li>
  )
}

/** On a person's page: the people who look like them, and anyone else found by name or address, to combine with them. */
export function CombineWith({ view, person }: { view: View; person: PersonView }) {
  const offers = useOfferCounts(view)
  const groups = useSamePeople(view)
  const suggested = groups.find((g) => g.people.some((p) => p.id === person.id))
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set(suggested?.sure ? suggested.people.filter((p) => p.id !== person.id).map((p) => p.id) : []))
  const [find, setFind] = useState('')
  const [done, setDone] = useState('')
  const wanted = nameKey(find)
  const others = view.crew.people.filter((p) => p.id !== person.id)
  const found = wanted.length >= 2 ? others.filter((p) => nameKey([p.name, ...emailsOf(p)].join(' ')).includes(wanted)).slice(0, 8) : []
  const shown = [...new Map([...(suggested?.people ?? []).filter((p) => p.id !== person.id), ...found, ...others.filter((p) => ticked.has(p.id))].map((p) => [p.id, p])).values()]
  const from = others.filter((p) => ticked.has(p.id))
  if (done)
    return (
      <p className="added" role="status">
        {done}
      </p>
    )
  return (
    <div className="combine">
      <p className="hint">
        Someone brought in twice, under another address, is another person here with the rest of their work. Tick who is {person.name} too: their work and
        addresses come onto this page, and {person.name}'s details are kept.
      </p>
      {suggested && <p>Looks like {person.name}: {SAME_BECAUSE_WORDS[suggested.because].toLowerCase()}.</p>}
      <label className="field">
        Find them by name or email
        <input type="search" value={find} onChange={(e) => setFind(e.target.value)} maxLength={200} />
      </label>
      {wanted.length >= 2 && found.length === 0 && <p className="muted">Nobody else here is called that or has that address.</p>}
      {shown.length > 0 && (
        <ul className="found people">
          {shown.map((p) => (
            <li key={p.id} className={ticked.has(p.id) ? 'is-on' : 'is-off'}>
              <label className="tick">
                <input
                  type="checkbox"
                  checked={ticked.has(p.id)}
                  onChange={() => {
                    const next = new Set(ticked)
                    if (!next.delete(p.id)) next.add(p.id)
                    setTicked(next)
                  }}
                />
                <span>
                  <b>{p.name}</b>
                  <small>
                    {whoLine(p, offers(p.id))}
                    {p.archived ? ' · archived' : ''}
                  </small>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <CombineButton into={person} from={from} onDone={setDone} />
    </div>
  )
}
