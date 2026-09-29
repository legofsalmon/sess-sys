# ADR 0003: Staff sign in with Google, and stay signed in offline

- **Status:** Accepted, 29 September 2026. Built; it switches on once the Google sign-in keys are added to the app server ([how](../sign-in-setup.md)).
- **Decides:** how staff get into the app, what stays open without signing in, and how sign-in fits the offline promise in [ADR 0001](0001-sync-engine.md).

## Context

Until now anyone with the app's address could read and change everything,
including freelancers' private links, which is why no real jobs or crew
could go in. Staff already have Google Workspace accounts on
`sessionhire.com`, and the architecture chose Workspace sign-in for them.
Freelancers already have their own way in, a private link
([ADR 0002](0002-crew-booking-links.md)), and don't need an account.

The app has to keep working in a warehouse or a field with no signal. A
sign-in that asks the server on every screen, or that expires while a phone
is offline, would break that.

## Decision

- **Staff sign in with Google.** The app server runs the standard OpenID
  Connect flow with PKCE: the browser goes to Google, the person picks their
  account, and the server swaps the one-time code Google sends back for who
  the person is. The Google client secret stays on the server.
- **Staff means a Workspace account on `sessionhire.com`,** checked with the
  domain Google itself puts on company accounts (the `hd` claim), not the
  ending of the email address, since a personal Google account can be made
  with any address. Other domains and single accounts (for example a tester)
  can be added with the `STAFF_DOMAINS` and `STAFF_EMAILS` settings.
- **A session is a random secret in a cookie** that page scripts can't read
  and other sites can't send (HttpOnly, SameSite=Lax, Secure). The database
  keeps only a hash of it, so a copy of the database can't be used to sign in.
  A session lasts 60 days after the device was last used, so a phone picked
  up every week never asks again, while a lost one drops out on its own.
- **Offline, a device carries on.** It keeps showing and changing its own
  copy of the data, and its changes wait in the outbox as before. It only
  shows the sign-in page when the server itself says it isn't signed in, and
  then its waiting changes stay put until someone signs in, so nothing made
  offline is lost to an expired session.
- **Everything under `/api` needs sign-in,** except the health check and the
  sign-in steps. The app's shell and files load for anyone (they hold no
  data), and freelancers' links keep working without sign-in, as ADR 0002
  says.
- **Every change records who made it:** the signed-in person is kept on the
  command in the audit trail, next to the device and the times.
- **Signing out clears the device's copy** of the data, after a warning if
  changes haven't synced yet, so a shared or handed-back phone doesn't keep
  the company's data.
- **Sign-in is on when the Google keys are set, and can't quietly go
  away.** Without the keys the app stays open, as it has been, for trials
  with made-up data. Once anyone has signed in, the server refuses to start
  without the keys, so a lost setting fails the deploy instead of opening the
  app to everyone. Switching sign-in off on purpose takes `AUTH_MODE=open`.

## Consequences

- Colly (or whoever manages Google for the company) creates the Google
  sign-in keys once, in a Google Cloud project that Phase 1's calendar sync
  will reuse. The steps are in [sign-in-setup.md](../sign-in-setup.md).
- Everyone signed in can do everything for now. The roles in the
  architecture (owner, ops, warehouse, crew chief, accountant) come later,
  enforced on the server; the audit trail already records who did what.
- The audit trail records who was signed in when a change reached the
  server. A change that waited on a phone through a sign-out is recorded
  under whoever signs in next on that phone; recording the maker on the
  device as well can come with roles.
- A member of staff is switched off by marking their account disabled,
  which ends their sessions at once. There is no screen for this yet; it is a
  one-line change in the database until one is built.
- On an iPhone, a home-screen app keeps its own cookies separate from
  Safari, so it needs signing in once from the home-screen app itself. The
  field test should confirm Google's page opens and returns there cleanly.
- Machine access can't use a person's session, so anything outside the app
  that needs the data will need its own key. Backups don't: the server makes
  them itself ([ADR 0004](0004-backups.md)).
