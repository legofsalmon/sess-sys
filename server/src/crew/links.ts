import { eachDay, feedCodeFor, feedPath, newId, type CommandArgs, type CommandName, type MutationResult } from '@sh/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { applyMutation } from '../commands.ts'
import type { Db } from '../db.ts'
import { describeDevice } from '../devices.ts'
import { publicOrigin } from '../http.ts'
import { sendFeed, type Feeds } from './feeds.ts'
import { renderGone, renderPage } from './page.ts'
import { awayFor, getAway, getOffer, offersFor, offersForCall, personByToken } from './store.ts'

/**
 * A freelancer's private link, /f/<token>: their page, the answers they
 * post from it, their calendar feed and their data. The token is the only
 * credential, so every action checks the thing it touches belongs to the
 * link's person. Answers go through the same command handlers as the app,
 * so the same rules (first to accept, no double booking) hold.
 *
 * The calendar feed also has a read-only address of its own,
 * /cal/<code>.ics, safe to add to a shared calendar (ADR 0012).
 */

type Form = URLSearchParams
type Req = FastifyRequest<{ Params: { token: string; id?: string }; Querystring: { m?: string; ok?: string } }>

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

  /** After a post, back to the page with a message, so a refresh never resubmits. */
  const back = (reply: FastifyReply, token: string, text: string, ok: boolean, anchor = '') =>
    reply.redirect(`/f/${token}?${new URLSearchParams({ m: text, ok: ok ? '1' : '0' })}${anchor}`, 303)

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
    const flash = req.query.m ? { ok: req.query.ok === '1', text: req.query.m.slice(0, 300) } : undefined
    const feed = `${publicOrigin(req)}${feedPath(await feedCodeFor(person.linkToken))}`
    return reply
      .type('text/html')
      .send(renderPage({ person, jobs, away: await awayFor(db, person.id), base: base(req, person.linkToken), feed, flash, today: today() }))
  })

  app.post('/f/:token/offers/:id', async (req: Req, reply) => {
    const person = await personByToken(db, req.params.token)
    if (!person) return reply.code(404).type('text/html').send(renderGone())
    const offer = await getOffer(db, req.params.id!)
    if (!offer || offer.personId !== person.id) return back(reply, person.linkToken, "That offer isn't one of yours.", false)
    const form = (req.body ?? new URLSearchParams()) as Form
    const answer = form.get('answer')
    const note = (form.get('note') ?? '').slice(0, 1000)
    const picked = form.getAll('days')
    if (form.get('picker') && picked.length === 0 && answer !== 'decline')
      return back(reply, person.linkToken, 'Tick at least one day, or press Decline.', false, `#o-${offer.id}`)
    const days = picked.length ? picked : null

    let result: MutationResult
    if (answer === 'accept') result = await run(req, person.id, 'offer.respond', { id: offer.id, answer: 'accept', days, note })
    else if (answer === 'decline') result = await run(req, person.id, 'offer.respond', { id: offer.id, answer: 'decline', note })
    else if (answer === 'counter') {
      const euros = Number((form.get('rate') ?? '').replace(',', '.'))
      if (!Number.isFinite(euros) || euros <= 0) return back(reply, person.linkToken, 'Put in the day rate you would do it for.', false, `#o-${offer.id}`)
      result = await run(req, person.id, 'offer.respond', { id: offer.id, answer: 'counter', counterRateCents: Math.round(euros * 100), days, note })
    } else return back(reply, person.linkToken, 'Something went wrong; please try again.', false)

    if (result.status === 'rejected') return back(reply, person.linkToken, result.reason.message, false, `#o-${offer.id}`)
    const text =
      answer === 'accept'
        ? "Thanks, you're down for it. The office will confirm."
        : answer === 'decline'
          ? "Thanks for letting us know. You're off this one."
          : 'Thanks, your rate has gone to the office.'
    return back(reply, person.linkToken, text, true, `#o-${offer.id}`)
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
    await run(req, person.id, 'unavailability.remove', { id: away.id })
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
    })
  })
}
