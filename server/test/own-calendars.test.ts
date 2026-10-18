import { addDays, ADDRESS_WORDS, BUSY_AHEAD_DAYS, busyByDay, irishToday, redact, type HistoryPage, type OwnCalendar } from '@sh/shared'
import { afterEach, describe, expect, it } from 'vitest'
import { dublinWallTime, NotACalendar, readBusy, readBusyApart, TooMuch } from '../src/crew/busy.ts'
import { fetchCalendar, isPublic, NotRead, READ_WORDS } from '../src/crew/calendar-fetch.ts'
import { calendarFeed } from '../src/crew/ical.ts'
import { NOT_A_CALENDAR, TOO_MUCH, type OwnCalendarsOptions } from '../src/crew/own-calendars.ts'
import { everythingJson, readEverything } from '../src/export.ts'
import { fakeCalendar, ics, type FakeCalendar } from './fake-calendar.ts'
import { ANDROID, flashOf, IPHONE, server, staff } from './people.ts'

/**
 * Freelancers' own calendars, read only (ADR 0044): what a calendar's
 * text says about when someone is busy and nothing more; reading an
 * address someone pasted without letting it reach anything private to
 * the server; sharing from the private link and from the person's page,
 * reading again, stopping in one tap; and the address kept as a secret,
 * out of devices, the history, Download everything and error reports.
 * Calendars come from a stand-in on this machine, never the network.
 */

const TODAY = irishToday()
const day = (n: number) => addDays(TODAY, n)

let calendars: FakeCalendar[] = []
afterEach(async () => {
  for (const c of calendars.splice(0)) await c.close()
})
async function host() {
  const c = await fakeCalendar()
  calendars.push(c)
  return c
}

describe('reading busy times from a calendar', () => {
  it('keeps only when, for timed and all-day events, in Irish time', () => {
    const got = readBusy(
      ics([
        { uid: 'a@google.com', start: `${day(2)}T09:00`, end: `${day(2)}T17:30`, summary: 'Dentist', location: 'Rathmines', description: 'Bring the card', attendees: ['partner@example.com'] },
        { uid: 'b@google.com', start: day(5), end: day(7), summary: 'Gig with someone else' },
      ]),
      TODAY
    )
    if (got.ours) throw new Error('not ours')
    expect(got.until).toBe(day(BUSY_AHEAD_DAYS))
    expect(got.busy).toEqual([
      { start: new Date(dublinWallTime(...ymd(day(2)), 9, 0, 0)).toISOString(), end: new Date(dublinWallTime(...ymd(day(2)), 17, 30, 0)).toISOString(), allDay: false },
      // An all-day event's end is the day after its last.
      { start: day(5), end: day(6), allDay: true },
    ])
    // Nothing else of the event is kept: no title, place, notes or guests.
    const kept = JSON.stringify(got)
    for (const word of ['Dentist', 'Rathmines', 'card', 'partner', 'Gig', 'google.com']) expect(kept).not.toContain(word)
    expect([...busyByDay({ busy: got.busy })]).toEqual([
      [day(2), '09:00 to 17:30'],
      [day(5), 'all day'],
      [day(6), 'all day'],
    ])
  })

  it('works out repeating events, with a day taken out and one moved, up to four months ahead', () => {
    const got = readBusy(
      ics([
        { uid: 'weekly@google.com', start: `${day(1)}T19:00`, end: `${day(1)}T22:00`, rrule: 'FREQ=WEEKLY', exdate: `${day(8)}T19:00` },
        // The third week's was moved to the next morning.
        { uid: 'weekly@google.com', start: `${day(16)}T10:00`, end: `${day(16)}T12:00`, recurrenceId: `${day(15)}T19:00` },
        // Every day since years back: worked through without holding anything up.
        { uid: 'daily@google.com', start: '2019-01-01', end: '2019-01-02', rrule: 'FREQ=DAILY;INTERVAL=30' },
      ]),
      TODAY
    )
    if (got.ours) throw new Error('not ours')
    const days = busyByDay({ busy: got.busy.filter((b) => !b.allDay) })
    expect(days.get(day(1))).toBe('19:00 to 22:00')
    expect(days.has(day(8))).toBe(false)
    expect(days.has(day(15))).toBe(false)
    expect(days.get(day(16))).toBe('10:00 to 12:00')
    expect(days.get(day(22))).toBe('19:00 to 22:00')
    // Nothing past the four months, and nothing from long ago.
    expect(got.busy.every((b) => (b.allDay ? b.start : b.start.slice(0, 10)) <= day(BUSY_AHEAD_DAYS + 1))).toBe(true)
    expect(got.busy.every((b) => (b.allDay ? b.end : b.end.slice(0, 10)) >= day(-2))).toBe(true)
    expect(got.busy.some((b) => b.allDay)).toBe(true)
  })

  it("leaves out what doesn't make them busy, and our own bookings from their Session Hire feed", () => {
    const ours = calendarFeed(
      { id: 'p1', name: 'Aoife Byrne', kind: 'freelancer', email: null, phone: null, skills: [], dayRateCents: 30000, notes: '', linkToken: 'x', archived: false, approvesLeave: false, department: null, level: 1, knownAs: null, certificates: {}, company: null, role: null },
      [
        {
          offer: { id: 'o1', callId: 'c1', personId: 'p1', status: 'confirmed', days: [day(3)], dayRateCents: 30000, counterRateCents: null, note: '', respondedAt: null, respondedVia: null, override: false, seenAt: null },
          call: { id: 'c1', projectId: null, phaseId: null, project: 'Autumn Gala', phase: '', venue: '', role: 'Audio', start: day(3), end: day(3), callTime: null, needed: 1, dayRateCents: 30000, details: '', replyBy: null, status: 'open' },
        },
      ]
    )
    // Subscribed to whole: the calendar is ours, and says so.
    expect(readBusy(ours, TODAY)).toEqual({ ours: true })
    // Copied into their own calendar, our events keep their ids.
    const uid = /UID:(.*)\r\n/.exec(ours)![1]!
    const got = readBusy(
      ics([
        { uid, start: day(3), end: day(4), summary: 'Autumn Gala' },
        { uid: 'free@google.com', start: `${day(4)}T09:00`, end: `${day(4)}T10:00`, transp: 'TRANSPARENT' },
        { uid: 'off@google.com', start: `${day(4)}T11:00`, end: `${day(4)}T12:00`, status: 'CANCELLED' },
        // Google marks all-day events free unless told otherwise; a whole gig goes in as one, so it counts.
        { uid: 'tour@google.com', start: day(9), end: day(10), transp: 'TRANSPARENT' },
      ]),
      TODAY
    )
    expect(got).toEqual({ ours: false, busy: [{ start: day(9), end: day(9), allDay: true }], until: day(BUSY_AHEAD_DAYS) })
  })

  it('reads published availability, overlapping times run together, and times with no zone as Irish', () => {
    const fb = ['BEGIN:VFREEBUSY', `FREEBUSY;FBTYPE=BUSY:${day(6).replace(/-/g, '')}T080000Z/${day(6).replace(/-/g, '')}T100000Z`, 'END:VFREEBUSY']
    const got = readBusy(
      ics(
        [
          { uid: 'a@x', start: `${day(6)}T09:00`, end: `${day(6)}T12:00`, utc: true },
          { uid: 'b@x', start: `${day(6)}T11:00`, end: `${day(6)}T13:00`, utc: true },
        ],
        '-//Microsoft Corporation//Outlook 16.0 MIMEDIR//EN',
        fb
      ).replace(/DTSTART:(\d{8}T\d{6})Z\r\nDTEND:(\d{8}T\d{6})Z\r\nUID:b@x/, 'DTSTART:$1\r\nDTEND:$2\r\nUID:b@x'),
      TODAY
    )
    if (got.ours) throw new Error('not ours')
    const start = Date.parse(`${day(6)}T08:00:00Z`)
    expect(got.busy).toHaveLength(1)
    expect(Date.parse(got.busy[0]!.start)).toBe(start)
    // b@x had no zone, so 13:00 is Irish time.
    expect(Date.parse(got.busy[0]!.end)).toBe(dublinWallTime(...ymd(day(6)), 13, 0, 0))
  })

  it('says when what came back is not a calendar', () => {
    expect(() => readBusy('<!doctype html><title>Sign in</title>', TODAY)).toThrow()
  })

  it('works out repeats from years back from near today, on the same days and times, with an old one moved into the months ahead', () => {
    const got = readBusy(
      ics([
        // Every day since 2010: far past where working through from the start would have stopped.
        { uid: 'daily@google.com', start: '2010-03-01T09:00', end: '2010-03-01T10:00', rrule: 'FREQ=DAILY' },
        // Every second Tuesday since 2010.
        { uid: 'fortnight@google.com', start: '2010-01-05T19:00', end: '2010-01-05T21:00', rrule: 'FREQ=WEEKLY;INTERVAL=2' },
        // One from 2015 moved to next week.
        { uid: 'fortnight@google.com', start: `${day(5)}T06:00`, end: `${day(5)}T07:00`, recurrenceId: '2015-06-02T19:00' },
      ]),
      TODAY
    )
    if (got.ours) throw new Error('not ours')
    const at = (d: string, h: number) => new Date(dublinWallTime(...ymd(d), h, 0, 0)).toISOString()
    const starts = new Set(got.busy.map((b) => b.start))
    for (let n = 0; n <= 30; n++) {
      expect(starts.has(at(day(n), 9))).toBe(true)
      const fortnightly = (Date.parse(day(n)) - Date.parse('2010-01-05')) % (14 * 86_400_000) === 0
      expect(starts.has(at(day(n), 19))).toBe(fortnightly)
    }
    expect(starts.has(at(day(5), 6))).toBe(true)
  })

  it("reads each file's time zones as its own, not one read before it", () => {
    const zone = ['BEGIN:VTIMEZONE', 'TZID:Studio/Time', 'BEGIN:STANDARD', 'TZOFFSETFROM:+0500', 'TZOFFSETTO:+0500', 'DTSTART:19700101T000000', 'END:STANDARD', 'END:VTIMEZONE']
    const event = (uid: string) => ['BEGIN:VEVENT', `UID:${uid}`, `DTSTART;TZID=Studio/Time:${day(3).replace(/-/g, '')}T120000`, `DTEND;TZID=Studio/Time:${day(3).replace(/-/g, '')}T130000`, 'END:VEVENT']
    const file = (lines: string[]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//x//EN', ...lines, 'END:VCALENDAR'].join('\r\n')
    const first = readBusy(file([...zone, ...event('a@x')]), TODAY)
    const second = readBusy(file(event('b@x')), TODAY)
    if (first.ours || second.ours) throw new Error('not ours')
    expect(Date.parse(first.busy[0]!.start)).toBe(Date.parse(`${day(3)}T07:00:00Z`))
    // The second file doesn't say what Studio/Time is, so its times are Irish ones.
    expect(Date.parse(second.busy[0]!.start)).toBe(dublinWallTime(...ymd(day(3)), 12, 0, 0))
  })
})

/** Three hundred events every day since 2012: 64 KB, and what held the server up for most of a minute when worked through from the start. */
const SLOW = ics(
  Array.from({ length: 300 }, (_, i) => {
    const h = String(7 + (i % 12)).padStart(2, '0')
    return { uid: `daily-${i}@google.com`, start: `2012-01-01T${h}:00`, end: `2012-01-01T${h}:30`, rrule: 'FREQ=DAILY' }
  })
)

describe('a calendar that takes a lot of working out', () => {
  it('is read apart from the server, quickly, while the server keeps answering', async () => {
    let last = performance.now()
    let longest = 0
    const tick = setInterval(() => {
      const now = performance.now()
      longest = Math.max(longest, now - last)
      last = now
    }, 10)
    const began = performance.now()
    try {
      // Limits wide enough for a machine running many tests at once; on its own it takes two or three seconds.
      const got = await readBusyApart(SLOW, TODAY, { maxMs: 60_000, timeoutMs: 60_000 })
      if (got.ours) throw new Error('not ours')
      expect(busyByDay({ busy: got.busy.filter((b) => !b.allDay) }).get(day(1))).toBe('07:00 to 07:30; 08:00 to 08:30; 09:00 to 09:30; 10:00 to 10:30; 11:00 to 11:30; 12:00 to 12:30; 13:00 to 13:30; 14:00 to 14:30; 15:00 to 15:30; 16:00 to 16:30; 17:00 to 17:30; 18:00 to 18:30')
    } finally {
      clearInterval(tick)
    }
    // On the server's own thread, worked through from 2012, it took most of a minute.
    expect(performance.now() - began).toBeLessThan(30_000)
    // And the server's own thread was never held for more than a moment, even on a busy machine.
    expect(longest).toBeLessThan(1_000)
  })

  it('reads a big file of single events in a moment, not one look through the file for each', () => {
    const many = ics(Array.from({ length: 10_000 }, (_, i) => ({ uid: `e${i}@google.com`, start: `${day(i % 100)}T09:00`, end: `${day(i % 100)}T10:00` })))
    const began = performance.now()
    const got = readBusy(many, TODAY)
    // Over a minute when each event looked through the whole file.
    expect(performance.now() - began).toBeLessThan(10_000)
    if (got.ours) throw new Error('not ours')
    expect(got.busy).toHaveLength(100)
  })

  it('past the cap on repeats, or the time, is too much: said, not half read', async () => {
    expect(() => readBusy(SLOW, TODAY, { maxSteps: 1000 })).toThrow(TooMuch)
    const hourly = ics([{ uid: 'hourly@google.com', start: '2000-01-01T09:00', end: '2000-01-01T09:15', rrule: 'FREQ=HOURLY' }])
    expect(() => readBusy(hourly, TODAY, { maxMs: 50 })).toThrow(TooMuch)
    // A worker that runs past its time is stopped.
    await expect(readBusyApart(SLOW, TODAY, { timeoutMs: 50 })).rejects.toThrow(TooMuch)
    await expect(readBusyApart('<!doctype html>', TODAY)).rejects.toThrow(NotACalendar)
  })
})

const ymd = (d: string) => [Number(d.slice(0, 4)), Number(d.slice(5, 7)), Number(d.slice(8, 10))] as const

describe('reading an address someone pasted', () => {
  it('knows the public internet from everything private to the server', () => {
    for (const a of ['8.8.8.8', '142.250.180.14', '2a00:1450:400b:c01::64', '2606:4700:4700::1111']) expect(isPublic(a), a).toBe(true)
    for (const a of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '255.255.255.255',
      '198.18.0.1',
      '::1',
      '::',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
      '::ffff:a9fe:a9fe',
      '64:ff9b::a9fe:a9fe',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
      'ff02::1',
      '2001:db8::1',
      '2002:a00:1::',
      'not an address',
    ])
      expect(isPublic(a), a).toBe(false)
  })

  it('takes https and webcal only, with no name and password in it, on the usual port', async () => {
    const refused = async (address: string) => {
      try {
        await fetchCalendar(address, { resolve: async () => ['8.8.8.8'] })
      } catch (err) {
        return (err as NotRead).words
      }
      return 'read'
    }
    expect(await refused('http://calendar.example.com/a.ics')).toBe(ADDRESS_WORDS.notSecure)
    expect(await refused('ftp://calendar.example.com/a.ics')).toBe(ADDRESS_WORDS.notAnAddress)
    expect(await refused('file:///etc/passwd')).toBe(ADDRESS_WORDS.notAnAddress)
    expect(await refused('https://me:secret@calendar.example.com/a.ics')).toBe(ADDRESS_WORDS.notAnAddress)
    expect(await refused('https://calendar.example.com:8443/a.ics')).toBe(READ_WORDS.private)
  })

  it("won't go anywhere private, whether the address says so or its name points there", async () => {
    const words = async (address: string, resolve?: () => Promise<string[]>) => fetchCalendar(address, { resolve }).then(() => 'read', (err: NotRead) => err.words)
    expect(await words('https://127.0.0.1/a.ics')).toBe(READ_WORDS.private)
    expect(await words('https://[::1]/a.ics')).toBe(READ_WORDS.private)
    expect(await words('webcal://169.254.169.254/latest/meta-data')).toBe(READ_WORDS.private)
    expect(await words('https://calendar.example.com/a.ics', async () => ['10.0.0.5'])).toBe(READ_WORDS.private)
    // One public address and one private is still private: either could be the one connected to.
    expect(await words('https://calendar.example.com/a.ics', async () => ['8.8.8.8', '192.168.0.10'])).toBe(READ_WORDS.private)
    expect(await words('https://calendar.example.com/a.ics', async () => ['::ffff:127.0.0.1'])).toBe(READ_WORDS.private)
    expect(await words('https://nowhere.invalid/a.ics', async () => Promise.reject(new Error('ENOTFOUND')))).toBe(READ_WORDS.unreachable)
  })

  it('reads from a stand-in, follows a redirect checked again, and stops at the size and time limits', async () => {
    const cal = await host()
    const testHosts = [cal.host]
    cal.set('/basic.ics', { ics: ics([]) })
    expect(await fetchCalendar(cal.url('/basic.ics'), { testHosts })).toContain('BEGIN:VCALENDAR')
    // Only GET, with nothing of ours in it.
    expect(cal.requests.at(-1)).toMatchObject({ method: 'GET' })
    expect(cal.requests.at(-1)!.headers.cookie).toBeUndefined()

    cal.set('/moved', { redirect: '/basic.ics' })
    expect(await fetchCalendar(cal.url('/moved'), { testHosts })).toContain('BEGIN:VCALENDAR')
    // A redirect to somewhere private is checked like the address itself, and refused.
    cal.set('/sneaky', { redirect: 'https://169.254.169.254/latest/meta-data' })
    await expect(fetchCalendar(cal.url('/sneaky'), { testHosts })).rejects.toMatchObject({ words: READ_WORDS.private })
    cal.set('/elsewhere', { redirect: 'http://127.0.0.1:1/' })
    await expect(fetchCalendar(cal.url('/elsewhere'), { testHosts })).rejects.toMatchObject({ words: ADDRESS_WORDS.notSecure })
    cal.set('/loop', { redirect: '/loop' })
    await expect(fetchCalendar(cal.url('/loop'), { testHosts })).rejects.toMatchObject({ words: READ_WORDS.redirects })

    cal.set('/big', { bytes: 2 * 1024 * 1024 })
    await expect(fetchCalendar(cal.url('/big'), { testHosts, maxBytes: 1024 * 1024 })).rejects.toMatchObject({ words: READ_WORDS.big })
    cal.set('/slow', { slowMs: 2000, ics: ics([]) })
    await expect(fetchCalendar(cal.url('/slow'), { testHosts, timeoutMs: 200 })).rejects.toMatchObject({ words: READ_WORDS.slow })
    cal.set('/private', { status: 403 })
    await expect(fetchCalendar(cal.url('/private'), { testHosts })).rejects.toMatchObject({ words: READ_WORDS.denied })
    await expect(fetchCalendar(cal.url('/nothing'), { testHosts })).rejects.toMatchObject({ words: READ_WORDS.gone })

    // Without being named a stand-in, this machine is as private as anywhere.
    await expect(fetchCalendar(cal.url('/basic.ics'))).rejects.toMatchObject({ words: ADDRESS_WORDS.notSecure })
    await expect(fetchCalendar(cal.url('/basic.ics').replace('http:', 'https:'))).rejects.toMatchObject({ words: READ_WORDS.private })
  })

  it('takes calendar addresses out of error reports, whatever their secret looks like', () => {
    expect(redact('Could not read webcal://p52-caldav.icloud.com/published/2/MTIzNDU2Nzg')).toBe('Could not read webcal://p52-caldav.icloud.com/[address]')
    expect(redact('Fetching https://cal.example.ie/feed.ics?key=abc123 failed')).toBe('Fetching https://cal.example.ie/[address] failed')
    expect(redact('https://calendar.google.com/calendar/ical/aoife%40gmail.com/private-0123456789abcdef/basic.ics')).toBe('https://calendar.google.com/[address]')
    expect(redact('GET https://outlook.office365.com/owa/calendar/abc/def/reachcalendar.ics')).toBe('GET https://outlook.office365.com/[address]')
    // Any other address keeps its path, so a report still says which screen and which script.
    expect(redact('at https://app.sessionhire.com/assets/index-Bx1.js:10')).toBe('at https://app.sessionhire.com/assets/index-Bx1.js:10')
  })
})

/** The office signed in, with Aoife on the crew list, and a calendar host on this machine. */
async function office(reading?: OwnCalendarsOptions['reading']) {
  const cal = await host()
  const { app, db } = await server({ ownCalendars: { testHosts: [cal.host], reading } })
  const colly = await staff(app, db, 'Colly Hewson', IPHONE, 'phone-c0ffee')
  expect(await colly.send('person.upsert', { id: 'aoife', name: 'Aoife Byrne', kind: 'freelancer', email: 'aoife@example.com', phone: null, skills: [], dayRateCents: 30000, notes: '' })).toMatchObject({
    status: 'applied',
  })
  const token = (await db.query<{ t: string }>(`SELECT link_token AS t FROM people WHERE id = 'aoife'`)).rows[0]!.t
  const page = async () => (await app.inject({ url: `/f/${token}` })).body
  const post = (path: string, fields: Record<string, string>) =>
    app.inject({ method: 'POST', url: `/f/${token}${path}`, headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': ANDROID }, payload: new URLSearchParams(fields).toString() })
  const record = () => colly.record<OwnCalendar | null>('ownCalendar', 'aoife').catch(() => undefined)
  return { app, db, cal, colly, token, page, post, record }
}

const SECRET_PATH = '/calendar/ical/aoife%40example.com/private-5f1e2d3c/basic.ics'

describe('sharing their own calendar', () => {
  it('from their private link: read at once, only busy times kept, shown back to them, and stopped in one tap', async () => {
    const { app, db, cal, colly, page, post } = await office()
    cal.set(SECRET_PATH, { ics: ics([{ uid: 'a@google.com', start: day(3), end: day(4), summary: 'Wedding in Galway', location: 'The Twelve' }]) })
    const before = await page()
    // Said before anything is pasted: what's kept, and that nothing is written.
    expect(before).toContain("We keep only the times you're busy: never what, where or who with. Nothing is ever added to your calendar")

    const shared = await post('/calendar', { address: cal.url(SECRET_PATH) })
    expect(shared.statusCode).toBe(303)
    const to = new URL(shared.headers.location as string, 'http://x')
    const after = (await app.inject({ url: to.pathname + to.search })).body
    expect(flashOf(after)).toEqual({ ok: true, message: "Thanks. We've read your calendar, and the office can see when you're busy." })
    expect(after).toContain('Busy all day')
    expect(after).not.toContain('Wedding')
    // The page never shows the address again.
    expect(after).not.toContain('private-5f1e2d3c')

    // Devices see when, never where from.
    const seen = await colly.record<OwnCalendar>('ownCalendar', 'aoife')
    expect(seen).toMatchObject({ personId: 'aoife', addedBy: 'self', problem: null, busy: [{ start: day(3), end: day(3), allDay: true }] })
    const pull = (await app.inject({ url: '/api/sync/pull?after=0', cookies: colly.cookies })).body
    expect(pull).not.toContain('private-5f1e2d3c')
    expect(pull).not.toContain('Wedding')
    // The history says who shared it, in their voice, and never the address.
    const history = await colly.history()
    expect(history.entries[0]).toMatchObject({ what: "Aoife Byrne shared when they're busy in their own calendar, to be read only" })
    const { rows } = await db.query<{ args: unknown }>(`SELECT args FROM mutations`)
    expect(JSON.stringify(rows)).not.toContain('private-5f1e2d3c')

    // One tap stops it: the address and the busy times are gone.
    const stopped = await post('/calendar/stop', {})
    expect(stopped.statusCode).toBe(303)
    expect((await db.query(`SELECT 1 FROM own_calendars`)).rows).toHaveLength(0)
    const again = await page()
    expect(again).toContain("Share when I'm busy")
    expect((await colly.history()).entries[0]).toMatchObject({ what: 'Aoife Byrne stopped sharing their own calendar' })
  })

  it("says what's wrong beside the field, keeps what was pasted, and keeps nothing", async () => {
    const { db, cal, post } = await office()
    const words = async (address: string) => {
      const res = await post('/calendar', { address })
      expect(res.statusCode).toBe(422)
      expect(res.body).toContain(`value="${address.replace(/&/g, '&amp;')}"`)
      return flashOf(res.body).message
    }
    expect(await words('not an address')).toBe(ADDRESS_WORDS.notAnAddress)
    expect(await words('http://calendar.example.com/a.ics')).toBe(ADDRESS_WORDS.notSecure)
    cal.set('/web-page', { ics: '<!doctype html><title>Sign in</title>', type: 'text/html' })
    expect(await words(cal.url('/web-page'))).toBe(NOT_A_CALENDAR)
    expect(await words(cal.url('/nowhere.ics'))).toBe(READ_WORDS.gone)
    // Their own Session Hire feed, pasted back to us, is said to be ours.
    cal.set('/ours.ics', { ics: 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Session Hire//Crew//EN\r\nEND:VCALENDAR\r\n' })
    expect(await words(cal.url('/ours.ics'))).toBe(ADDRESS_WORDS.ours)
    expect((await db.query(`SELECT 1 FROM own_calendars`)).rows).toHaveLength(0)
    expect((await db.query(`SELECT 1 FROM changes WHERE entity = 'ownCalendar'`)).rows).toHaveLength(0)
  })

  it('says a calendar that takes too much working out as it says any other read that failed, and keeps what was read before', async () => {
    const { app, db, cal, post, record } = await office({ maxSteps: 2000 })
    cal.set('/slow.ics', { ics: SLOW })
    const res = await post('/calendar', { address: cal.url('/slow.ics') })
    expect(res.statusCode).toBe(422)
    expect(flashOf(res.body).message).toBe(TOO_MUCH)
    expect((await db.query(`SELECT 1 FROM own_calendars`)).rows).toHaveLength(0)

    cal.set(SECRET_PATH, { ics: ics([{ uid: 'a@google.com', start: `${day(2)}T09:00`, end: `${day(2)}T13:00` }]) })
    expect((await post('/calendar', { address: cal.url(SECRET_PATH) })).statusCode).toBe(303)
    cal.set(SECRET_PATH, { ics: SLOW })
    await app.ownCalendars.readNow('aoife')
    expect(await record()).toMatchObject({ problem: TOO_MUCH, busy: [{ allDay: false }] })
  })

  it('from their page in the app, with the address they sent: read now, read again, and a problem said without losing what was read', async () => {
    const { app, cal, colly, record } = await office()
    cal.set(SECRET_PATH, { ics: ics([{ uid: 'a@google.com', start: `${day(2)}T09:00`, end: `${day(2)}T13:00` }]) })
    const share = (address: string, cookies = colly.cookies) =>
      app.inject({ method: 'POST', url: '/api/own-calendars/aoife?client=phonec0ffee', cookies, headers: { 'user-agent': IPHONE }, payload: { address } })
    const res = await share(cal.url(SECRET_PATH))
    expect(res.statusCode).toBe(200)
    expect(JSON.stringify(res.json())).not.toContain('private-5f1e2d3c')
    expect(await record()).toMatchObject({ addedBy: 'office', busy: [{ allDay: false }] })
    expect((await colly.history()).entries[0]).toMatchObject({ what: "Added Aoife Byrne's own calendar, from the address they sent, to read when they're busy" })

    // Read again now: a new event comes in.
    cal.set(SECRET_PATH, { ics: ics([{ uid: 'b@google.com', start: day(8), end: day(9) }]) })
    expect((await app.inject({ method: 'POST', url: '/api/own-calendars/aoife/read', cookies: colly.cookies })).statusCode).toBe(200)
    expect((await record())?.busy).toEqual([{ start: day(8), end: day(8), allDay: true }])

    // The calendar's address is reset: the problem is said, and what was read before still shows.
    cal.set(SECRET_PATH, { status: 404 })
    await app.ownCalendars.readNow('aoife')
    expect(await record()).toMatchObject({ problem: READ_WORDS.gone, busy: [{ start: day(8), end: day(8), allDay: true }] })
    // It's fine again on the next read.
    cal.set(SECRET_PATH, { ics: ics([]) })
    await app.ownCalendars.readNow('aoife')
    expect(await record()).toMatchObject({ problem: null, busy: [] })

    // A wrong address is said in words, and changes nothing.
    const wrong = await share('https://192.168.1.20/cal.ics')
    expect(wrong.statusCode).toBe(422)
    expect(wrong.json().error).toBe(READ_WORDS.private)

    // The office stops it with a command, offline or not.
    expect(await colly.send('ownCalendar.stop', { personId: 'aoife' })).toMatchObject({ status: 'applied' })
    expect((await colly.history()).entries[0]).toMatchObject({ what: "Stopped reading Aoife Byrne's own calendar" })
    expect((await app.inject({ method: 'POST', url: '/api/own-calendars/aoife/read', cookies: colly.cookies })).statusCode).toBe(404)
  })

  it('reads every calendar due on its schedule, and none of an archived person', async () => {
    const { app, db, cal, colly } = await office()
    cal.set(SECRET_PATH, { ics: ics([]) })
    await app.inject({ method: 'POST', url: '/api/own-calendars/aoife', cookies: colly.cookies, payload: { address: cal.url(SECRET_PATH) } })
    expect(cal.asked(SECRET_PATH)).toBe(1)
    // Read just now: not due.
    await app.ownCalendars.readDue()
    expect(cal.asked(SECRET_PATH)).toBe(1)
    await db.query(`UPDATE own_calendars SET tried_at = now() - interval '4 hours'`)
    await app.ownCalendars.readDue()
    expect(cal.asked(SECRET_PATH)).toBe(2)
    // Archived, their link stops, so their calendar stops with it: they couldn't stop it themselves.
    expect(await colly.send('person.archive', { id: 'aoife', archived: true })).toMatchObject({ status: 'applied' })
    expect((await db.query(`SELECT 1 FROM own_calendars`)).rows).toHaveLength(0)
  })

  it('needs the right to change crew in the app', async () => {
    const { app, db, cal, colly } = await office()
    cal.set(SECRET_PATH, { ics: ics([]) })
    const person = (id: string, name: string, email: string) => ({ id, name, kind: 'staff' as const, email, phone: null, skills: [], dayRateCents: null, notes: '' })
    expect(await colly.send('person.upsert', person('colly', 'Colly Hewson', colly.email))).toMatchObject({ status: 'applied' })
    expect(await colly.send('person.upsert', person('ciara', 'Ciara Walsh', 'ciara@sessionhire.com'))).toMatchObject({ status: 'applied' })
    // A director makes roles count; Ciara, with none set, is staff crew: she can look, not change crew.
    expect(await colly.send('person.role', { id: 'colly', role: 'director' })).toMatchObject({ status: 'applied' })
    const ciara = await staff(app, db, 'Ciara Walsh', IPHONE, 'phone-beef')
    const res = await app.inject({ method: 'POST', url: '/api/own-calendars/aoife', cookies: ciara.cookies, payload: { address: cal.url(SECRET_PATH) } })
    expect(res.statusCode).toBe(403)
    expect(cal.asked(SECRET_PATH)).toBe(0)
    expect((await app.inject({ method: 'POST', url: '/api/own-calendars/aoife/read', cookies: ciara.cookies })).statusCode).toBe(403)
    expect(await ciara.send('ownCalendar.stop', { personId: 'aoife' })).toMatchObject({ status: 'rejected', reason: { code: 'forbidden' } })
    // The director can.
    expect((await app.inject({ method: 'POST', url: '/api/own-calendars/aoife', cookies: colly.cookies, payload: { address: cal.url(SECRET_PATH) } })).statusCode).toBe(200)
  })

  it("keeps the address out of Download everything and the person's own download, and erasing them takes it all", async () => {
    const { app, db, cal, colly, token } = await office()
    cal.set(SECRET_PATH, { ics: ics([{ uid: 'a@google.com', start: day(3), end: day(4) }]) })
    await app.inject({ method: 'POST', url: '/api/own-calendars/aoife', cookies: colly.cookies, payload: { address: cal.url(SECRET_PATH) } })
    const everything = JSON.stringify(everythingJson(await readEverything(db)))
    expect(everything).toContain('own_calendars')
    expect(everything).not.toContain('private-5f1e2d3c')
    const mine = await app.inject({ url: `/f/${token}/data.json` })
    expect(mine.json().ownCalendar).toMatchObject({ busy: [{ start: day(3) }] })
    expect(mine.body).not.toContain('private-5f1e2d3c')

    // Erased only once archived, and archiving stops reading it; one left behind from before that rule goes with them too.
    expect(await colly.send('person.archive', { id: 'aoife', archived: true })).toMatchObject({ status: 'applied' })
    expect((await db.query(`SELECT 1 FROM own_calendars`)).rows).toHaveLength(0)
    await db.query(`INSERT INTO own_calendars (id, person_id, address, added_by, busy, until_day) VALUES ('aoife', 'aoife', $1, 'self', '[]', $2)`, [cal.url(SECRET_PATH), day(120)])
    expect(await colly.send('person.erase', { id: 'aoife' })).toMatchObject({ status: 'applied' })
    expect((await db.query(`SELECT 1 FROM own_calendars`)).rows).toHaveLength(0)
    expect((await db.query(`SELECT 1 FROM changes WHERE entity = 'ownCalendar' AND op = 'put'`)).rows).toHaveLength(0)
    const history: HistoryPage = await colly.history()
    expect(JSON.stringify(history)).not.toContain('private-5f1e2d3c')
  })
})
