# Backups

The app backs up everything every night, and proves each backup by
restoring it into a scratch copy before counting it
([Decision 0004](adr/0004-backups.md)). Backups switch on as soon as the app
server has somewhere to keep them: a Railway bucket, set up once in a few
minutes.

**Before you start:** the bucket's keys open all of the company's data.
They belong only in Railway's variables, never in a chat or an email. The
steps below use Railway's references, so you never copy the keys at all.

## 1. Make the bucket

1. Open the Session Hire project in Railway and press **Create** (the **+**
   on the canvas), then choose **Bucket**.
2. Region: **EU West (Amsterdam)**, the nearest to the database in
   Frankfurt. It can't be changed afterwards.
3. Name it `backups`. Railway adds a random ending to the bucket's real
   name; that's normal.
4. Create it. There is nothing else to set: buckets are private.

## 2. Give it to the app server

Open the **shserver** service, then **Variables**, then **Raw Editor**, and
add these five lines exactly as they are:

```
BACKUP_S3_ENDPOINT=${{backups.ENDPOINT}}
BACKUP_S3_BUCKET=${{backups.BUCKET}}
BACKUP_S3_REGION=${{backups.REGION}}
BACKUP_S3_ACCESS_KEY_ID=${{backups.ACCESS_KEY_ID}}
BACKUP_S3_SECRET_ACCESS_KEY=${{backups.SECRET_ACCESS_KEY}}
```

Each `${{backups.…}}` tells Railway to fill in the bucket's own value, so
the keys stay inside Railway. If you gave the bucket another name, use that
name in place of `backups`. Save, and let Railway deploy the change.

If the bucket's **Credentials** tab says to use path-style URLs (only older
buckets do), also add `BACKUP_S3_PATH_STYLE=true`.

## 3. Check it

1. Wait a minute, then open
   [shserver-production.up.railway.app/api/health](https://shserver-production.up.railway.app/api/health).
   It should say `"backups":{"last":"…","fresh":true}`: with no backup yet,
   the server makes the first one a minute after it starts.
   - `"backups":"off"` means the variables haven't reached the server;
     check they were saved and deployed.
   - No mention of `backups` at all means an older version is still
     running: in the **shserver** service press **Cmd+K** (Mac) or
     **Ctrl+K** (Windows), type **Deploy Latest Commit** and choose it.
   - If the deploy fails, its log names the setting that is missing.
2. In the app, the **Account** tab now has a **Backups** card saying when
   the last backup was made and how big it was, with a **Back up now**
   button.

## What happens each night

- At 02:00 UTC (3am in Ireland in summer, 2am in winter) the server copies
  every table into one file and puts it in the bucket. It then restores
  that file into a scratch database in its own memory and checks every
  table against the file's checksums. Only a backup that passes counts.
- If a backup fails, the server tries again each hour, up to three times,
  and the Backups card shows what went wrong.
- Backups are kept for 35 days, then the first of each month for a year,
  and never fewer than the newest seven.
- The health check's `fresh` turns `false` when the last good backup is
  more than 26 hours old. The uptime alert, next on the list, will watch it.
- Cost: Railway charges $0.015 per GB a month, and a year of backups at
  Session Hire's size is well under a gigabyte, so a few cents a month.

## Putting the data back

Use this if the database is lost or damaged, or to go back to how the data
was on an earlier night. It restores into a new, empty database, so the old
one stays untouched until you're happy.

1. Make a new, empty database the way the first one was made: in Vercel,
   **Storage**, **Create Database**, **Neon**, in Frankfurt. Copy its
   connection string.
2. In Railway, open **shserver**, **Variables**:
   - Set `DATABASE_URL` to the new connection string.
   - Add `RESTORE_FROM` with the value `latest`. To go back to a particular
     night instead, use that file's name as the bucket lists it, such as
     `backups/2026/09/session-hire-2026-09-29T020014Z.backup.gz`.
3. Let Railway deploy. The deploy log says **Restored the database from a
   backup**, with the file and the number of rows. If the file fails its
   checks, nothing is restored and the server doesn't start; the log says
   why.
4. Remove `RESTORE_FROM`. It does nothing once the database has data, but
   it's tidier gone.

After a restore:

- Everyone signs in again, once sign-in is on.
- Each phone and laptop notices the next time it syncs. It reloads its copy
  from the server, then sends again everything it changed in the last two
  weeks, so work done after the backup comes back from whichever devices
  did it. A device that is lost or signed out before it syncs can't send
  its changes back.

## Good to know

- A backup holds everything, including freelancers' contact details and
  private links. The file is plain text once unzipped, so treat a
  downloaded copy like the database itself.
- Any S3-compatible storage works instead of a Railway bucket (Backblaze
  B2, Cloudflare R2, Amazon S3): set the same variables to its address,
  bucket and keys.
- The address, bucket and both keys are all needed. With only some of them
  set, the server refuses to start, so a half-finished setup can't quietly
  skip backups. Remove them all to switch backups off.
- If the database is ever wound back with Neon's own history instead, run
  `new-generation` afterwards (below), so every device reloads its copy.
- For drills and emergencies, a developer can work with backups directly,
  using the same variables:
  `npm run backup -w server -- list`, `check latest` (restores into memory
  and touches no database), `download latest`, `restore latest` (into an
  empty `DATABASE_URL`) and `new-generation`.
