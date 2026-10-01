import { dayLabel, daysLabel, euro, MAX_EXTRAS, timesheetChanges, timesheetTotal, type CrewCall, type Offer, type Timesheet } from '@sh/shared'
import { CSS, flash } from './page.ts'
import { SHEET_CSS } from './sheet.ts'

/**
 * A booking's timesheet on a freelancer's private link,
 * /f/<token>/timesheet/<booking> (ADR 0022): the days they worked, ticked
 * from their booked days, and their extras, sent to the office with an
 * ordinary form. Once approved it shows what the office agreed, and what it
 * changed from what was sent.
 */

const h = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const lines = (s: string) => h(s).replace(/\n/g, '<br>')
const euroInput = (c: number) => (c / 100).toFixed(c % 100 === 0 ? 0 : 2)
/** "Wed 30 Sep", in Ireland. */
const on = (iso: string) => dayLabel(new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Dublin' }))

export interface TimesheetPage {
  offer: Offer
  call: CrewCall
  timesheet: Timesheet | undefined
  /** Why there's no timesheet to send, when there isn't. */
  why: string | null
  base: string
  flash?: { ok: boolean; text: string }
}

export function renderTimesheet(d: TimesheetPage): string {
  const { offer, call, timesheet: t } = d
  const action = `${d.base}/timesheet/${encodeURIComponent(offer.id)}`
  const rate = t?.dayRateCents ?? offer.dayRateCents
  return `<!doctype html>
<html lang="en-IE">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<meta name="theme-color" content="#ee3744">
<title>Timesheet: ${h(call.project)}${call.phase ? `, ${h(call.phase)}` : ''}</title>
<style>${CSS}${SHEET_CSS}${TIMESHEET_CSS}</style>
</head>
<body>
<main class="sheet">
  <header class="top"><span class="mark">SH</span><div><b>Session Hire</b><small>Timesheet</small></div></header>
  <a class="back" href="${h(d.base)}">‹ Your work</a>
  ${d.flash ? flash(d.flash) : ''}
  <section class="head">
    <h1>${h(call.project)}${call.phase ? ` <span>${h(call.phase)}</span>` : ''}</h1>
    <p class="when">${h(call.role)}, ${h(daysLabel(offer.days))}</p>
    <p class="small">${rate === null ? 'Day rate to agree with the office.' : `${h(euro(rate))} a day${t && t.dayRateCents !== offer.dayRateCents ? '' : ', as agreed'}.`}</p>
  </section>
  ${!t && d.why ? `<p class="flash warn">${h(d.why)}</p>` : t?.status === 'approved' ? approved(t) : form(d, action)}
  <footer>
    <span>Keep this link to yourself: anyone with it can answer for you.</span>
  </footer>
</main>
</body>
</html>`
}

function approved(t: Timesheet): string {
  const changes = timesheetChanges(t)
  const { fees, total } = timesheetTotal(t)
  const n = t.days.length
  return `<section class="you"><h2>Approved: ${h(euro(total))}</h2>
    <ul class="extras-list">
      <li>${n} day${n === 1 ? '' : 's'} at ${h(euro(t.dayRateCents))}, ${h(daysLabel(t.days))} <span>${h(euro(fees))}</span></li>
      ${t.extras.map((e) => `<li>${h(e.what)} <span>${h(euro(e.cents))}</span></li>`).join('')}
    </ul>
    ${changes.length ? `<p>The office changed what you sent:</p><ul class="changes">${changes.map((c) => `<li>${h(c)}</li>`).join('')}</ul>` : ''}
    ${t.officeNote ? `<p class="details">${lines(t.officeNote)}</p>` : ''}
    <p class="small">Approved on ${h(on(t.approvedAt ?? t.sentAt))}. If something's wrong, ask the office to reopen it.</p>
  </section>`
}

function form(d: TimesheetPage, action: string): string {
  const t = d.timesheet
  const ticked = new Set(t?.days ?? d.offer.days)
  const extras = t?.extras ?? []
  const blanks = Math.max(0, Math.min(MAX_EXTRAS, Math.max(3, extras.length + 1)) - extras.length)
  const rows = [...extras.map((e) => ({ what: e.what, euro: euroInput(e.cents) })), ...Array.from({ length: blanks }, () => ({ what: '', euro: '' }))]
  return `${
    t
      ? `<p class="flash ok">Sent to the office on ${h(on(t.sentAt))}: ${h(euro(timesheetTotal(t).total))} in all. They'll check it; you can change it until they approve it.</p>`
      : ''
  }
  <form method="post" action="${action}" class="timesheet">
    <input type="hidden" name="picker" value="1">
    <fieldset class="days"><legend>Days you worked</legend>${[...d.offer.days]
      .sort()
      .map((day) => `<label><input type="checkbox" name="days" value="${day}"${ticked.has(day) ? ' checked' : ''}> ${h(dayLabel(day))}</label>`)
      .join('')}</fieldset>
    <fieldset class="extras"><legend>Extras</legend>
      <p class="small">Parking, tolls, mileage, or anything else the office agreed. Keep the receipts. Leave a row empty if you don't need it.</p>
      ${rows
        .map(
          (r, i) =>
            `<div class="extra"><label><span>What</span> <input name="what" maxlength="100" value="${h(r.what)}"${i === 0 && !r.what ? ' placeholder="e.g. Parking"' : ''}></label><label><span>€</span> <input name="euro" inputmode="decimal" pattern="[0-9]+([.,][0-9]{1,2})?" value="${h(r.euro)}"></label></div>`
        )
        .join('')}
    </fieldset>
    <label>Note for the office (optional) <textarea name="note" rows="2" maxlength="1000">${h(t?.note ?? '')}</textarea></label>
    <button class="yes">${t ? 'Update what you sent' : 'Send to the office'}</button>
  </form>`
}

const TIMESHEET_CSS = `
.timesheet .extra{display:grid;grid-template-columns:1fr 7.5em;gap:8px}
.timesheet .extra+.extra label span{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
fieldset.extras{border:0;padding:0;margin:0;display:grid;gap:8px}fieldset.extras legend{font-size:.85rem;color:var(--muted);margin-bottom:4px}
.extras-list,.changes{margin:0;padding-left:1.1em;display:grid;gap:2px}.extras-list span{color:var(--muted);white-space:nowrap}
`
