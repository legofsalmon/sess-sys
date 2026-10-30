import {
  daysLabel,
  HOLDING,
  newId,
  offerMessage,
  OPEN,
  tellMessage,
  whatsappNumber,
  type CallView,
  type OfferView,
  type Person,
  type PersonView,
  type TellContext,
  type TellEvent,
} from '@sh/shared'
import { useEffect, useRef, useState } from 'react'
import { useAccess } from '../role.ts'
import { useView } from '../view.ts'

/**
 * The messages for crew the office sends itself (audit finding 9): an offer,
 * or word of a change, on WhatsApp, a text or an email with the words filled
 * in. Nothing is sent for you.
 */

export const linkFor = (p: Pick<Person, 'linkToken'>) => (p.linkToken ? `${location.origin}/f/${p.linkToken}` : '')

/** One person to tell, with the call it's about and whatever else the message needs. */
export interface TellTo {
  person: Person
  context: TellContext
}

/** People to tell after something the office did, and what happened. */
export interface Tell {
  /** Its own, so a new prompt starts from its first person even when it replaces one still open. */
  id: string
  event: TellEvent
  to: TellTo[]
}

/** What's open at the bottom of a screen: an offer to send, or people to tell. One at a time. */
export type Share = { kind: 'offer'; person: PersonView; call: CallView } | { kind: 'tell'; tell: Tell }

/**
 * The prompt after something the office did (audit finding 9): a message
 * for each person, written for what happened, to send by WhatsApp, text or
 * email as the offer is, or to copy. The app sends nothing itself. Nothing
 * when there's nobody to tell. A call changed or a phase moved prompts the
 * same way: setShare(promptFor('call-changed', peopleOn(call))).
 */
export function promptFor(event: TellEvent, to: TellTo[]): Share | undefined {
  return to.length ? { kind: 'tell', tell: { id: newId(), event, to } } : undefined
}

/** Someone to tell about a call, with their own days and agreed rate when they have an offer on it. */
export function tellTo(person: Person, call: CallView, offer?: Pick<OfferView, 'id' | 'days' | 'status' | 'dayRateCents' | 'counterRateCents'>): TellTo {
  const agreed = offer ? (offer.status === 'countered' ? offer.counterRateCents : offer.dayRateCents) : call.dayRateCents
  return { person, context: { call: { ...call, dayRateCents: agreed }, days: offer?.days, offerId: offer?.id } }
}

/** Everyone offered or holding a place on a call, to tell when it changes or goes. */
export function peopleOn(call: CallView, statuses: readonly OfferView['status'][] = [...OPEN, ...HOLDING]): TellTo[] {
  return call.offers.filter((o) => o.person && statuses.includes(o.status)).map((o) => tellTo(o.person as Person, call, o))
}

/** The panel for whatever is open: the offer to send, or the people to tell one at a time. */
export function SharePanelFor({ share, onClose }: { share: Share; onClose: () => void }) {
  if (share.kind === 'offer') return <SharePanel person={share.person} call={share.call} onClose={onClose} />
  return <TellPanel key={share.tell.id} tell={share.tell} onClose={onClose} />
}

/** WhatsApp, a text or an email with the words filled in, or a copy of them. Nothing is sent for you. */
export function SendButtons({ person, text, subject }: { person: Pick<Person, 'phone' | 'email'>; text: string; subject: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <>
      {person.phone && (
        <>
          <a className="button primary" href={`https://wa.me/${whatsappNumber(person.phone)}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">
            WhatsApp
          </a>
          <a className="button" href={`sms:${person.phone}?&body=${encodeURIComponent(text)}`}>
            Text
          </a>
        </>
      )}
      {person.email && (
        <a className="button" href={`mailto:${person.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`}>
          Email
        </a>
      )}
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => setCopied(true))
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </>
  )
}

/** Whether Offer, Send, Tell and Ask open a message to a real person (ADR 0048): off until the office says so under Admin. */
export const usePromptsMessages = () => useView().office.promptMessages

/**
 * In a Send panel's place while messages to crew are off (ADR 0048): what
 * would have opened, for whom, that their link carries it regardless, and
 * where it's turned on. The mode shows itself where it bites, not only on
 * Admin (rule 14).
 */
export function QuietPanel({ names, what, onLink = true, onClose }: { names: readonly string[]; what: string; onLink?: boolean; onClose: () => void }) {
  const admin = useAccess().can('settings')
  const who = names.length === 1 ? names[0] : `${names.length} people`
  // Opened by Offer or Send, perhaps below the fold on a desk: brought into view, and focus with it, so it's seen and read rather than
  // left under the fold with focus nowhere (audit, 20 October 2026, finding 77c).
  const panel = useRef<HTMLElement>(null)
  useEffect(() => {
    panel.current?.scrollIntoView?.({ block: 'nearest' })
    panel.current?.focus({ preventScroll: true })
  }, [])
  return (
    <section className="card share" aria-label={`Messages to crew are off: ${what} for ${who}`} ref={panel} tabIndex={-1}>
      <h2>Messages to crew are off</h2>
      <p className="empty">
        Nothing opened to send {who} the {what}.{onLink ? ` ${names.length === 1 ? 'Their link' : 'Their links'} already say${names.length === 1 ? 's' : ''} so.` : ''} Messages
        are turned on under {admin ? <a href="#admin/company">Admin › Company</a> : 'Admin, by the office'}.
      </p>
      <button type="button" onClick={onClose}>
        Done
      </button>
    </section>
  )
}

/**
 * Their private link isn't on this device: not made yet (the server makes it
 * when the person first syncs), or not sent to this role (ADR 0046), when
 * the office sends it, and whatever was done is already on their page.
 */
function NoLinkYet({ person, onClose }: { person: Pick<Person, 'name'> & Partial<Pick<Person, 'linkHidden'>>; onClose: () => void }) {
  return (
    <section className="card share">
      <h2>Send to {person.name}</h2>
      <p className="empty">
        {person.linkHidden
          ? `Your role doesn't see ${person.name}'s private link, so the office sends this one. It's already on their page.`
          : 'Their private link is made when this device next syncs. Try again once it says “Up to date”.'}
      </p>
      <button type="button" onClick={onClose}>
        Close
      </button>
    </section>
  )
}

/** Send a person something on their private link: an offer, or with `message`, something else such as their call sheet (ADR 0021). */
export function SharePanel({
  person,
  call,
  onClose,
  message,
}: {
  person: PersonView
  call: CallView
  onClose: () => void
  message?: (link: string) => { text: string; subject: string; what: string }
}) {
  const prompts = usePromptsMessages()
  if (!prompts) return <QuietPanel names={[person.name]} what={message?.('').what ?? 'offer'} onClose={onClose} />
  const link = linkFor(person)
  if (!link) return <NoLinkYet person={person} onClose={onClose} />
  const custom = message?.(link)
  const text = custom?.text ?? offerMessage(person, call, link)
  const subject = custom?.subject ?? `Work: ${call.project}, ${daysLabel(call.days)}`
  return (
    <section className="card share" aria-label={`Send ${custom?.what ?? 'offer'} to ${person.name}`}>
      <h2>Send to {person.name}</h2>
      <textarea readOnly value={text} rows={6} />
      <div className="actions">
        <SendButtons key={person.id} person={person} text={text} subject={subject} />
        <button type="button" className="link" onClick={onClose}>
          Done
        </button>
      </div>
    </section>
  )
}

/**
 * The people to tell after something the office did, one at a time: the
 * message written for what happened, the ways to send it, and Done or Skip
 * to move to the next. "Tell 3 people" for a cancelled job; just the one
 * after a Confirm.
 */
export function TellPanel({ tell, onClose }: { tell: Tell; onClose: () => void }) {
  const [at, setAt] = useState(0)
  const prompts = usePromptsMessages()
  const to = tell.to[at]
  if (!to) return null
  if (!prompts) return <QuietPanel names={tell.to.map((t) => t.person.name)} what={tellMessage(tell.event, to.person, to.context, '').what} onClose={onClose} />
  const { person, context } = to
  const n = tell.to.length
  const next = () => (at + 1 < n ? setAt(at + 1) : onClose())
  const link = linkFor(person)
  if (!link) return <NoLinkYet person={person} onClose={next} />
  const { text, subject, what } = tellMessage(tell.event, person, context, link)
  return (
    <section className="card share" aria-label={`Send ${what} to ${person.name}`}>
      <h2>{n === 1 ? `Tell ${person.name}` : `Tell ${n} people: ${person.name} (${at + 1} of ${n})`}</h2>
      <textarea readOnly value={text} rows={6} />
      <div className="actions">
        <SendButtons key={person.id} person={person} text={text} subject={subject} />
        <button type="button" className="link" onClick={next}>
          {at + 1 < n ? 'Done, next' : 'Done'}
        </button>
        {at + 1 < n && (
          <button type="button" className="link" onClick={next}>
            Skip
          </button>
        )}
      </div>
    </section>
  )
}
