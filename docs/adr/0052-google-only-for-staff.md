# ADR 0052: Google is the only way in for staff, and they stay signed in

- **Status:** accepted
- **Date:** 18 October 2026
- **Asked for by:** Colly, 18 October 2026 ("For staff can we tie sign in
  to their google? So log in with google is the only option for them."
  and "And then persist their login for as long as possible.")
- **Follows:** [ADR 0003](0003-staff-sign-in.md) (staff sign-in),
  [ADR 0002](0002-crew-booking-links.md) (private links)

## Context

The app itself has needed a Google sign-in from a sessionhire.com account
since 15 October. But every person on the Crew tab, staff included, also
has a private link, `/f/<token>`, where they answer calls, mark days off,
say they're running late, send timesheets and documents, and download
their data. The link is its own credential, so a member of staff's link
was a second way in for them that never asked who they were: forwarded or
seen over a shoulder, it acted as them.

The other ways in are not staff routes: the demo copy's shared passcode
(`DEMO_PASSCODE`) only works where Google sign-in is off, and
`AUTH_MODE=open` is the deliberate switch, on the Railway service, for
running with no sign-in at all.

Sessions lasted 60 days after a device was last used.

## Decision

1. **A member of staff's page asks for Google.** When Google sign-in is
   on, every address under a staff person's link (`/f/<token>`, its call
   sheets, timesheets, documents, forms and `data.json`) opens only for a
   signed-in account that is that person (matched by email, as roles
   are), or the office or a director once roles are on, or anyone signed
   in while roles are off, as the whole app is then open to every member
   of staff. Anyone else gets a page with one button, **Sign in with
   Google**, which comes back to the page; a different account is told
   whose account it is signed in as.
2. **Freelancers are unchanged.** Their link is still all they need: they
   have no company Google account and are met where they are (ADR 0002).
3. **Calendar feeds are unchanged.** `/f/<token>/calendar.ics` and
   `/cal/<code>.ics` are fetched by calendar apps, which can't sign in.
   They only read.
4. **Sessions last 400 days after last use**, renewed on each day of use.
   400 days is the longest a browser keeps a cookie (Chrome caps every
   cookie there), so in practice staff stay signed in until they sign
   out, their account is switched off, or a device goes unused for over a
   year. The demo copy's passcode and persona cookies keep their 60 days.

## Not changed, on purpose

- **Nobody can be locked out by this.** The app's own sign-in is as it
  was. If Google itself were ever unusable, `AUTH_MODE=open` on the
  Railway service still opens the app on purpose, and the server already
  refuses to start without the Google keys otherwise (ADR 0003).
- The demo copy (Railway service "demo") keeps its passcode: it has no
  Google keys, so the guard doesn't run there.

## Consequences

- A staff person's email on the Crew tab must be the Google address they
  sign in with, as roles already need. A wrong one shows them "You're
  signed in as …, which isn't …'s account" and the office fixes it.
- Messages to staff carrying their link still work: the link now asks
  them to sign in once, then remembers them.
- Switching someone off (`users.disabled`) now also closes their page.
