import { directionsLink, pinFromText, plural, type FoundPlace, type Pin, type PlacesFound, type VenueView } from '@sh/shared'
import { useEffect, useRef, useState, type ComponentProps, type FormEvent } from 'react'
import { Refusal, useAct } from '../act.tsx'
import { Heading } from '../Icon.tsx'
import { lazyPart } from '../lazyPart.tsx'
import { useAccess } from '../role.ts'
import { ask } from '../server.ts'
import { client } from '../sync.ts'
import { useLate } from '../useLate.ts'
import type { default as MapPart, Mark } from './Map.tsx'

/**
 * Venues on the map (ADR 0057): a venue's own map on its page, and every
 * venue on one map on the Venues list. A venue's pin is kept on the venue,
 * so the map needs no search once it's placed and works on a phone with
 * no signal (but for the map's pictures). Placing one is looking it up by
 * its name and address and picking what was found, pasting a map link or
 * coordinates, or tapping the map where it is.
 */

/** Leaflet and the map's own styles load only on the pages with a map, and are kept from the first (lazyPart.tsx). */
const MapView = lazyPart(() => import('./Map.tsx'))

function LazyMap(props: ComponentProps<typeof MapPart>) {
  const box = (words?: string) => (
    <div className={`map waiting${props.tall ? ' tall' : ''}`} aria-label={props.label} role="region">
      {words && <p className="hint map-missing">{words}</p>}
    </div>
  )
  return <MapView {...props} waiting={box()} missing={box("The map comes with signal: it hasn't been opened on this phone before.")} />
}

const markOf = (v: VenueView & { pin: Pin }, line?: string): Mark => ({ id: v.id, name: v.name, pin: v.pin, href: `#jobs/venues/${encodeURIComponent(v.id)}`, line })

/** Look a venue up on the map, by its name and address; the server asks OpenStreetMap. */
const lookUp = (v: Pick<VenueView, 'name' | 'address'>) => ask<PlacesFound>(`/api/places?${new URLSearchParams({ name: v.name, address: v.address })}`)

/** "53.13361, -7.15122": where a pin is, for anyone who needs the numbers. */
const pinText = (p: Pin) => `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`

/** A venue's map, on its page. */
export function VenueMapCard({ venue }: { venue: VenueView }) {
  const mayChange = useAccess().can('jobs')
  const [placing, setPlacing] = useState(false)
  const pin = venue.pin ?? null
  if (placing) return <PlacePin venue={venue} onDone={() => setPlacing(false)} />
  return (
    <section className="card" aria-labelledby="venue-map">
      <Heading icon="venue" id="venue-map">
        On the map
      </Heading>
      {pin ? (
        <>
          <LazyMap marks={[markOf({ ...venue, pin })]} label={`Map of ${venue.name}`} />
          <div className="actions">
            <a className="button" href={directionsLink(pin)} target="_blank" rel="noreferrer">
              Directions
            </a>
            {mayChange && (
              <button type="button" onClick={() => setPlacing(true)}>
                Move the pin
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          <p className="empty">Not on the map yet.{mayChange ? ' Look it up by its name and address, or put the pin in by hand.' : ''}</p>
          {mayChange && (
            <div className="actions">
              <button type="button" className="primary" onClick={() => setPlacing(true)}>
                Put it on the map
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}

/**
 * Putting a venue's pin down, or moving it. A venue with no pin is looked
 * up straight away, and the first place found is the new pin to check; one
 * already on the map starts where it is. Tapping the map or dragging the
 * pin moves it, and nothing is saved until Save the pin.
 */
function PlacePin({ venue, onDone }: { venue: VenueView; onDone: () => void }) {
  const [draft, setDraft] = useState<Pin | null>(venue.pin ?? null)
  const [found, setFound] = useState<PlacesFound>()
  const [looking, setLooking] = useState(false)
  const [problem, setProblem] = useState('')
  const [pasted, setPasted] = useState('')
  const late = useLate(looking)
  const { run, error, refuse } = useAct()

  const look = async () => {
    setLooking(true)
    setProblem('')
    try {
      const answer = await lookUp(venue)
      setFound(answer)
      if (answer.found[0] && !venue.pin) setDraft(answer.found[0])
    } catch (err) {
      setProblem((err as Error).message)
    } finally {
      setLooking(false)
    }
  }
  // A venue not yet on the map is looked up as soon as this opens: that's what the press was for.
  const lookedOnce = useRef(false)
  useEffect(() => {
    if (venue.pin || lookedOnce.current) return
    lookedOnce.current = true
    void look()
  }, [])

  const usePasted = (e: FormEvent) => {
    e.preventDefault()
    const p = pinFromText(pasted)
    if (!p) return refuse('That isn\'t a map link or coordinates. Paste a Google Maps or OpenStreetMap link to the place, or numbers like "53.1336, -7.1512". A short maps.app.goo.gl link can\'t be read: open it first, then copy the long address it goes to.')
    refuse('')
    setDraft(p)
    setPasted('')
  }
  const save = () => void run(() => client.mutate('venue.pin', { id: venue.id, pin: draft })).then((ok) => ok && onDone())
  const takeOff = () => void run(() => client.mutate('venue.pin', { id: venue.id, pin: null })).then((ok) => ok && onDone())

  return (
    <section className="card" aria-labelledby="venue-map">
      <Heading icon="venue" id="venue-map">
        {venue.pin ? 'Move the pin' : 'Put it on the map'}
      </Heading>
      <LazyMap marks={[]} placing={draft} onPlace={setDraft} label={`Map for placing ${venue.name}: tap where it is`} />
      <p className="hint">{draft ? `Tap the map or drag the new pin to move it. Now at ${pinText(draft)}.` : 'Tap the map where it is, pick a place found, or paste a link.'}</p>

      {looking && <p className="hint" aria-live="polite">{late ? `Looking for ${venue.name}…` : ' '}</p>}
      {problem && <p className="alert">{problem}</p>}
      {found && found.found.length === 0 && (
        <p className="hint">Nothing found for its name{venue.address ? ' or address' : ''}. Tap the map where it is, or paste a link to it from a maps app.</p>
      )}
      {found && found.found.length > 0 && (
        <fieldset className="choices">
          <legend>Found for “{found.searched}”</legend>
          {found.found.map((f, i) => (
            <label key={i} className="signal">
              <input type="radio" name="found" checked={!!draft && draft.lat === f.lat && draft.lng === f.lng} onChange={() => setDraft(pinOf(f))} />
              <span>{f.label}</span>
            </label>
          ))}
        </fieldset>
      )}
      {venue.pin && !found && (
        <div className="actions">
          <button type="button" onClick={() => void look()} disabled={looking} aria-busy={looking}>
            Look it up again
          </button>
        </div>
      )}

      <form className="paste-pin" onSubmit={usePasted} aria-label="Paste a map link">
        <label className="field">
          Or paste a map link or coordinates
          <input value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="A Google Maps link, or 53.1336, -7.1512" inputMode="url" autoComplete="off" />
        </label>
        <button type="submit" disabled={!pasted.trim()}>
          Use it
        </button>
      </form>

      <Refusal error={error} />
      <div className="actions">
        <button type="button" className="primary" onClick={save} disabled={!draft || (!!venue.pin && draft.lat === venue.pin.lat && draft.lng === venue.pin.lng)}>
          Save the pin
        </button>
        <button type="button" onClick={onDone}>
          Cancel
        </button>
        {venue.pin && (
          <button type="button" onClick={takeOff}>
            Take it off the map
          </button>
        )}
      </div>
    </section>
  )
}

const pinOf = (f: FoundPlace): Pin => ({ lat: f.lat, lng: f.lng })

/** Every venue with a pin on one map, above the list; the rest said in a line, with a way to find them all. */
export function VenuesMapCard({ venues, jobsAt }: { venues: VenueView[]; jobsAt: (id: string) => number }) {
  const mayChange = useAccess().can('jobs')
  const [finding, setFinding] = useState(false)
  const placed = venues.filter((v): v is VenueView & { pin: Pin } => !!v.pin)
  const rest = venues.filter((v) => !v.pin)
  if (venues.length === 0) return null
  return (
    <section className="card" aria-labelledby="venues-map">
      <Heading icon="venue" id="venues-map">
        Map
      </Heading>
      <LazyMap
        tall
        marks={placed.map((v) => {
          const n = jobsAt(v.id)
          return markOf(v, plural(n, 'job'))
        })}
        label={`Map of ${plural(placed.length, 'venue')}`}
      />
      <p className="hint">
        {rest.length === 0 ? `All ${plural(venues.length, 'venue')} are on the map.` : `${placed.length} of ${plural(venues.length, 'venue')} on the map. ${rest.length === 1 ? 'One isn’t' : `${rest.length} aren’t`} yet: they say so in the list.`}
      </p>
      {mayChange && rest.length > 0 && !finding && (
        <div className="actions">
          <button type="button" onClick={() => setFinding(true)}>
            Find the rest
          </button>
        </div>
      )}
      {finding && <FindTheRest venues={rest} onDone={() => setFinding(false)} />}
    </section>
  )
}

type Looked = { venue: VenueView; found?: FoundPlace; keep: boolean }

/**
 * Looking up every venue not yet on the map, one after another (the map
 * search takes one a second), then a list to check: each found place
 * ticked, to untick any that's wrong, and one press puts the ticked ones
 * on the map. Anything not found, or wrong, is placed from its own page.
 */
function FindTheRest({ venues, onDone }: { venues: VenueView[]; onDone: () => void }) {
  const [looked, setLooked] = useState<Looked[]>([])
  const [state, setState] = useState<'looking' | 'stopped' | 'done' | 'failed'>('looking')
  const [problem, setProblem] = useState('')
  const stop = useRef(false)
  const { run, error } = useAct()

  // One after another, from when this opens; leaving the page stops it.
  useEffect(() => {
    let gone = false
    setLooked([])
    void (async () => {
      for (const venue of venues) {
        if (stop.current) return setState('stopped')
        try {
          const { found } = await lookUp(venue)
          if (gone) return
          setLooked((l) => [...l, { venue, found: found[0], keep: !!found[0] }])
        } catch (err) {
          if (gone) return
          setProblem((err as Error).message)
          return setState('failed')
        }
      }
      if (!gone) setState('done')
    })()
    return () => {
      gone = true
    }
    // The venues to look up are those not on the map when Find the rest was pressed.
  }, [])

  const keep = looked.filter((l) => l.keep && l.found)
  const save = () =>
    void run(async () => {
      for (const l of keep) await client.mutate('venue.pin', { id: l.venue.id, pin: pinOf(l.found!) })
    }).then((ok) => ok && onDone())
  const missing = looked.filter((l) => !l.found)

  return (
    <div className="find-rest">
      {state === 'looking' && (
        <p className="hint" aria-live="polite">
          Looking up {looked.length + 1} of {venues.length}: {venues[looked.length]?.name}. About a second each, longer for one with no address.
        </p>
      )}
      {problem && <p className="alert">{problem}</p>}
      {looked.some((l) => l.found) && (
        <fieldset className="choices">
          <legend>Found: untick any that's wrong</legend>
          {looked.map((l, i) =>
            l.found ? (
              <label key={l.venue.id} className="signal">
                <input type="checkbox" checked={l.keep} onChange={(e) => setLooked((all) => all.map((x, j) => (j === i ? { ...x, keep: e.target.checked } : x)))} />
                <span>
                  <b>{l.venue.name}</b>
                  <small>{l.found.label}</small>
                </span>
              </label>
            ) : null
          )}
        </fieldset>
      )}
      {missing.length > 0 && (
        <p className="hint">
          Not found, to put on the map from their pages:{' '}
          {missing.map((l, i) => (
            <span key={l.venue.id}>
              {i > 0 && ', '}
              <a href={`#jobs/venues/${encodeURIComponent(l.venue.id)}`}>{l.venue.name}</a>
            </span>
          ))}
          .
        </p>
      )}
      <Refusal error={error} />
      <div className="actions">
        {state !== 'looking' && keep.length > 0 && (
          <button type="button" className="primary" onClick={save}>
            Put {plural(keep.length, 'venue')} on the map
          </button>
        )}
        {state === 'looking' ? (
          <button type="button" onClick={() => (stop.current = true)}>
            Stop looking
          </button>
        ) : (
          <button type="button" onClick={onDone}>
            {keep.length > 0 ? 'Cancel' : 'Close'}
          </button>
        )}
      </div>
    </div>
  )
}
