# ADR 0044: Freelancers' own calendars, read only

- **Status:** accepted
- **Date:** 17 October 2026
- **Asked for by:** Colly, 17 October 2026 (the later step left open in
  [ADR 0002](0002-crew-booking-links.md): read free/busy from a
  freelancer's own calendar if they share it)

## Context

The office asks freelancers for days without knowing what else they have
on. Days off marked on the link (ADR 0002) help, but only when someone
remembers to mark them twice: once in their own calendar and once here.
[architecture.md](../architecture.md) promised "their calendar, not ours":
ops see real availability without a second calendar to fill in, and only
busy or free is read, never who else they work for.

Every calendar a freelancer uses can publish a private address in iCal
format: Google's "Secret address in iCal format", Outlook's published
calendar link, and an iCloud calendar shared publicly, which gives a
`webcal://` address. Reading one needs no sign-in, no Google project and
no permission from anyone but the freelancer, and nothing can be written
back through it.

## Decision

1. **The freelancer chooses, on their private link.** A section "Your own
   calendar" says first what's kept (only the times they're busy, never
   what, where or who with), that nothing is ever added to their calendar,
   and that our bookings in it aren't counted. They paste the address, with
   a "Where do I find it?" fold for Google, Outlook and iCloud, and tap
   "Share when I'm busy". It works with no script.
2. **The office can add it on the person's page** (ADR 0040), in a card
   "Their own calendar", when the freelancer sent the address. It needs
   the right to change crew (ADR 0034), and signal, since the server reads
   the calendar there and then. The card says who shared it.
3. **Read at once, then every three hours, and when asked.** Sharing reads
   the calendar before anything is kept, so a wrong address is said beside
   the field in words and nothing is saved. The server looks every quarter
   of an hour for ones due; the office's "Read it now" reads one at once.
   A read that fails keeps what was read before and says what went wrong on
   both the link and the person's page.
4. **Only busy times are kept:** start and end, all day or timed, from
   yesterday to four months ahead, at most a thousand, overlapping ones run
   together. Repeating events are worked out with
   [ical.js](https://github.com/kewisch/ical.js) (Mozilla's, used by
   Thunderbird), with days taken out and single days moved. Times with no
   zone are Irish. Cancelled events don't count, nor timed events marked
   free; all-day events count even when marked free, since Google marks
   them free by default and a whole gig is often put in as one. Published
   free/busy periods are read too. Titles, places, notes and guests are
   never stored or shown.
5. **Our own bookings don't count.** Events from the freelancer's Session
   Hire feed (ADR 0012) are known by their UID's domain; a whole calendar
   that is that feed (its PRODID) is refused, with words saying so.
6. **Busy shows as busy, never as a clash:** in the planner (ADR 0010) as
   "Busy (own calendar)", neutral and hatched, with no problem raised; on
   the person's page as a list of days; and when making an offer as a
   warning beside the picker ("busy in own calendar"), with the offer still
   free to go. They may be able to move it, and they can still say yes.
7. **Stopping is one tap**, from the link ("Stop sharing my calendar") or
   by the office ("Stop reading it", confirmed). The address and the busy
   times are deleted. From the app it's a command (`ownCalendar.stop`), so
   it works offline. Archiving someone stops it too, since their link stops
   and they couldn't stop it themselves; erasing them removes it.
8. **The address is a secret.** It is kept on the server only, in
   `own_calendars.address`. It is never a command's argument, so it is in
   no mutation, change, device, history line or error; sharing is recorded
   as a server action with who shared it and nothing else. Download
   everything leaves the column out, as it does for link tokens and keys,
   and the person's own download says what was read but not the address.
   Backups keep it, as they keep the link secrets
   ([ADR 0006](0006-audit-trail-and-export.md)), so a restore keeps reading.
   Error reports blank any calendar address's path and query
   (`shared/src/privacy.ts`).
9. **The server guards what it fetches.** Only `https://` and `webcal://`
   (read as https), on port 443, with no name or password in it. The name
   is looked up and every address it gives must be on the public internet:
   private, loopback, link-local, carrier NAT, multicast, documentation and
   reserved ranges are refused, in IPv4 and IPv6, including IPv4 written
   inside IPv6. The connection goes to the address just checked, so a
   second look-up can't change it. Redirects are followed by hand, at most
   three, each checked again. The whole read has 20 seconds and 8 MB. Only
   a GET is sent, with no cookies or keys of ours. Tests and the browser
   tests read from a stand-in on this machine named by
   `OWN_CALENDAR_TEST_HOSTS`, which is never set where the server runs for
   real.
10. **Nothing is written and nobody is contacted.** The app only reads.

## Consequences

- A new table `own_calendars` (one row per person), a synced entity
  `ownCalendar` without the address, a server action
  `ownCalendar.share`, a command `ownCalendar.stop`, the routes
  `POST /api/own-calendars/:personId` and `…/read`, and on the link
  `POST /f/:token/calendar` and `…/calendar/stop`.
- One new dependency on the server, `ical.js`.
- Calendars that publish nothing in the next four months show nothing, and
  a calendar that stops answering keeps showing its last read, with the
  problem said, until someone stops it or it reads again.
- Busy is a hint, not a rule: no offer is refused for it, and the planner
  raises no problem for it.
- Two-way calendar sync for our own Gigs calendar (Phase 1) is unchanged:
  this reads someone else's calendar and writes nothing anywhere.
