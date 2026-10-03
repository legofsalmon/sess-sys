import { CERTIFICATE_SOON_DAYS, dayLabel, daysBetween, DOCUMENT_KIND_LABELS, DOCUMENT_KINDS, documentRunsOut, fileLabel, FILE_TYPES, type Document, type Person } from '@sh/shared'
import { CSS, flash, h, type Flash } from '../crew/page.ts'

/**
 * "Your documents" on a freelancer's private link (ADR 0029): what the
 * office holds for them, each file to view, and plain forms to send a new
 * one or a renewal, which the office checks before it counts. No script:
 * a form with a file posts as multipart, and every value drawn goes
 * through the page's escaper.
 */

export interface LinkDocuments {
  person: Pick<Person, 'certificates'>
  list: readonly Document[]
  /** Whether the server can keep files; without, the page says to send them another way for now. */
  files: boolean
  base: string
  today: string
  flash?: Flash
}

/** What the file field takes: the types by name too, for phones that pick by them. */
const ACCEPT = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', ...Object.values(FILE_TYPES).map((t) => `.${t.ext}`), '.jpeg'].join(',')

const fullDay = (d: string) => `${dayLabel(d)} ${d.slice(0, 4)}`

function fileFields(action: string, inner: string): string {
  return `<form method="post" action="${h(action)}" enctype="multipart/form-data" class="add-away">
      ${inner}
      <label class="wide">The file <input type="file" name="file" accept="${ACCEPT}" required></label>
      <p class="small wide">A PDF, or a photo of it (JPEG, PNG, WebP or HEIC), up to 10 MB. Sending it needs signal, and the office checks it.</p>
      <button class="yes">Send to the office</button>
    </form>`
}

function card(d: LinkDocuments, doc: Document): string {
  // A renewal turned down opens again under its card, with the message above.
  const reopen = d.flash?.section === 'documents' && !d.flash.ok && d.flash.offer === doc.id
  const runsOut = documentRunsOut(doc, d.person)
  const waiting = !doc.checkedAt
  const ran = runsOut !== null && runsOut < d.today
  const soon = runsOut !== null && !ran && daysBetween(d.today, runsOut) <= CERTIFICATE_SOON_DAYS
  const [tag, tone] = waiting ? ['With the office to check', 'accepted'] : ran ? ['Ran out', 'pulled-out'] : soon ? ['Runs out soon', 'accepted'] : ['', '']
  const when = runsOut === null ? 'No expiry' : `${ran ? 'Ran' : 'Runs'} out on ${fullDay(runsOut)}`
  return `<article class="offer doc" id="doc-${h(doc.id)}">
    <header><h3>${h(doc.title)}</h3>${tag ? `<span class="tag ${tone}">${h(tag)}</span>` : ''}</header>
    <p class="small">${h([when, doc.file && fileLabel(doc.file)].filter(Boolean).join(' · '))}</p>
    ${doc.file ? `<a class="sheet-link" href="${h(`${d.base}/documents/${encodeURIComponent(doc.id)}`)}">View the file ›</a>` : ''}
    ${
      d.files && !waiting
        ? `<details${reopen ? ' open' : ''}><summary>Send a new one</summary>
      ${fileFields(`${d.base}/documents`, `<input type="hidden" name="renews" value="${h(doc.id)}">
      <label class="wide">The new one runs out <input type="date" name="expires" min="${h(d.today)}"></label>`)}
    </details>`
        : ''
    }
  </article>`
}

export function documentsSection(d: LinkDocuments): string {
  const mine = d.flash?.section === 'documents' ? d.flash : undefined
  const send = d.files
    ? `<details class="send-doc"${mine && !mine.ok && !mine.offer ? ' open' : ''}><summary>${d.list.length ? 'Send something else' : 'Send a document'}</summary>
      ${fileFields(
        `${d.base}/documents`,
        `<label class="wide">What is it <select name="kind">${DOCUMENT_KINDS.map((k) => `<option value="${h(k)}">${h(DOCUMENT_KIND_LABELS[k])}</option>`).join('')}</select></label>
      <label class="wide">What it's called, if you like <input name="title" maxlength="100" placeholder="e.g. Public liability insurance"></label>
      <label class="wide">Runs out <input type="date" name="expires"></label>`
      )}
    </details>`
    : `<p class="small">Sending documents here isn't switched on yet. For now, send a photo or a PDF of it to the office by WhatsApp or email.</p>`
  return `<section id="documents">
    <h2>Your documents</h2>
    ${mine ? flash(mine) : ''}
    ${d.list.length ? d.list.map((doc) => card(d, doc)).join('') : '<p class="empty">None yet. Your insurance and certificate cards go here once the office has them.</p>'}
    ${send}
  </section>`
}

/** A file that can't be shown, in words, with the way back to their page. */
export function renderNoFile(base: string, text: string): string {
  return `<!doctype html><html lang="en-IE"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Session Hire</title><style>${CSS}</style></head>
<body><main><header class="top"><span class="mark">SH</span><div><b>Session Hire</b></div></header>
<p class="flash bad">${h(text)}</p><a class="sheet-link" href="${h(base)}#documents">‹ Back to your page</a></main></body></html>`
}
