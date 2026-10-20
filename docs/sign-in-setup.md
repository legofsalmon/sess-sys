# Switching on staff sign-in and Google Calendar

Sign-in ([Decision 0003](adr/0003-staff-sign-in.md)) and putting confirmed
jobs on Google Calendar ([Decision 0008](adr/0008-calendar-sync.md)) are
built, and both switch on as soon as the app server has a Google key. Making
the key takes about ten minutes in Google Cloud, once. Connecting the
calendar then takes a minute in the app (step 4). Crew invites on the
calendar ([Decision 0009](adr/0009-crew-invites.md)) are built too, behind a
switch that starts off (step 5), and so is bringing in the jobs already on
the organisers' calendars ([Decision 0011](adr/0011-calendar-import.md),
step 6). Once you're in, step 7 clears the made-up data before real work goes in,
and step 8 switches roles on.

The app has moved around since these steps were first written: what was the
Account tab is now **Admin**, and your own name, signing out and roles are on
**You**. Both are in the **Menu**, the last place in the bar (or the
sidebar on a desk).

**Before you start:** the secret you create is a password for the app.
Paste it only into Railway, never into a chat or an email.

## 1. Make the Google key

1. Go to [console.cloud.google.com](https://console.cloud.google.com),
   signed in with your **sessionhire.com** Google Workspace account. Using
   the Workspace account matters: it puts the project under the company, so
   step 3 can make the app Internal.
2. In the project picker at the top, choose **New project**, call it
   **Session Hire**, and create it. Make sure it's selected afterwards.
3. Search for **Google Auth Platform** and open it, then **Get started**:
   - App name **Session Hire**, and your email as the support and contact
     email.
   - Audience: **Internal** if you're signed in with a sessionhire.com
     account. Only company accounts can then sign in, Google doesn't
     need to review anything, and the calendar stays connected for good.
   - If Internal isn't offered (the account you're using isn't a
     sessionhire.com one), choose **External**, and afterwards add each
     person who should be able to sign in, and the account that will write
     the calendar, under **Audience**, **Test users**. Sign-in works the
     same, but while the app is in testing Google makes the calendar
     connection lapse after seven days, and Admin then asks for
     it to be connected again.
4. Go to **Clients**, **Create client**:
   - Application type **Web application**, name **Session Hire app**.
   - Under **Authorised redirect URIs**, add exactly these two, one for
     sign-in and one for the calendar:
     `https://shserver-production.up.railway.app/api/auth/google/callback`
     `https://shserver-production.up.railway.app/api/calendar/callback`
   - Create. Copy the **Client ID** and the **Client secret** straight away;
     Google may only show the secret once.
5. Search for **Google Calendar API**, open it and press **Enable**.

If you made the key before the calendar was built, open **Clients**, then
**Session Hire app**, add the second redirect address and save, and do
step 5. The Client ID and secret stay the same, so Railway needs nothing new.

## 2. Give it to the app server

In Railway, open the **shserver** service, then **Variables**, and add:

| Variable | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | The Client ID from step 1 |
| `GOOGLE_CLIENT_SECRET` | The Client secret from step 1 |
| `STAFF_DOMAINS` | Only if the Workspace's address isn't sessionhire.com: the domain your company accounts end in. Leave it out otherwise |
| `STAFF_EMAILS` | Only if people outside sessionhire.com should sign in (for example a tester): their Google addresses, separated by commas |
| `SYSTEM_ADMINS` | Whoever builds and sets the app up: their Google addresses, separated by commas. They can change everything whatever their role on the Crew tab ([Decision 0060](adr/0060-system-admins.md)). It lets nobody in who isn't already staff |

Railway then asks to deploy the change; let it.

Add these to the **shserver** service only. The demo copy (the **demo**
service) keeps its passcode and no Google key: once a server has the Google
key, it ignores its passcode and only company accounts get in, so the demo
would be closed to the people it's for.

## 3. Check it

1. Open
   [shserver-production.up.railway.app/api/health](https://shserver-production.up.railway.app/api/health).
   It should say `"auth":"google"`. If it doesn't mention `auth` at all,
   an older version is still running: in the **shserver** service press
   **Cmd+K** (Mac) or **Ctrl+K** (Windows), type **Deploy Latest Commit**
   and choose it.
2. Open the app. It shows **Sign in**; tap **Sign in with Google** and pick
   your account. You land back in the app, and **You** (in the Menu) shows
   your name.
3. On an iPhone, sign in from the home-screen app itself, not Safari: the
   two keep separate cookies.

If Google says the redirect doesn't match, the address in step 1.4 has a
typo. If the app says the account "isn't set up for Session Hire", it isn't
a sessionhire.com Workspace account and isn't in `STAFF_EMAILS`.

## 4. Connect Google Calendar

**Writing is off for now.** Colly asked on 16 October 2026 that the app
write nothing to Google Calendar and contact nobody yet. Until the
**shserver** service has the variable `CALENDAR_WRITES` set to `on`, the app
connects to a calendar and reads it (so step 6 works), but puts nothing on
it, changes nothing, invites nobody, and Admin says so. The health page then
shows `"calendar":"read-only"`. Steps 4.3 to 5 below describe how it works
once writing is switched on.


1. Choose the Google account that will write the jobs, and its calendar.
   The events are organised by that account, as they are by the ops staff
   today. For a first try, use your test calendar. If it belongs to a
   different account from the one connecting, share it with that account
   in Google Calendar first, with **Make changes to events**.
2. In the app, open the **Menu**, then **Admin**, and tap **Connect Google
   Calendar**.
   Pick the account and allow both things Google asks: seeing the list of
   calendars, and changing events.
3. Back in the app, pick the calendar and tap **Use this calendar**. Within
   seconds every day of every confirmed job, from today on, is on it, and
   each job's page says for each phase whether its days are on the
   calendar.
4. Try it: rename a job or move a phase, and the calendar follows within
   seconds. Change or delete one of the app's events in Google Calendar,
   then tap **Check the calendar** on Admin: it is put back (each night
   this happens by itself).

**Change calendar** on Admin moves the app's days from today on
to another calendar; **Disconnect** takes them off and hands the app's
access back to Google. Days before today stay where they are in both cases.

If Admin says the Google Calendar API is switched off, do step
1.5, then tap **Check the calendar**.

## 5. Crew invites: try them on the test calendar first

With crew invites on, everyone offered a place on a confirmed job, or
booked on it, who has an email address in the app, gets a Google Calendar
invite to its days from the connected account, and their Yes or No there
counts as their answer, as on their private link. Each invite is an email
to a freelancer, so the switch starts off. To see it as a freelancer would
before using it for real:

1. With the test calendar connected (step 4), add a confirmed job for next
   week and ask for crew for it.
2. In the **Crew** tab, add two or three people from the office as
   freelancers, with their own email addresses, and offer them the job.
3. On **Admin**, under **Crew invites**, tap **Turn on crew
   invites**. It first says how many invites go out and who has no email
   address; tap OK.
4. Each person gets Google's invite email, and the days appear in their
   calendar. Answer Yes on one and No on another. Within a couple of
   minutes the job page shows each answer, the **Crew** tab lists the Yes
   under **Answers to check**, and the **History** tab shows them as their
   own answers, on Google Calendar.
5. Tap **Turn off crew invites** when done. Nothing more is sent; the
   people invited keep their invites as they are.

## 6. Bring in the jobs already on the calendar

The app reads the jobs on any calendar the connected account can see and
brings them in, after showing everything that would come in. It never
writes to that calendar and never emails anyone, so it is safe to try on
the organisers' own calendars.

1. With a calendar connected (step 4), open the **Jobs** tab and tap
   **Bring them in** (it is on Admin too, and in the Menu as **Bring in from Google
   Calendar**).
2. Pick the calendar. The connected account's own is first. For another
   organiser's, they share theirs with that account first: in Google
   Calendar, the calendar's **Settings and sharing**, **Share with specific
   people or groups**, the connected account's address, **See all event
   details**.
   It is listed once it shows under **Other calendars** in that account.
3. Pick the first day (by default three months back; days gone come in
   too, as the record of who worked what) and tap **Look at the
   calendar**. Nothing is saved yet.
4. Check what was found: untick anything that isn't a job, rename a job,
   or give two the same name to bring them in as one, and choose which
   people on the invites to add to the crew list. **What was left out, and
   why** lists meetings, repeating events and the like.
5. Tap **Bring in**. The History tab says who brought in what. Looking
   again later shows only what is new, and lists events deleted or moved
   in Google since.

Jobs brought in stay on the calendar they came from, so the app doesn't
put them on the jobs calendar as well; change them in Google as today, and
in the app to match.

Worth knowing before turning it on for **Session Hire Gigs**:

- Invites come from the connected account, so it should be the one crew
  already get invites from. Google can hold back invites from a sender
  someone hasn't heard from before until they answer the email.
- The connected account gets Google's own emails when someone answers, as
  the ops staff do today. They can be turned off in that account's Google
  Calendar settings: under the calendar, **Other notifications**, **Event
  responses**.
- A No in Google from someone the office has already confirmed doesn't
  unbook them: the job page and the Crew tab say so, for the office to
  phone them.
- To take someone off a job, withdraw their offer in the app. A guest
  removed by hand in Google is put back at the next check while their offer
  stands.
- Disconnecting the calendar turns invites off, and the crew invited are
  told their days are cancelled.

## 7. Clear the made-up data

Everything in the app so far is made up, and every screen says so beside its
name. Trying the calendar, invites and bringing jobs in (steps 4 to 6) on
the made-up data is fine. When the office is ready to put real work in:

1. On **Admin**, tap **Disconnect** on the Google Calendar card. Start fresh
   won't run while a calendar is connected, so the made-up jobs' days come
   off it first.
2. Still on **Admin**, tap **Start fresh** and type the words it asks for
   ([Decision 0019](adr/0019-made-up-data-and-starting-fresh.md)). It
   deletes every job, person, product and the history, on the server and
   on every device, and can't be undone. Who can sign in is kept, so nobody
   signs in again.
3. Connect the real calendar (step 4), and bring in the jobs already on the
   organisers' calendars (step 6).

## 8. Switch roles on

Until someone is made a director, everyone signed in can change everything
([Decision 0034](adr/0034-roles-and-what-each-can-change.md)). Roles live
on the people on the Crew tab, so Start fresh clears them: do this after
step 7, before the rest of the office signs in.

1. On the **Crew** tab, add each member of staff as staff, with the Google
   address they sign in with. Anyone signed in whose address isn't on a
   person counts as staff crew.
2. Signed in yourself, open **You** and tap **Switch roles on**. You become
   the director.
3. On the **Crew** tab, give the office, heads of department and warehouse
   their roles on their own person.

Whoever keeps building and setting the app up goes in `SYSTEM_ADMINS`
(step 2) before handing the directing over: an address there can change
everything whatever their role, and nobody can take that away in the app.

## Good to know

- Google is the only way in for staff (ADR 0052). A member of staff's own
  page (their link) asks for their Google sign-in too; freelancers' links
  still open on their own, and so does every calendar feed.
- A session lasts 400 days after the device was last used, renewed each
  day it is used, so staff stay signed in until they sign out or are
  switched off. Signing out (on You) also clears that device's copy of the
  data.
- Once anyone has signed in, the server won't start without the two Google
  variables, so they can't go missing unnoticed. To run without sign-in on
  purpose, set `AUTH_MODE` to `open`.
- A demo copy with made-up data can be locked before Google is set up:
  set `DEMO_PASSCODE` (at least 12 characters, such as three words
  joined by hyphens; under 8 is refused, and under 12 starts with a
  warning in the log) on that copy's server, and
  it asks for the passcode instead of a Google account. After ten wrong
  passcodes from one address in a quarter of an hour, that address is
  turned away until the quarter of an hour is up. Freelancers'
  private links still open without it. Changing the passcode locks every
  device out until they enter the new one. Once the Google variables are
  set, the passcode is ignored and Google decides who gets in.
- Bringing jobs in (step 6) only reads the calendar: nothing is written
  to Google and nobody is emailed.
- The calendar gets crew by name only: rates and phone numbers stay in
  the app. Emails are used only for crew invites (step 5), which start
  off, and crew can't see each other's addresses.
- The app's access to the calendar is kept locked with the Client secret.
  If the secret is ever replaced in Railway, Admin asks for the
  calendar to be connected again; nothing is lost.
