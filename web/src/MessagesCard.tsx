import type { OfficeView } from '@sh/shared'
import { Refusal, useAct } from './act.tsx'
import { Pending } from './StatusPill.tsx'
import { client } from './sync.ts'

/**
 * Messages to crew (ADR 0048), for the office. Offer, Send, Tell and Ask
 * each open a WhatsApp, text or email to a real person with the words
 * filled in, and the app itself never sends anything. Off is the default:
 * a company whose crew and jobs came in from a calendar tidies the lists
 * first, and a mis-tap in the meantime messages nobody. Turning them on is
 * the choice that's made, once the office is ready.
 */
export function MessagesCard({ office }: { office: OfficeView }) {
  const { run, error } = useAct()
  const on = office.promptMessages
  return (
    <section className="card" aria-label="Messages to crew">
      <h2>
        Messages to crew <Pending pending={office.messagesPending} />
      </h2>
      <p>
        Offers, call sheets, timesheet requests and the word after a change each open a WhatsApp, text or email to the person, written out, for
        someone here to send. The app sends nothing itself. Until this is on, nothing opens: offers and changes still reach their private links, and
        the office tidies the lists without a mis-tap messaging anyone.
      </p>
      <label className="signal">
        <input type="checkbox" role="switch" checked={on} onChange={(e) => void run(() => client.mutate('messages.prompt', { on: e.target.checked }))} />
        <span>
          <b>Prompt messages to crew</b>
          <small>{on ? 'Offer, Send, Tell and Ask open the message, ready to send.' : 'Off: nothing opens, and whoever makes an offer is told so there and then.'}</small>
        </span>
      </label>
      <Refusal error={error} />
    </section>
  )
}
