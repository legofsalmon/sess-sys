import { eachDay, feedCodeFor, feedPath, MAX_EXTRAS, newId, noTimesheetReason, parseEuro, type CommandArgs, type CommandName, type MutationResult, type TimesheetExtra } from '@sh/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { applyMutation } from '../commands.ts'
import type { Db } from '../db.ts'
import { describeDevice } from '../devices.ts'
import { publicOrigin } from '../http.ts'
import { officeFor } from '../office/store.ts'
import { sendFeed, type Feeds } from './feeds.ts'
import { renderGone, renderPage } from './page.ts'
import { renderNoSheet, renderSheet, sheetFor } from './sheet.ts'
import { awayFor, getAway, getCall, getOffer, offersFor, offersForCall, personByToken } from './store.ts'
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
type Req = FastifyRequest<{ Params: { token: string; id?: string }; Querystring: { m?: string; ok?: string; o?: string; s?: string } }>

const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Dublin' })

export function registerCrewLinks(app: FastifyInstance, db: Db, onChange: () => void, feeds: Feeds) {
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) =>
    done(null, new URLSearchParams(String(body)))
  )

  const base = (req: FastifyRequest, token: string) => `${publicOrigin(req)}/f/${token}`

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
  const back = (reply: FastifyReply, token: string, text: string, ok: boolean, offer?: string) =>
    reply.redirect(`/f/${token}?${new URLSearchParams({ m: text, ok: ok ? '1' : '0', ...(offer ? { o: offer } : {}) })}${offer ? `#o-${offer}` : ''}`, 303)

  const noStore = (reply: FastifyReply) => reply.header('cache-control', 'no-store').header('x-robots-tag', 'noindex')

  app.get('/f/:token', async (req: Req, reply) => {
    noStore(reply)
    const person = await personByToken(db, req.params.token)
    if (!person) return reply.code(404).type('text/html').send(renderGone())
    const rows = await offersFor(db, person.id)
    const jobs = []
    for (const { offer, call } of rows) {
      const held: Record<string, number> = {}
      for (const d of eachDay(call.start, call.end)) held[d] = 0
      for (const o of await offersForCall(db, call.id))
        if (o.status === 'accepted' || o.status === 'confirmed') for (const d of o.days) if (d in held) held[d]!++
      jobs.push({ offer, call, openDays: Object.keys(held).filter((d) => held[d]! < call.needed) })
    }
    const flash = req.query.m
      ? { ok: req.query.ok === '1', text: req.query.m.slice(0, 300), offer: req.query.o, ...(req.query.s === 'details' ? { section: 'details' as const } : {}) }
      : undefined
    const feed = `${publicOrigin(req)}${feedPath(await feedCodeFor(person.linkToken))}`
    return reply
      .type('text/html')
      .send(
        renderPage({
          person,
          jobs,
          away: await awayFor(db, person.id),
          base: base(req, person.linkToken),
          feed,
          flash,
          today: today(),
          timesheets: await timesheetsFor(db, person.id),
          office: await officeFor(db),
        })
      )
  })

  // A booking's call sheet (ADR 0021): only the person's own, while it's going ahead.
  app.get('/f/:token/sheet/:id', async (req: Req, reply) => {
    noStore(reply)
    const person = await personByToken(db, req.params.token)
    if (!person) return reply.code(404).type('text/html').send(renderGone())
    const sheet = await sheetFor(db, person.id, req.params.id ?? '')
    if (!sheet) return reply.code(404).type('text/html').send(renderNoSheet(base(req, person.linkToken)))
    return reply.type('text/html').send(renderSheet(sheet, base(req, person.linkToken), await officeFor(db)))
  })

  // A booking's timesheet (ADR 0022): the person's own, from its first day.
  app.get('/f/:token/timesheet/:id', async (req: Req, reply) => {
    noStore(reply)
    const person = await personByToken(db, req.params.token)
    if (!person) return reply.code(404).type('text/html').send(renderGone())
    const offer = await getOffer(db, req.params.id ?? '')
    const call = offer && offer.personId === person.id ? await getCall(db, offer.callId) : undefined
    if (!offer || !call) return reply.code(404).type('text/html').send(renderNoSheet(base(req, person.linkToken), 'timesheet'))
    const flash = req.query.m ? { ok: req.query.ok === '1', text: req.query.m.slice(0, 300) } : undefined
    return reply.type('text/html').send(
      renderTimesheet({
        offer,
        call,
        timesheet: await getTimesheet(db, offer.id),
        why: noTimesheetReason(offer, call, person, today()),
        base: base(req, person.linkToken),
        flash,
        office: await officeFor(db),
      })
    )
  })

  app.post('/f/:token/timesheet/:id', async (req: Req, reply) => {
    const person = await personByToken(db, req.params.token)
    if (!person) return reply.code(404).type('text/html').send(renderGone())
    const offer = await getOffer(db, req.params.id ?? '')
    if (!offer || offer.personId !== person.id) return back(reply, person.linkToken, "That booking isn't one of yours.", false)
    const again = (text: string, ok: boolean) =>
      reply.redirect(`/f/${person.linkToken}/timesheet/${encodeURIComponent(offer.id)}?${new URLSearchParams({ m: text, ok: ok ? '1' : '0' })}`, 303)
    const form = (req.body ?? new URLSearchParams()) as Form
    const days = form.getAll('days')
    if (days.length === 0) return again('Tick at least one day you worked.', false)
    const whats = form.getAll('what')
    const euros = form.getAll('euro')
    const extras: TimesheetExtra[] = []
    for (let i = 0; i < Math.max(whats.length, euros.length); i++) {
      const what = (whats[i] ?? '').trim().slice(0, 100)
      const typed = (euros[i] ?? '').trim()
      if (!what && !typed) continue
      if (!what) return again('Say what each extra is for.', false)
      // As typed on a phone: "€12.50", "12,50" or "1,250" all read as a person means them (audit finding 15).
      const amount = parseEuro(typed)
      if (amount.reason !== undefined || !amount.cents) return again(`Put in the amount for ${what}, in euro.`, false)
      extras.push({ what, cents: amount.cents })
    }
    if (extras.length > MAX_EXTRAS) return again(`There's room for ${MAX_EXTRAS} extras: put the rest together, or in the note.`, false)
    const note = (form.get('note') ?? '').slice(0, 1000)
    const result = await run(req, person.id, 'timesheet.send', { id: offer.id, days, extras, note })
    if (result.status === 'rejected') return again(result.reason.message, false)
    return again("Thanks, it's gone to the office. You can change it until they approve it.", true)
  })

  app.post('/f/:token/offers/:id', async (req: Req, reply) => {
    const person = await personByToken(db, req.params.token)
    if (!person) return reply.code(404).type('text/html').send(renderGone())
    const offer = await getOffer(db, req.params.id!)
    if (!offer || offer.personId !== person.id) return back(reply, person.linkToken, "That offer isn't one of yours.", false)
    const form = (req.body ?? new URLSearchParams()) as Form
    let answer = form.get('answer')
    // Enter in the rate field presses the form's hidden first button. With a rate that's a counter; without one there's only a tap to ask for. Never an accept.
    if (answer === 'implicit') {
      if (!(form.get('rate') ?? '').trim()) return back(reply, person.linkToken, 'Tap Accept, Decline or Send rate.', false, offer.id)
      answer = 'counter'
    }
    const note = (form.get('note') ?? '').slice(0, 1000)
    const picked = form.getAll('days')
    if (form.get('picker') && picked.length === 0 && answer !== 'decline')
      return back(reply, person.linkToken, 'Tick at least one day, or press Decline.', false, offer.id)
    const days = picked.length ? picked : null

    let result: MutationResult
    if (answer === 'accept') result = await run(req, person.id, 'offer.respond', { id: offer.id, answer: 'accept', days, note })
    else if (answer === 'decline') result = await run(req, person.id, 'offer.respond', { id: offer.id, answer: 'decline', note })
    // "Can't make it any more" (audit finding 10): a job they had said yes to, given back.
    else if (answer === 'pullOut') result = await run(req, person.id, 'offer.respond', { id: offer.id, answer: 'pullOut', note })
    else if (answer === 'counter') {
      // "€300", "1,250" or "1 250,50" read as the person means them (audit finding 15); anything else says what to put in.
      const rate = parseEuro(form.get('rate') ?? '')
      if (rate.reason !== undefined) return back(reply, person.linkToken, rate.reason, false, offer.id)
      if (!rate.cents) return back(reply, person.linkToken, 'Put in the day rate you would do it for.', false, offer.id)
      result = await run(req, person.id, 'offer.respond', { id: offer.id, answer: 'counter', counterRateCents: rate.cents, days, note })
    } else return back(reply, person.linkToken, 'Something went wrong; please try again.', false)

    if (result.status === 'rejected') return back(reply, person.linkToken, result.reason.message, false, offer.id)
    const text =
      answer === 'accept'
        ? "Thanks, you're down for it. The office will confirm."
        : answer === 'decline'
          ? "Thanks for letting us know. You're off this one."
          : answer === 'pullOut'
            ? "Thanks for telling us. You're off this one, and the office will find cover."
            : 'Thanks, your rate has gone to the office.'
    // A pull-out leaves the card for "Earlier", so its message goes at the top.
    return back(reply, person.linkToken, text, true, answer === 'pullOut' ? undefined : offer.id)
  })

  // Their own email and phone (audit finding 7). Only what differs is sent, so the history can say which changed.
  app.post('/f/:token/details', async (req: Req, reply) => {
    const person = await personByToken(db, req.params.token)
    if (!person) return reply.code(404).type('text/html').send(renderGone())
    const inSection = (text: string, ok: boolean) =>
      reply.redirect(`/f/${person.linkToken}?${new URLSearchParams({ m: text, ok: ok ? '1' : '0', s: 'details' })}#details`, 303)
    const form = (req.body ?? new URLSearchParams()) as Form
    // A field the form didn't send is left alone; one sent empty is cleared.
    const typed = (name: string) => (form.has(name) ? form.get(name)!.trim().slice(0, 200) || null : undefined)
    const changes: CommandArgs<'person.contact'> = { id: person.id }
    const email = typed('email')
    const phone = typed('phone')
    if (email !== undefined && email !== person.email) changes.email = email
    if (phone !== undefined && phone !== person.phone) changes.phone = phone
    if (changes.email === undefined && changes.phone === undefined) return inSection('Nothing to change: those are the details we have.', true)
    const result = await run(req, person.id, 'person.contact', changes)
    if (result.status === 'rejected') return inSection(result.reason.message, false)
    return inSection('Saved. The office has your new details.', true)
  })

  app.post('/f/:token/away', async (req: Req, reply) => {
    const person = await personByToken(db, req.params.token)
    if (!person) return reply.code(404).type('text/html').send(renderGone())
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
    if (!result || result.status === 'rejected')
      return back(reply, person.linkToken, result?.status === 'rejected' ? result.reason.message : 'Check the dates and try again.', false)
    return back(reply, person.linkToken, "Got it. We won't offer you work on those days.", true)
  })

  app.post('/f/:token/away/:id/remove', async (req: Req, reply) => {
    const person = await personByToken(db, req.params.token)
    if (!person) return reply.code(404).type('text/html').send(renderGone())
    const away = await getAway(db, req.params.id!)
    if (!away || away.personId !== person.id) return back(reply, person.linkToken, 'Already removed.', true)
    const result = await run(req, person.id, 'unavailability.remove', { id: away.id })
    if (result.status === 'rejected') return back(reply, person.linkToken, result.reason.message, false)
    return back(reply, person.linkToken, 'Removed. You can be offered work on those days again.', true)
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
    })
  })
}
