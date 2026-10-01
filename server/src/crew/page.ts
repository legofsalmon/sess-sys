import { dayLabel, daysLabel, eachDay, euro, noTimesheetReason, timesheetTotal, type CrewCall, type Offer, type Person, type Timesheet, type Unavailability } from '@sh/shared'
import { officeContact, telHref, type OfficeDetails } from '@sh/shared'

/**
 * The freelancer's private page. Plain server-rendered HTML with ordinary
 * forms: it works on any phone, in any in-app browser (WhatsApp, Gmail),
 * with no app, no login and no JavaScript.
 */

const h = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** The message after a post. A refusal is an alert, so it's read out and looks like one; a thank-you is a status. */
export const flash = (f: { ok: boolean; text: string }) => `<p class="flash ${f.ok ? 'ok' : 'bad'}" role="${f.ok ? 'status' : 'alert'}">${h(f.text)}</p>`

/**
 * The way back to the office (audit finding 10), on every page: the phone
 * and email as links a phone taps. Nothing until the office sets them on the
 * Account tab.
 */
export function officeBlock(o: OfficeDetails | null | undefined): string {
  const c = officeContact(o)
  if (!c) return ''
  const parts = [
    h(c.name),
    c.phone && `<a href="${h(telHref(c.phone))}">${h(c.phone)}</a>`,
    c.email && `<a href="mailto:${h(c.email)}">${h(c.email)}</a>`,
  ].filter(Boolean)
  return `<p class="office">${parts.join(' · ')}</p>`
}

export interface PageData {
  person: Person
  jobs: { offer: Offer; call: CrewCall; openDays: string[] }[]
  away: Unavailability[]
  base: string
  /** The read-only calendar feed address (ADR 0012), safe to add to a shared calendar. */
  feed: string
  /** The message after a post, and the offer it's about, when it's about one: it goes in that card. Or the section it's about. */
  flash?: { ok: boolean; text: string; offer?: string; section?: 'details' }
  today: string
  /** Their timesheets (ADR 0022), by booking. */
  timesheets: ReadonlyMap<string, Timesheet>
  /** The office's phone and email, once set. */
  office?: OfficeDetails | null
}

const STATUS_TEXT: Record<Offer['status'], string> = {
  offered: 'Waiting on you',
  countered: 'Rate sent to the office',
  accepted: 'Accepted, the office will confirm',
  confirmed: 'Confirmed',
  declined: 'You declined',
  filled: 'Filled by someone else',
  cancelled: 'Withdrawn',
  'pulled-out': "You've pulled out",
}

/**
 * The way out of a job they said yes to (audit finding 10), folded away so
 * it's never pressed by accident: a note and one button, in a form of its
 * own so the day picker and the rate stay out of it.
 */
function pullOut(d: PageData, action: string) {
  const phone = officeContact(d.office)?.phone
  return `<details class="pull-out"><summary>Can't make it any more?</summary>
      <form method="post" action="${action}">
        <p class="small">Tell us as soon as you can, so we can find cover.${phone ? ` Ringing ${h(phone)} is quickest.` : ''}</p>
        <label>Why, if you like <textarea name="note" rows="2" maxlength="1000"></textarea></label>
        <button class="no" name="answer" value="pullOut">I can't make it</button>
      </form>
    </details>`
}

function facts(call: CrewCall, offer: Offer) {
  const rate = offer.status === 'countered' ? `${euro(offer.counterRateCents)} a day asked (offered ${euro(call.dayRateCents)})` : `${euro(offer.dayRateCents)}${offer.dayRateCents !== null ? ' a day' : ''}`
  return `<dl class="facts">
    <dt>Role</dt><dd>${h(call.role)}</dd>
    <dt>Dates</dt><dd>${h(daysLabel(offer.status === 'offered' ? eachDay(call.start, call.end) : offer.days))}</dd>
    ${call.callTime ? `<dt>Call</dt><dd>${h(call.callTime)}</dd>` : ''}
    ${call.venue ? `<dt>Venue</dt><dd><a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(call.venue)}">${h(call.venue)}</a></dd>` : ''}
    <dt>Rate</dt><dd>${h(rate)}</dd>
    ${call.replyBy && offer.status === 'offered' ? `<dt>Reply by</dt><dd>${h(dayLabel(call.replyBy))}</dd>` : ''}
  </dl>
  ${call.details ? `<p class="details">${h(call.details).replace(/\n/g, '<br>')}</p>` : ''}`
}

function offerCard(d: PageData, job: PageData['jobs'][number]) {
  const { offer, call, openDays } = job
  const days = eachDay(call.start, call.end)
  const action = `${d.base}/offers/${encodeURIComponent(offer.id)}`
  const title = `${h(call.project)}${call.phase ? ` <span>${h(call.phase)}</span>` : ''}`
  // Someone who said yes can still change their days; on a one-day job there is nothing to change.
  const canAnswer = offer.status === 'offered' || offer.status === 'countered' || (offer.status === 'accepted' && days.length > 1)
  // Someone who said yes gives the place back with "Can't make it", not Decline.
  const holding = (offer.status === 'accepted' || offer.status === 'confirmed') && call.status === 'open'
  const dayPicker =
    days.length > 1
      ? `<input type="hidden" name="picker" value="1"><fieldset class="days"><legend>Your days</legend>${days
          .map((day) => {
            const open = openDays.includes(day) || (offer.status === 'accepted' && offer.days.includes(day))
            const checked = offer.status === 'offered' ? open : offer.days.includes(day)
            return `<label class="${open ? '' : 'gone'}"><input type="checkbox" name="days" value="${day}"${checked ? ' checked' : ''}${open ? '' : ' disabled'}> ${h(dayLabel(day))}${open ? '' : ' <small>filled</small>'}</label>`
          })
          .join('')}</fieldset>`
      : ''
  // Enter (or a phone keyboard's Go) in the rate field presses the form's first button. This one, so it's never Accept: the server sends the rate, or asks for a tap.
  // Drawn out of sight rather than hidden: Safari before 16.4 passes over a hidden button and presses the next, which is Accept.
  const onEnter = `<button class="on-enter" name="answer" value="implicit" tabindex="-1" aria-hidden="true"></button>`
  // The page lands on the card after an answer, so the answer's message is in the card, not off the top of the screen.
  return `<article class="offer ${offer.status}" id="o-${h(offer.id)}">
    ${d.flash?.offer === offer.id ? flash(d.flash) : ''}
    <header><h3>${title}</h3><span class="tag ${offer.status}">${STATUS_TEXT[offer.status]}</span></header>
    ${facts(call, offer)}
    ${holding ? `<a class="sheet-link" href="${d.base}/sheet/${encodeURIComponent(call.id)}">Call sheet: who's on, where, and who to ring ›</a>` : ''}
    ${
      canAnswer
        ? `<form method="post" action="${action}">
      ${onEnter}
      ${dayPicker}
      <div class="buttons${holding ? ' one' : ''}">
        <button class="yes" name="answer" value="accept">${offer.status === 'accepted' ? 'Update my days' : days.length > 1 ? 'Accept these days' : 'Accept'}</button>
        ${holding ? '' : '<button class="no" name="answer" value="decline">Decline</button>'}
      </div>
      <details${offer.status === 'countered' ? ' open' : ''}><summary>Ask for a different rate or add a note</summary>
        <label>Day rate you'd do it for (€) <input name="rate" inputmode="decimal" pattern="[0-9]+([.,][0-9]{1,2})?" value="${offer.counterRateCents !== null ? (offer.counterRateCents / 100).toString() : ''}"></label>
        <label>Note for the office <textarea name="note" rows="2" maxlength="1000">${h(offer.note)}</textarea></label>
        <button name="answer" value="counter">Send rate</button>
      </details>
    </form>`
        : ''
    }
    ${holding ? pullOut(d, action) : ''}
  </article>`
}

/** How long an approved timesheet stays on the page. */
const APPROVED_SHOWN_DAYS = 60

/** Bookings whose timesheet is to send, sent, or lately approved: to send first. */
function timesheets(d: PageData): string {
  const since = new Date(Date.now() - APPROVED_SHOWN_DAYS * 86_400_000).toISOString()
  const rows = d.jobs
    .map((j) => ({ ...j, t: d.timesheets.get(j.offer.id) }))
    .filter((j) => (j.t ? j.t.status !== 'approved' || (j.t.approvedAt ?? '') >= since : noTimesheetReason(j.offer, j.call, d.person, d.today) === null))
    .sort((a, b) => rank(a.t) - rank(b.t) || a.call.start.localeCompare(b.call.start))
  if (!rows.length) return ''
  return `<section><h2>Timesheets</h2><ul class="ts-list">${rows
    .map(({ offer, call, t }) => {
      const state = !t ? 'to-send' : t.status
      const text = !t
        ? 'Send your days and extras ›'
        : t.status === 'sent'
          ? `Sent: ${euro(timesheetTotal(t).total)}. The office will check it ›`
          : `Approved: ${euro(timesheetTotal(t).total)} ›`
      return `<li><a class="${state}" href="${d.base}/timesheet/${encodeURIComponent(offer.id)}"><b>${h(call.project)}${call.phase ? ` <span>${h(call.phase)}</span>` : ''}</b><small>${h(call.role)} · ${h(daysLabel(offer.days))}</small><span>${h(text)}</span></a></li>`
    })
    .join('')}</ul></section>`
}
const rank = (t: Timesheet | undefined) => (!t ? 0 : t.status === 'sent' ? 1 : 2)

/**
 * Their own email and phone, to fix themselves (audit finding 7). Folded
 * away until wanted, and open with the message after they save.
 */
function details(d: PageData): string {
  const mine = d.flash?.section === 'details'
  return `<section class="me">
    <details id="details"${mine ? ' open' : ''}>
      <summary><h2>Your details</h2></summary>
      ${mine && d.flash ? flash(d.flash) : ''}
      <form method="post" action="${d.base}/details">
        <p class="small">You're down as <b>${h(d.person.name)}</b>. Ask the office to change your name; your number and email you can fix here.</p>
        <label>Mobile <input type="tel" name="phone" value="${h(d.person.phone ?? '')}" maxlength="40" placeholder="+353 87 123 4567" autocomplete="tel"></label>
        <label>Email <input type="email" name="email" value="${h(d.person.email ?? '')}" maxlength="200" autocomplete="email"></label>
        <p class="small">Write your mobile with the country code, +353 for Ireland, so WhatsApp messages and texts reach you.</p>
        <button>Save</button>
      </form>
    </details>
  </section>`
}

export function renderPage(d: PageData): string {
  const current = d.jobs.filter((j) => j.call.end >= d.today && j.call.status === 'open')
  const waiting = current.filter((j) => j.offer.status === 'offered' || j.offer.status === 'countered')
  const booked = current.filter((j) => j.offer.status === 'accepted' || j.offer.status === 'confirmed')
  const closed = d.jobs.filter((j) => !waiting.includes(j) && !booked.includes(j)).slice(-8).reverse()
  const first = d.person.name.split(' ')[0]
  // A message about an offer sits in that offer's card, one about their details in that section; any other at the top.
  const inCard = [...waiting, ...booked].some((j) => j.offer.id === d.flash?.offer) || d.flash?.section === 'details'

  return `<!doctype html>
<html lang="en-IE">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<meta name="theme-color" content="#ee3744">
<title>Session Hire: your work</title>
<style>${CSS}</style>
</head>
<body>
<main>
  <header class="top"><span class="mark">SH</span><div><b>Session Hire</b><small>Hi ${h(first)}. This page is just for you.</small></div></header>
  ${officeBlock(d.office)}
  ${d.flash && !inCard ? flash(d.flash) : ''}

  <section>
    <h2>Offers waiting on you</h2>
    ${waiting.length ? waiting.map((j) => offerCard(d, j)).join('') : '<p class="empty">Nothing waiting right now.</p>'}
  </section>

  ${timesheets(d)}

  <section>
    <h2>Your bookings</h2>
    ${booked.length ? booked.map((j) => offerCard(d, j)).join('') : '<p class="empty">No upcoming bookings.</p>'}
    <p class="small">Your bookings in your own calendar: <a href="${h(d.feed.replace(/^https?:/, 'webcal:'))}">subscribe</a> (iPhone, Mac, Outlook), or in Google Calendar add <code>${h(d.feed)}</code> under “From URL”. It only shows your bookings, so it's fine in a calendar you share. If our Google Calendar invites already reach you, you don't need it as well.</p>
  </section>

  <section>
    <h2>Days you can't work</h2>
    ${
      d.away.length
        ? `<ul class="away">${d.away
            .filter((u) => u.end >= d.today)
            .map(
              (u) => `<li><span>${h(daysLabel(eachDay(u.start, u.end)))}${u.note ? ` <small>${h(u.note)}</small>` : ''}</span>
          <form method="post" action="${d.base}/away/${encodeURIComponent(u.id)}/remove"><button>Remove</button></form></li>`
            )
            .join('')}</ul>`
        : ''
    }
    <form method="post" action="${d.base}/away" class="add-away">
      <label>From <input type="date" name="start" required min="${d.today}"></label>
      <label>To <input type="date" name="end" min="${d.today}"></label>
      <label class="wide">Note (optional) <input name="note" maxlength="500" placeholder="e.g. on tour"></label>
      <button>Add days off</button>
    </form>
  </section>

  ${details(d)}

  ${
    closed.length
      ? `<section><h2>Earlier</h2><ul class="closed">${closed
          .map((j) => `<li>${h(j.call.project)} · ${h(j.call.role)} · ${h(daysLabel(eachDay(j.call.start, j.call.end)))} <small>${STATUS_TEXT[j.offer.status]}</small></li>`)
          .join('')}</ul></section>`
      : ''
  }

  <footer>
    <a href="${d.base}/data.json">Download everything we hold on you</a>
    <span>Keep this link to yourself: anyone with it can answer for you. Ask the office for a new one if it gets shared.</span>
  </footer>
</main>
</body>
</html>`
}

export function renderGone(): string {
  return `<!doctype html><html lang="en-IE"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Session Hire</title><style>${CSS}</style></head>
<body><main><header class="top"><span class="mark">SH</span><div><b>Session Hire</b></div></header>
<p class="flash bad">This link doesn't work any more. Ask the office to send you a new one.</p></main></body></html>`
}

export const CSS = `
:root{--bg:#f4f5f7;--panel:#fff;--ink:#16202b;--muted:#5a6776;--line:#d9dee5;--accent:#ee3744;--accent-fill:#c8202e;--good:#1d7a4c;--good-soft:#dff2e8;--warn:#8a5800;--warn-soft:#fbefd6;--bad:#a8480f;--bad-soft:#f9e4d6;color-scheme:light;font:16px/1.5 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
@media (prefers-color-scheme:dark){:root{--bg:#0f151c;--panel:#17202a;--ink:#e6ecf2;--muted:#9aa8b7;--line:#2b3745;--good:#5fd09a;--good-soft:#15352a;--warn:#f0b85a;--warn-soft:#3a2c12;--bad:#f0a064;--bad-soft:#3a2414;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink)}
main{max-width:560px;margin:0 auto;padding:max(14px,env(safe-area-inset-top)) 16px 48px;display:grid;gap:18px}
a{color:inherit;text-decoration-color:var(--accent);text-underline-offset:2px}
.top{display:flex;gap:12px;align-items:center}.top b{display:block;text-transform:uppercase;letter-spacing:.03em}.top small{color:var(--muted)}
.mark{width:40px;height:40px;border-radius:9px;background:var(--accent);color:#fff;display:grid;place-items:center;font-weight:800;flex:none}
h2{font-size:.85rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:0 0 8px}
section{display:grid;gap:10px}
.offer{background:var(--panel);border:1px solid var(--line);border-left:4px solid var(--line);border-radius:12px;padding:14px;display:grid;gap:10px}
.offer.offered{border-left-color:var(--accent)}.offer.confirmed{border-left-color:var(--good)}.offer.accepted,.offer.countered{border-left-color:var(--warn)}
.office{margin:0;font-size:.92rem;color:var(--muted)}.office a{font-weight:600;white-space:nowrap}
.pull-out summary{color:var(--bad)}.pull-out[open]{display:grid;gap:8px}.tag.pulled-out{background:var(--bad-soft);color:var(--bad)}
.buttons.one{grid-template-columns:1fr}
.offer header{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap}
h3{margin:0;font-size:1.1rem}h3 span{font-weight:500;color:var(--muted)}
.tag{font-size:.75rem;font-weight:700;padding:3px 9px;border-radius:999px;background:var(--line);white-space:nowrap}
.tag.offered{background:var(--accent-fill);color:#fff}.tag.confirmed{background:var(--good-soft);color:var(--good)}.tag.accepted,.tag.countered{background:var(--warn-soft);color:var(--warn)}
.facts{display:grid;grid-template-columns:auto 1fr;gap:2px 14px;margin:0}.facts dt{color:var(--muted)}.facts dd{margin:0}
.details{margin:0;padding:10px;background:var(--bg);border-radius:8px;font-size:.92rem}
form{display:grid;gap:10px;margin:0}
fieldset.days{border:0;padding:0;margin:0;display:flex;flex-wrap:wrap;gap:6px}fieldset.days legend{font-size:.85rem;color:var(--muted);margin-bottom:4px}
fieldset.days label{display:flex;gap:6px;align-items:center;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg)}
fieldset.days label.gone{opacity:.55}fieldset.days input{width:20px;height:20px;accent-color:var(--accent)}
.buttons{display:grid;grid-template-columns:1fr 1fr;gap:8px}
button{font:600 1rem system-ui,sans-serif;padding:12px 14px;border-radius:10px;border:1px solid var(--line);background:var(--panel);color:var(--ink);cursor:pointer;min-height:48px}
.on-enter{position:absolute;width:1px;height:1px;min-height:0;margin:-1px;padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap}
button.yes{background:var(--accent-fill);border-color:var(--accent-fill);color:#fff}
details{border-top:1px solid var(--line);padding-top:8px}summary{cursor:pointer;color:var(--muted);font-size:.92rem;padding:6px 0}
details[open]{display:grid;gap:8px}
label{display:grid;gap:4px;font-size:.9rem}input,textarea{font:inherit;padding:10px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--ink);min-width:0;width:100%}
fieldset.days input{width:20px}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.flash{margin:0;padding:12px 14px;border-radius:10px;font-weight:600}.flash.ok{background:var(--good-soft);color:var(--good)}.flash.bad{background:var(--bad-soft);color:var(--bad)}.flash.warn{background:var(--warn-soft);color:var(--warn)}
.empty,.small{color:var(--muted);margin:0;font-size:.92rem}code{word-break:break-all;font-size:.8rem}
.away,.closed{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.away li{display:flex;justify-content:space-between;align-items:center;gap:10px;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:6px 6px 6px 12px}
.away li button{min-height:44px;padding:6px 10px;font-size:.85rem}.away small,.closed small{color:var(--muted);display:block}
.closed li{font-size:.92rem}
.add-away{grid-template-columns:1fr 1fr;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px}.add-away .wide,.add-away button{grid-column:1/-1}
footer{display:grid;gap:6px;font-size:.85rem;color:var(--muted);border-top:1px solid var(--line);padding-top:14px}
.sheet-link{font-weight:600;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg);text-decoration:none}
.me details{border:1px solid var(--line);border-radius:12px;background:var(--panel);padding:4px 14px}.me details[open]{padding-bottom:14px}
.me summary{padding:10px 0;list-style-position:inside}.me summary h2{display:inline;margin:0}.me form{margin-top:4px}
.ts-list{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.ts-list a{display:grid;gap:2px;padding:12px 14px;border:1px solid var(--line);border-left:4px solid var(--line);border-radius:12px;background:var(--panel);text-decoration:none}
.ts-list a.to-send{border-left-color:var(--accent)}.ts-list a.sent{border-left-color:var(--warn)}.ts-list a.approved{border-left-color:var(--good)}
.ts-list small{color:var(--muted)}.ts-list b span{font-weight:500;color:var(--muted)}.ts-list a>span{font-weight:600}
`
