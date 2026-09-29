# Error alerts and uptime checks

The app reports its own faults to Sentry, which emails you: a fault on the
server or in the app on someone's phone, the server not answering, and a
nightly backup that failed or never ran
([Decision 0005](adr/0005-error-alerts.md)). Reports are built to leave
out anyone's details. It all switches on once the app server has a Sentry project's key,
set up once in about ten minutes on Sentry's free plan.

## 1. Make the Sentry account

1. Go to [sentry.io/signup](https://sentry.io/signup/) and sign up.
2. When it asks for the **Data Storage Location**, choose the **European
   Union**. The reports are then kept in Frankfurt. This can't be changed
   afterwards.
3. Name the organisation `session-hire`.

## 2. Make the project

1. For the platform, choose **Node.js**. The same project takes the reports
   from phones too.
2. Name the project `session-hire`. If it asks how you'd like to be
   alerted, choose to set up your own alerts later: step 5 makes one alert
   that covers everything. Create the project.
3. Sentry then shows its setup instructions, including a **DSN**: a web
   address like `https://1a2b3c…@o123456.ingest.de.sentry.io/789…`. Copy
   it. You can skip the rest of the instructions; the app already does
   that part. (To find the DSN again: **Settings**, **Projects**,
   `session-hire`, **Client Keys (DSN)**.)

## 3. Give it to the app server

In Railway, open the **shserver** service, then **Variables**, and add
`SENTRY_DSN` with the DSN as its value. Save, and let Railway deploy.

## 4. Add the uptime check

1. In Sentry, open **Monitors**, press **Create Monitor** and choose
   **Uptime**.
2. URL: `https://shserver-production.up.railway.app/api/up`, method
   **GET**.
3. Interval: **1 minute**. Leave the rest as it is: a 10 second timeout,
   and three failures in a row before it raises an issue.
4. Project `session-hire`, environment `production`. Name it
   `App server` and create it.

## 5. Get the emails

1. In Sentry, open **Monitors**, then **Alerts**, and press **Create
   Alert**.
2. Source: **Alert on all issues in selected projects**, then pick
   `session-hire`.
3. When: **A new issue is created**, and add **A resolved issue
   regresses** too.
4. Then: **Notify on preferred channel**, **Member**, and pick yourself.
5. Name it `Anything wrong` and save.

That one alert covers errors, downtime and the nightly backup, since all
three turn up as issues in the project.

## 6. Check it

1. Wait a minute, then open
   [shserver-production.up.railway.app/api/health](https://shserver-production.up.railway.app/api/health).
   It should say `"errors":"sentry"`.
   - `"errors":"off"` means the variable hasn't reached the server; check
     it was saved and deployed.
   - No mention of `errors` at all means an older version is still
     running: in the **shserver** service press **Cmd+K** (Mac) or
     **Ctrl+K** (Windows), type **Deploy Latest Commit** and choose it.
   - If the deploy fails, its log says what is wrong with the DSN.
2. In Sentry, the uptime check shows its first results within a few
   minutes.
3. The backup's monitor, `nightly-backup`, appears under **Monitors** by
   itself after the first backup the server makes on its own, once backups
   are on ([backups](backups.md)).

Optional, belt and braces: in Sentry, **Settings**, **Projects**,
`session-hire`, **Security & Privacy**, switch on **Prevent Storing of IP
Addresses**. The app already asks Sentry not to work them out.

## What you'll get

- An email when something goes wrong for the first time, and when
  something that was fixed goes wrong again. A fault that keeps happening
  is one issue in Sentry, with a count, not an email each time.
- An email when the app server has stopped answering for about three
  minutes, and Sentry closes the issue itself when it answers again.
- An email when a night's backup fails, runs for more than 30 minutes, or
  hasn't started by 03:00 UTC.
- Each issue in Sentry shows where in the code it happened, how often, on
  which version of the app, and on what kinds of device.

## What a report holds

Every report holds the error and where in the code it happened, which
version of the app, and what kind of device and browser (or the server's
own details). A report from the server names the route as the code writes
it, such as `/f/:token/away`, never the address that was used. A report from
a phone names the screen by its address, cut off before any `?` or `#`.

A report never holds who was using the app, what was on screen or
clicked, a request's body, headers, cookies or query, the values in the
code's variables, or an IP address. An error's own text can quote a value,
so email addresses and anything shaped like a freelancer's private link
are replaced in it by `[email]` and `[secret]`.

## Good to know

- Phones with no signal keep their reports, up to 30, and send them when
  the signal is back or the next time the app opens.
- The free plan has room for one person and 5,000 errors a month. A fault
  that floods past that has its later reports dropped until the month ends,
  but the email will already have gone out.
- The DSN is sent to every phone, as it must be for phones to report. It
  can only send reports to Sentry, not read them.
- For a trial copy of the app, set `SENTRY_ENVIRONMENT` to something like
  `trial` on that copy, so its errors are kept apart from the real app's.
- To switch reporting off, remove `SENTRY_DSN`. Phones stop reporting the
  next time they open the app with signal.
- The health check at `/api/health` still asks the database, and Railway
  uses it on each deploy. Sentry uses `/api/up`, which doesn't, so its
  checks every minute don't keep the database awake.
