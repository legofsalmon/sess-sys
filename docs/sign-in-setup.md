# Switching on staff sign-in and Google Calendar

Sign-in ([Decision 0003](adr/0003-staff-sign-in.md)) and putting confirmed
jobs on Google Calendar ([Decision 0008](adr/0008-calendar-sync.md)) are
built, and both switch on as soon as the app server has a Google key. Making
the key takes about ten minutes in Google Cloud, once. Connecting the
calendar then takes a minute in the app (step 4).

**Before you start:** the secret you create is a password for the app.
Paste it only into Railway, never into a chat or an email.

## 1. Make the Google key

1. Go to [console.cloud.google.com](https://console.cloud.google.com),
   signed in with your **sessionhire.com** Google account if you have one.
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
     connection lapse after seven days, and the Account tab then asks for
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
| `STAFF_EMAILS` | Only if people outside sessionhire.com should sign in (for example a tester): their Google addresses, separated by commas |

Railway then asks to deploy the change; let it.

## 3. Check it

1. Open
   [shserver-production.up.railway.app/api/health](https://shserver-production.up.railway.app/api/health).
   It should say `"auth":"google"`. If it doesn't mention `auth` at all,
   an older version is still running: in the **shserver** service press
   **Cmd+K** (Mac) or **Ctrl+K** (Windows), type **Deploy Latest Commit**
   and choose it.
2. Open the app. It shows **Sign in**; tap **Sign in with Google** and pick
   your account. You land back in the app, and the **Account** tab shows
   your name.
3. On an iPhone, sign in from the home-screen app itself, not Safari: the
   two keep separate cookies.

If Google says the redirect doesn't match, the address in step 1.4 has a
typo. If the app says the account "isn't set up for Session Hire", it isn't
a sessionhire.com Workspace account and isn't in `STAFF_EMAILS`.

## 4. Connect Google Calendar

1. Choose the Google account that will write the jobs, and its calendar.
   The events are organised by that account, as they are by the ops staff
   today. For a first try, use your test calendar. If it belongs to a
   different account from the one connecting, share it with that account
   in Google Calendar first, with **Make changes to events**.
2. In the app, open the **Account** tab and tap **Connect Google Calendar**.
   Pick the account and allow both things Google asks: seeing the list of
   calendars, and changing events.
3. Back in the app, pick the calendar and tap **Use this calendar**. Within
   seconds every day of every confirmed job, from today on, is on it, and
   each job's page says for each phase whether its days are on the
   calendar.
4. Try it: rename a job or move a phase, and the calendar follows within
   seconds. Change or delete one of the app's events in Google Calendar,
   then tap **Check now** on the Account tab: it is put back (each night
   this happens by itself).

**Change calendar** on the Account tab moves the app's days from today on
to another calendar; **Disconnect** takes them off and hands the app's
access back to Google. Days before today stay where they are in both cases.

If the Account tab says the Google Calendar API is switched off, do step
1.5, then tap **Check now**.

## Good to know

- Anyone signed in can do everything for now; roles come later.
- A session lasts 60 days after the device was last used. Signing out (the
  Account tab) also clears that device's copy of the data.
- Once anyone has signed in, the server won't start without the two Google
  variables, so they can't go missing unnoticed. To run without sign-in on
  purpose, set `AUTH_MODE` to `open`.
- The calendar gets crew by name only: rates, phone numbers and emails
  stay in the app. Nobody is invited to anything yet; crew invites come
  next, behind a switch that starts off.
- The app's access to the calendar is kept locked with the Client secret.
  If the secret is ever replaced in Railway, the Account tab asks for the
  calendar to be connected again; nothing is lost.
