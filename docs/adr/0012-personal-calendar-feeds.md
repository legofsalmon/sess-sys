# ADR 0012: Personal calendar feeds

- **Status:** Accepted, 30 September 2026. The sixth and last part of Phase 1.
- **Decides:** what a person's own calendar feed shows, the address it
  lives at, how it stays private and cheap to serve, and where people find
  it.

## Context

Crew booking ([ADR 0002](0002-crew-booking-links.md)) gave every person a
calendar feed of their bookings, at their private link with
`/calendar.ics` on the end, so a freelancer sees Session Hire work next to
everyone else's in any calendar app. Three things about it don't hold up
once people really use it:

- **The feed's address is the answer link.** A calendar app keeps the
  address it subscribes to, and people share their calendars: with a
  partner, an assistant, or another company that books them. Anyone who
  can see the address can answer offers, change days off and download
  everything held on the person. Each event carried the link in its
  description too.
- **Every look reads the database.** Calendar apps look at a feed whether
  or not anything has changed: Apple and Outlook as often as every hour
  (the feed asks for that), Google every few hours. A hundred people's
  feeds would keep the database awake around the clock, which the rest of
  the app takes care not to do: the uptime check reads nothing, and the
  watcher for crew answers in Google keeps what it has seen in memory.
- **Staff can't find theirs.** The address is only on the freelancer
  page, which staff don't use.

The server's request log (Railway's logs) also records every address in
full, so private link addresses sit in the logs, as would a Google
sign-in code.

## Decision

- **A read-only address of its own:** `/cal/<code>.ics`. The code is
  worked out from the person's private link (the first 24 characters of a
  SHA-256 hash of it, in the same letters a link uses), so nothing more
  is stored, backed up or exported. Whoever has the link can find the
  feed; the feed can't be turned back into the link; and **New link**
  gives a new feed address too. The app works the code out on the device,
  the same way as the server.
- **What it shows is unchanged.** Every job the person holds, accepted
  (shown as tentative) or confirmed, as all-day events in the calendar's
  `<Job> - <Phase>` shape, one per run of days, with the venue, role,
  call time, rate and the details for crew. Offers not yet answered,
  declined ones and withdrawn jobs aren't in it, and a job leaves the feed
  when its crew call is cancelled. Past jobs stay, for invoicing.
- **No private link inside.** The events no longer carry the link to the
  person's page; they say the details and any changes are on it. So the
  feed is safe in a shared calendar.
- **Served from memory.** The first time any feed is asked for, the server
  builds everyone's at once, from two reads of the database, and keeps
  them. Anything that changes in the app (a device syncing, an answer on a
  link or in Google, jobs brought in) marks them out of date, and the next
  look builds them again. They are rebuilt at least every 6 hours anyway,
  for the few minutes of a deploy when two servers run. A look while
  nothing has changed, or at an address that doesn't exist, doesn't touch
  the database.
- **"Anything new?" is cheap.** Each feed has an ETag and a Last-Modified
  time that move only when that person's feed changes, and an unchanged
  feed answers `304 Not Modified` with nothing else. Feeds are marked
  private (no shared caches) and not for search engines, as before.
- **The old address keeps working**, from the same memory, so anyone
  already subscribed isn't cut off. New link retires it with the link.
- **Where people find it:**
  - the freelancer page gives the new address, as a subscribe link
    (iPhone, Mac, Outlook) and as an address to paste into Google
    Calendar's "From URL", and says it only shows bookings, and that
    anyone getting our Google Calendar invites doesn't need it as well;
  - the Crew tab has **Copy calendar address** beside Copy link, for the
    office to send on;
  - signed-in staff who are also in Crew, with the same email address,
    get **Your bookings in your own calendar** on the Account tab.
- **Private addresses are kept out of the logs.** Each request is logged
  with its method and path only: link and feed codes are replaced
  (`/f/:token`, `/cal/:token`) and the query string, which can hold a
  sign-in code, is left out.

## Consequences

- A freelancer's calendar can be shared, synced or read by their calendar
  provider without handing over their answers. A leaked feed address shows
  their bookings, including rates, until the office presses New link. That
  also changes their answer link, so the office sends the new one and they
  subscribe again.
- Calendar apps looking at feeds don't wake the database: it is read for
  feeds only after something has changed, or once 6 hours have passed.
- A change made on the old server during a deploy can take up to 6 hours
  to reach a feed the new server built just before it. Calendar apps take
  that long to look again anyway (Google up to a day).
- Someone who gets our Google invites
  ([ADR 0009](0009-crew-invites.md)) and subscribes as well sees each job
  twice; the page says so.
- A feed is one-way, as all feeds are: calendar apps show it as a separate
  calendar that can be coloured, hidden or removed, but not edited. Yes
  and No are given on the link, or in Google by people invited there.
- The request log no longer says which link a request came from. When
  that matters (someone using a leaked link), the answers themselves are
  in the history, marked as coming from the link, with the device.
  Railway's own record of requests, separate from the app's log, still
  sees whole addresses; only people with access to the Railway project
  can read it.
