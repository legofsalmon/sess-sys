import type { FastifyInstance, FastifyRequest } from 'fastify'
import { describeDevice } from '../devices.ts'
import { Refused } from '../kernel.ts'
import type { OwnCalendars } from './own-calendars.ts'

/**
 * The office adds a freelancer's own calendar from their page (ADR 0044),
 * with the address the freelancer sent it, and reads one again now. Both
 * need signal, since the server reads the calendar there and then, and
 * the right to change crew (ADR 0034). Stopping is a command like any
 * other, so it works offline. The address comes in the request's body,
 * which the server's log never writes down.
 */

type Req = FastifyRequest<{ Params: { personId: string }; Querystring: { client?: string }; Body: { address?: unknown } | undefined }>

const deviceCode = (client: unknown) => (typeof client === 'string' && /^[a-z0-9]{1,64}$/.test(client) ? client : undefined)

export function registerOwnCalendarRoutes(app: FastifyInstance, { ownCalendars }: { ownCalendars: OwnCalendars }) {
  app.post('/api/own-calendars/:personId', { config: { needs: 'crew' } }, async (req: Req, reply) => {
    reply.header('cache-control', 'no-store')
    const address = typeof req.body?.address === 'string' ? req.body.address : ''
    try {
      const calendar = await ownCalendars.share({
        personId: req.params.personId,
        address,
        by: 'office',
        who: { clientId: deviceCode(req.query.client), userId: req.user?.id, device: describeDevice(req.headers['user-agent']) },
      })
      return { ok: true, calendar }
    } catch (err) {
      if (err instanceof Refused) return reply.code(err.reason.code === 'not-found' ? 404 : 422).send({ error: err.reason.message })
      throw err
    }
  })

  app.post('/api/own-calendars/:personId/read', { config: { needs: 'crew' } }, async (req: Req, reply) => {
    reply.header('cache-control', 'no-store')
    const calendar = await ownCalendars.readNow(req.params.personId)
    if (!calendar) return reply.code(404).send({ error: "Their calendar isn't shared any more." })
    return { ok: true, calendar }
  })
}
