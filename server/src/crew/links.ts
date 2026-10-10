import { eachDay, EURO_HINT, feedCodeFor, feedPath, HOLDING, isDay, LATE_BY, lateDays, MAX_EXTRAS, newId, noTimesheetReason, OPEN, parseEuro, type CommandArgs, type CommandName, type LateBy, type CrewCall, type MutationResult, type Offer, type Person, type TimesheetExtra } from '@sh/shared'
import { FILE_TOO_BIG, NO_FILE, WEB_FILE, WRONG_FILE } from '@sh/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { applyMutation } from '../commands.ts'
import type { Db } from '../db.ts'
import { describeDevice } from '../devices.ts'
import { documentsSection } from '../documents/page.ts'
import { documentsOf } from '../documents/store.ts'
import { publicOrigin } from '../http.ts'
import { officeFor } from '../office/store.ts'
import { getPhase } from '../projects/store.ts'
import { sendFeed, type Feeds } from './feeds.ts'
import { getLate, lateFor, lateOf } from './late.ts'
import { renderGone, renderPage, type Flash, type Kept, type OnTheDay } from './page.ts'
import { renderNoSheet, renderSheet, sheetFor } from './sheet.ts'
import { awayFor, endedOn, getAway, getCall, getOffer, getPerson, heldByCall, heldElsewhereIn, offersFor, personByToken } from './store.ts'
import { renderTimesheet } from './timesheet-page.ts'
import { getTimesheet, timesheetsFor } from './timesheets.ts'

/**
 * A freelancer's private link, /f/<token>: their page, the answers they
 * post from it, their bookings' call sheets and timesheets, their calendar
 * feed and their data. The token is the only
 * credential, so every action checks the thing it touches belongs to the
 * link's person. Answers go through the same command handlers as the app,
 * so the same rules (first to accept, no double booking) hold.
 *
 * The calendar feed also has a read-only address of its own,
 * /cal/<code>.ics, safe to add to a shared calendar (ADR 0012).
 */

type Form = URLSearchParams
/**
 * The address after a post says which message to show, by code (m) or as
 * the refusal of the change just made (r), and where: the offer's card (o)
 * or their details (s). None of it is ever drawn as words.
 */
type Req = FastifyRequest<{ Params: { token: string; id?: string }; Querystring: { m?: string; r?: string; o?: string; s?: string } }>

/** Where a post's message goes: a section of its own, the running-late card (ADR 0028), their documents (ADR 0029), their days off, or else the offer's card. */
const SECTIONS = ['details', 'late', 'documents', 'away'] as const

const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Dublin' })

/**
 * Everything the pages say after a post, by the short code the address
 * carries (audit finding 21). The address used to carry the words
 * themselves, so anything typed into it was drawn on the page: escaped,
 * but drawn. Now a code the server doesn't know shows nothing.
 */
const SAID = {
  // Answering an offer.
  accepted: { ok: true, text: "Thanks, you're down for it. The office will confirm." },
  declined: { ok: true, text: "Thanks for letting us know. You're off this one." },
  'pulled-out': { ok: true, text: "Thanks for telling us. You're off this one, and the office will find cover." },
  'rate-sent': { ok: true, text: 'Thanks, your rate has gone to the office.' },
  'tap-a-button': { ok: false, text: 'Tap Accept, Decline or Send rate.' },
  'tap-yes-or-no': { ok: false, text: 'Tap Accept or Decline.' },
  'tick-a-day': { ok: false, text: 'Tick at least one day, or press Decline.' },
  'no-rate': { ok: false, text: 'Put in the day rate you would do it for.' },
  'not-a-price': { ok: false, text: EURO_HINT },
  'not-your-offer': { ok: false, text: "That offer isn't one of yours." },
  'try-again': { ok: false, text: 'Something went wrong; please try again.' },
  // Their own details.
  'details-same': { ok: true, text: 'Nothing to change: those are the details we have.' },
  'details-saved': { ok: true, text: 'Saved. The office has your new details.' },
  // Days they can't work.
  'days-off-added': { ok: true, text: "Got it. We won't offer you work on those days." },
  'days-off-removed': { ok: true, text: 'Removed. You can be offered work on those days again.' },
  'days-off-gone': { ok: true, text: 'Already removed.' },
  'check-the-dates': { ok: false, text: 'Check the dates and try again.' },
  // A timesheet.
  'timesheet-sent': { ok: true, text: "Thanks, it's gone to the office. You can change it until they approve it." },
  'not-your-booking': { ok: false, text: "That booking isn't one of yours." },
  'tick-a-day-worked': { ok: false, text: 'Tick at least one day you worked.' },
  'say-what-for': { ok: false, text: 'Say what each extra is for.' },
  'extra-amount': { ok: false, text: 'Put in the amount for each extra, in euro.' },
  'too-many-extras': { ok: false, text: `There's room for ${MAX_EXTRAS} extras: put the rest together, or in the note.` },
  // Running late (ADR 0028).
  'late-sent': { ok: true, text: "Thanks. The office, and whoever's running the day, can see it now." },
  'late-how': { ok: false, text: "Tap roughly how late you'll be, or put in the time you'll be there." },
  'late-here': { ok: true, text: "Thanks. The office can see you're there." },
  // Sending a document (ADR 0029), from server/src/documents/routes.ts.
  'doc-sent': { ok: true, text: "Thanks, it's gone to the office. They'll check it, and it's on your list meanwhile." },
  'doc-no-file': { ok: false, text: NO_FILE },
  'doc-too-big': { ok: false, text: FILE_TOO_BIG },
  'doc-web-page': { ok: false, text: WEB_FILE },
  'doc-not-a-file': { ok: false, text: WRONG_FILE },
  'doc-not-on': { ok: false, text: "Sending documents here isn't switched on yet. For now, send a photo or a PDF of it to the office by WhatsApp or email." },
  'doc-not-yours': { ok: false, text: "That document isn't one of yours." },
  'doc-not-kept': { ok: false, text: "The file couldn't be kept just now, so nothing was sent. Try again in a minute." },
} satisfies Record<string, { ok: boolean; text: string }>
type Said = keyof typeof SAID
type Refusal = Extract<MutationResult, { status: 'rejected' }>

/** The address's part for a message: its code, or the id of the change that was refused. */
const told = (what: Said | Refusal): Record<string, string> => (typeof what === 'string' ? { m: what } : { r: what.id })

export function registerCrewLinks(app: FastifyInstance, db: Db, onChange: () => void, feeds: Feeds) {
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) =>
    done(null, new URLSearchParams(String(body)))
  )

  const base = (req: FastifyRequest, token: string) => `${publicOrigin(req)}/f/${token}`

  /**
   * The message the address asks for: one of the pages' own, by its code,
   * or the refusal the server recorded for one of this link's own changes,
   * in the words the rules gave it (they name the job and the days). A code
   * it doesn't know, or someone else's change, shows nothing.
   */
  async function flashFor(personId: string, q: Req['query']): Promise<Flash | undefined> {
    const said = q.m && Object.hasOwn(SAID, q.m) ? SAID[q.m as Said] : undefined
    let refused: string | undefined
    if (!said && q.r && /^[\w-]{1,64}$/.test(q.r)) {
      const { rows } = await db.query<{ message: string | null }>(
        `SELECT result->'reason'->>'message' AS message FROM mutations WHERE id = $1 AND client_id = $2 AND status = 'rejected'`,
        [q.r, `link:${personId}`]
      )
      refused = rows[0]?.message ?? undefined
    }
    const text = said?.text ?? refused
    if (text === undefined) return undefined
    const section = SECTIONS.find((x) => x === q.s)
    return { ok: said?.ok ?? false, text, ...(q.o ? { offer: q.o } : {}), ...(section ? { section } : {}) }
  }

  async function run<N extends CommandName>(req: FastifyRequest, personId: string, name: N, args: CommandArgs<N>): Promise<MutationResult> {
    const result = await applyMutation(
      db,
      `link:${personId}`,
      { id: newId(), name, args, createdAt: new Date().toISOString() },
      { via: 'link', device: describeDevice(req.headers['user-agent']) }
    )
    if (result.status === 'applied') onChange()
    return result
  }

  /**
   * After a post, back to the page with a message, so a refresh never
   * resubmits. An answer names its offer, so the page lands on that card
   * with the message in it.
   */
  const back = (reply: FastifyReply, token: string, what: Said | Refusal, offer?: string) =>
    reply.redirect(`/f/${token}?${new URLSearchParams({ ...told(what), ...(offer ? { o: offer } : {}) })}${offer ? `#o-${offer}` : ''}`, 303)

  const noStore = (reply: FastifyReply) => reply.header('cache-control', 'no-store').header('x-robots-tag', 'noindex')

  /** A link that doesn't work any more, with the office's number and email to ask for a new one. */
  const gone = async (reply: FastifyReply) => reply.code(404).type('text/html').send(renderGone(await officeFor(db)))

  /** A refusal in words: one of the pages' own, or the reason the rules gave. */
  const reasonOf = (what: Said | Refusal) => (typeof what === 'string' ? SAID[what].text : what.reason.message)

  /**
   * A refused post (rule 11): the page drawn again at once, with the reason
   * where the form is and everything typed still in it, rather than a
   * redirect, which could carry only the reason. The form's address ends in
   * its place on the page, so the browser lands there.
   */
  const refused = async (req: Req, reply: FastifyReply, person: Person, what: Said | Refusal, kept: Kept, where: Pick<Flash, 'offer' | 'section'>) =>
    noStore(reply)
      .code(422)
      .type('text/html')
      .send(await home(req, person, { ok: false, text: reasonOf(what), ...where }, kept))

  /** Their page, with a message, and with what a refused post typed drawn back into its form. */
  async function home(req: Req, person: Person, flash: Flash | undefined, kept?: Kept): Promise<string> {
    const rows = await offersFor(db, person.id)
    const held = await heldByCall(db, rows.map((r) => r.call))
    const now = today()
    const jobs = rows.map(({ offer, call }) => {
      const byDay = held.get(call.id)!
      // Days they hold on another job, for the picker to leave unticked and say so (audit finding 21), where there's still an answer to give.
      // Worked out from the offers just read, as the rules work it out, so a person offered many jobs costs no query more.
      const busy: Record<string, string> = {}
      if ((OPEN.includes(offer.status) || offer.status === 'accepted') && call.status === 'open' && call.end >= now)
        for (const c of heldElsewhereIn(rows, eachDay(call.start, call.end), call.id)) for (const d of c.days) busy[d] = c.project
      return { offer, call, openDays: Object.keys(byDay).filter((d) => byDay[d]! < call.needed), busy }
    })
    const feed = `${publicOrigin(req)}${feedPath(await feedCodeFor(person.linkToken))}`
    // A day they hold, from 6pm the evening before (ADR 0028): what they've said about being late, and who to ring if it won't send.
    const onTheDay: OnTheDay[] = []
    for (const { offer, call } of rows) {
      if (!HOLDING.includes(offer.status) || call.status !== 'open') continue
      const days = lateDays(offer.days)
      if (!days.length) continue
      const said = (await Promise.all(days.map((d) => lateFor(db, offer.id, d)))).filter((l) => l !== undefined)
      const phase = call.phaseId ? await getPhase(db, call.phaseId) : undefined
      const lead = phase?.contactId && phase.contactId !== person.id ? await getPerson(db, phase.contactId) : undefined
      onTheDay.push({ offer, call, days, said, contact: lead && !lead.archived ? { name: lead.name, phone: lead.phone } : null })
    }
    return renderPage({
      person,
      jobs,
      away: await awayFor(db, person.id),
      base: base(req, person.linkToken),
      feed,
      flash,
      kept,
      today: now,
      ended: await endedOn(db, rows.map((r) => r.offer)),
      timesheets: await timesheetsFor(db, person.id),
      office: await officeFor(db),
      onTheDay,
      // Their documents (ADR 0029), with forms to send a new one where the server can keep files.
      documents: documentsSection({ person, list: await documentsOf(db, person.id), files: app.documents.on, base: base(req, person.linkToken), today: now, flash }),
    })
  }

  app.get('/f/:token', async (req: Req, reply) => {
    noStore(reply)
    const person = await personByToken(db, req.params.token)
    if (!person) return gone(reply)
    return reply.type('text/html').send(await home(req, person, await flashFor(person.id, req.query)))
  })

  // A booking's call sheet (ADR 0021): only the person's own, while it's going ahead.
  app.get('/f/:token/sheet/:id', async (req: Req, reply) => {
    noStore(reply)
    const person = await personByToken(db, req.params.token)
    if (!person) return gone(reply)
    const sheet = await sheetFor(db, person.id, req.params.id ?? '')
    if (!sheet) return reply.code(404).type('text/html').send(renderNoSheet(base(req, person.linkToken)))
    return reply.type('text/html').send(renderSheet(sheet, base(req, person.linkToken), await officeFor(db)))
  })

  /** A booking's timesheet page, with a message, and with what a refused post typed drawn back into the form. */
  async function timesheetPage(req: Req, person: Person, offer: Offer, call: CrewCall, flash: Flash | undefined, kept?: URLSearchParams) {
    return renderTimesheet({
      offer,
      call,
      timesheet: await getTimesheet(db, offer.id),
      why: noTimesheetReason(offer, call, person, today()),
      staff: person.kind === 'staff',
      base: base(req, person.linkToken),
      flash,
      kept,
      office: await officeFor(db),
    })
  }

  // A booking's timesheet (ADR 0022): the person's own, from its first day.
  app.get('/f/:token/timesheet/:id', async (req: Req, reply) => {
    noStore(reply)
    const person = await personByToken(db, req.params.token)
    if (!person) return gone(reply)
    const offer = await getOffer(db, req.params.id ?? '')
    const call = offer && offer.personId === person.id ? await getCall(db, offer.callId) : undefined
    if (!offer || !call) return reply.code(404).type('text/html').send(renderNoSheet(base(req, person.linkToken), 'timesheet'))
    return reply.type('text/html').send(await timesheetPage(req, person, offer, call, await flashFor(person.id, req.query)))
  })

  app.post('/f/:token/timesheet/:id', async (req: Req, reply) => {
    const person = await personByToken(db, req.params.token)
    if (!person) return gone(reply)
    const offer = await getOffer(db, req.params.id ?? '')
    if (!offer || offer.personId !== person.id) return back(reply, person.linkToken, 'not-your-booking')
    const again = (what: Said | Refusal) => reply.redirect(`/f/${person.linkToken}/timesheet/${encodeURIComponent(offer.id)}?${new URLSearchParams(told(what))}`, 303)
    const form = (req.body ?? new URLSearchParams()) as Form
    // A refusal keeps the days, extras and note as they were typed (rule 11).
    const call = await getCall(db, offer.callId)
    const turnedDown = async (what: Said | Refusal) =>
      call ? noStore(reply).code(422).type('text/html').send(await timesheetPage(req, person, offer, call, { ok: false, text: reasonOf(what) }, form)) : again(what)
    const days = form.getAll('days')
    if (days.length === 0) return turnedDown('tick-a-day-worked')
    const whats = form.getAll('what')
    const euros = form.getAll('euro')
    const extras: TimesheetExtra[] = []
    for (let i = 0; i < Math.max(whats.length, euros.length); i++) {
      const what = (whats[i] ?? '').trim().slice(0, 100)
      const typed = (euros[i] ?? '').trim()
      if (!what && !typed) continue
      if (!what) return turnedDown('say-what-for')
      // As typed on a phone: "€12.50", "12,50" or "1,250" all read as a person means them (audit finding 15).
      const amount = parseEuro(typed)
      if (amount.reason !== undefined || !amount.cents) return turnedDown('extra-amount')
      extras.push({ what, cents: amount.cents })
    }
    if (extras.length > MAX_EXTRAS) return turnedDown('too-many-extras')
    const note = (form.get('note') ?? '').slice(0, 1000)
    const result = await run(req, person.id, 'timesheet.send', { id: offer.id, days, extras, note })
    if (result.status === 'rejected') return turnedDown(result)
    return again('timesheet-sent')
  })

  app.post('/f/:token/offers/:id', async (req: Req, reply) => {
    const person = await personByToken(db, req.params.token)
    if (!person) return gone(reply)
    const offer = await getOffer(db, req.params.id!)
    if (!offer || offer.personId !== person.id) return back(reply, person.linkToken, 'not-your-offer')
    const form = (req.body ?? new URLSearchParams()) as Form
    // A refusal keeps the days ticked, the rate and the note as they were typed, in the offer's card (rule 11).
    const turnedDown = (what: Said | Refusal) => refused(req, reply, person, what, { form: `offer:${offer.id}`, values: form }, { offer: offer.id })
    let answer = form.get('answer')
    // Enter in the rate field presses the form's hidden first button. With a rate that's a counter; without one there's only a tap to ask for. Never an accept.
    if (answer === 'implicit') {
      // Staff have no rate to send (audit finding 21), so there are only two buttons to name.
      if (!(form.get('rate') ?? '').trim()) return turnedDown(person.kind === 'staff' ? 'tap-yes-or-no' : 'tap-a-button')
      answer = 'counter'
    }
    const note = (form.get('note') ?? '').slice(0, 1000)
    const picked = form.getAll('days')
    if (form.get('picker') && picked.length === 0 && answer !== 'decline') return turnedDown('tick-a-day')
    const days = picked.length ? picked : null

    let result: MutationResult
    if (answer === 'accept') result = await run(req, person.id, 'offer.respond', { id: offer.id, answer: 'accept', days, note })
    else if (answer === 'decline') result = await run(req, person.id, 'offer.respond', { id: offer.id, answer: 'decline', note })
    // "Can't make it any more" (audit finding 10): a job they had said yes to, given back.
    else if (answer === 'pullOut') result = await run(req, person.id, 'offer.respond', { id: offer.id, answer: 'pullOut', note })
    else if (answer === 'counter') {
      // Staff are paid through payroll, so their page has no rate to send (audit finding 21), and a post that sends one anyway is asked for a tap.
      if (person.kind === 'staff') return turnedDown('tap-yes-or-no')
      // "€300", "1,250" or "1 250,50" read as the person means them (audit finding 15); anything else says what to put in.
      const rate = parseEuro(form.get('rate') ?? '')
      if (rate.reason !== undefined) return turnedDown('not-a-price')
      if (!rate.cents) return turnedDown('no-rate')
      result = await run(req, person.id, 'offer.respond', { id: offer.id, answer: 'counter', counterRateCents: rate.cents, days, note })
    } else return back(reply, person.linkToken, 'try-again')

    if (result.status === 'rejected') return turnedDown(result)
    const said: Said = answer === 'accept' ? 'accepted' : answer === 'decline' ? 'declined' : answer === 'pullOut' ? 'pulled-out' : 'rate-sent'
    // A pull-out leaves the card for "Declined and withdrawn", so its message goes at the top.
    return back(reply, person.linkToken, said, answer === 'pullOut' ? undefined : offer.id)
  })

  /**
   * Running late (ADR 0028), on a day they hold: roughly how late or the
   * time they'll be there, and a note. Said again, it replaces what was
   * said. The message lands in the running-late card.
   */
  app.post('/f/:token/late', async (req: Req, reply) => {
    const person = await personByToken(db, req.params.token)
    if (!person) return gone(reply)
    const form = (req.body ?? new URLSearchParams()) as Form
    const offer = await getOffer(db, form.get('offer') ?? '')
    if (!offer || offer.personId !== person.id) return back(reply, person.linkToken, 'not-your-booking')
    const inCard = (what: Said | Refusal) => reply.redirect(`/f/${person.linkToken}?${new URLSearchParams({ ...told(what), s: 'late', o: offer.id })}#late-${offer.id}`, 303)
    const typed = form.get('by') ?? ''
    const by = (LATE_BY as readonly string[]).includes(typed) ? (typed as LateBy) : null
    const arriveAt = (form.get('at') ?? '').trim() || null
    // A refusal keeps how late, the time and the note as they were typed, in the running-late card (rule 11).
    const turnedDown = (what: Said | Refusal) => refused(req, reply, person, what, { form: `late:${offer.id}`, values: form }, { section: 'late', offer: offer.id })
    if (!by && !arriveAt) return turnedDown('late-how')
    const day = form.get('day') ?? ''
    // The same record each time, so the office sees one line for the day, however often it changes.
    const was = isDay(day) ? await lateFor(db, offer.id, day) : undefined
    const note = (form.get('note') ?? '').trim().slice(0, 200)
    const result = await run(req, person.id, 'late.say', { id: was?.id ?? newId(), offerId: offer.id, day, by, arriveAt, note })
    return result.status === 'rejected' ? turnedDown(result) : inCard('late-sent')
  })

  app.post('/f/:token/late/here', async (req: Req, reply) => {
    const person = await personByToken(db, req.params.token)
    if (!person) return gone(reply)
    const form = (req.body ?? new URLSearchParams()) as Form
    const late = await getLate(db, form.get('id') ?? '')
    if (!late || late.personId !== person.id) return back(reply, person.linkToken, 'not-your-booking')
    const result = await run(req, person.id, 'late.arrived', { id: late.id })
    return reply.redirect(`/f/${person.linkToken}?${new URLSearchParams({ ...told(result.status === 'rejected' ? result : 'late-here'), s: 'late', o: late.offerId })}#late-${late.offerId}`, 303)
  })

  // Their own email and phone (audit finding 7). Only what differs is sent, so the history can say which changed.
  app.post('/f/:token/details', async (req: Req, reply) => {
    const person = await personByToken(db, req.params.token)
    if (!person) return gone(reply)
    const inSection = (what: Said | Refusal) => reply.redirect(`/f/${person.linkToken}?${new URLSearchParams({ ...told(what), s: 'details' })}#details`, 303)
    const form = (req.body ?? new URLSearchParams()) as Form
    // A field the form didn't send is left alone; one sent empty is cleared.
    const typed = (name: string) => (form.has(name) ? form.get(name)!.trim().slice(0, 200) || null : undefined)
    const changes: CommandArgs<'person.contact'> = { id: person.id }
    const email = typed('email')
    const phone = typed('phone')
    if (email !== undefined && email !== person.email) changes.email = email
    if (phone !== undefined && phone !== person.phone) changes.phone = phone
    if (changes.email === undefined && changes.phone === undefined) return inSection('details-same')
    const result = await run(req, person.id, 'person.contact', changes)
    // A refusal keeps the number and email as they were typed (rule 11).
    if (result.status === 'rejected') return refused(req, reply, person, result, { form: 'details', values: form }, { section: 'details' })
    return inSection('details-saved')
  })

  app.post('/f/:token/away', async (req: Req, reply) => {
    const person = await personByToken(db, req.params.token)
    if (!person) return gone(reply)
    const form = (req.body ?? new URLSearchParams()) as Form
    const start = form.get('start') ?? ''
    const end = form.get('end') || start
    const result = await run(req, person.id, 'unavailability.add', {
      id: newId(),
      personId: person.id,
      start,
      end,
      note: (form.get('note') ?? '').slice(0, 500),
    }).catch(() => undefined)
    // A refusal keeps the dates and the note as they were typed, beside the form (rule 11).
    if (!result || result.status === 'rejected') return refused(req, reply, person, result ?? 'check-the-dates', { form: 'away', values: form }, { section: 'away' })
    return back(reply, person.linkToken, 'days-off-added')
  })

  app.post('/f/:token/away/:id/remove', async (req: Req, reply) => {
    const person = await personByToken(db, req.params.token)
    if (!person) return gone(reply)
    const away = await getAway(db, req.params.id!)
    if (!away || away.personId !== person.id) return back(reply, person.linkToken, 'days-off-gone')
    const result = await run(req, person.id, 'unavailability.remove', { id: away.id })
    if (result.status === 'rejected') return back(reply, person.linkToken, result)
    return back(reply, person.linkToken, 'days-off-removed')
  })

  // Both feed addresses answer from memory, so calendar apps looking every hour don't wake the database.
  app.get('/cal/:token', async (req: Req, reply) => {
    const code = req.params.token.replace(/\.ics$/, '')
    return sendFeed(req, reply, /^[\w-]{24}$/.test(code) ? await feeds.byCode(code) : undefined)
  })

  /** The first address, at the private link (ADR 0002): kept so no one already subscribed is cut off. */
  app.get('/f/:token/calendar.ics', async (req: Req, reply) => {
    const token = req.params.token
    return sendFeed(req, reply, token.length >= 16 ? await feeds.byLink(token) : undefined)
  })

  /** Everything held on this person, as the "download your data" promise says. */
  app.get('/f/:token/data.json', async (req: Req, reply) => {
    noStore(reply)
    const person = await personByToken(db, req.params.token)
    if (!person) return reply.code(404).send({ error: 'Not found' })
    const { linkToken: _secret, ...profile } = person
    return reply.header('content-disposition', 'attachment; filename="session-hire-my-data.json"').send({
      exportedAt: new Date().toISOString(),
      profile,
      daysOff: await awayFor(db, person.id),
      jobs: await offersFor(db, person.id),
      timesheets: [...(await timesheetsFor(db, person.id)).values()],
      runningLate: await lateOf(db, person.id),
      // The details; each file is on their page (ADR 0029).
      documents: await documentsOf(db, person.id),
    })
  })
}
