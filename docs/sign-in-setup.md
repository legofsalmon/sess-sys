# Switching on staff sign-in

Sign-in is built ([Decision 0003](adr/0003-staff-sign-in.md)) and switches
on as soon as the app server has a Google sign-in key. Making the key takes
about ten minutes in Google Cloud, once. Phase 1's calendar sync will use
the same Google Cloud project later.

**Before you start:** the secret you create is a password for the app.
Paste it only into Railway, never into a chat or an email.

## 1. Make the Google sign-in key

1. Go to [console.cloud.google.com](https://console.cloud.google.com),
   signed in with your **sessionhire.com** Google account if you have one.
2. In the project picker at the top, choose **New project**, call it
   **Session Hire**, and create it. Make sure it's selected afterwards.
3. Search for **Google Auth Platform** and open it, then **Get started**:
   - App name **Session Hire**, and your email as the support and contact
     email.
   - Audience: **Internal** if you're signed in with a sessionhire.com
     account. Only company accounts can then sign in, and Google doesn't
     need to review anything.
   - If Internal isn't offered (the account you're using isn't a
     sessionhire.com one), choose **External**, and afterwards add each
     person who should be able to sign in under **Audience**, **Test
     users**.
4. Go to **Clients**, **Create client**:
   - Application type **Web application**, name **Session Hire app**.
   - Under **Authorised redirect URIs**, add exactly:
     `https://shserver-production.up.railway.app/api/auth/google/callback`
   - Create. Copy the **Client ID** and the **Client secret** straight away;
     Google may only show the secret once.

## 2. Give it to the app server

In Railway, open the **shserver** service, then **Variables**, and add:

| Variable | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | The Client ID from step 1 |
| `GOOGLE_CLIENT_SECRET` | The Client secret from step 1 |
| `STAFF_EMAILS` | Only if people outside sessionhire.com should sign in (for example a tester): their Google addresses, separated by commas |

Railway then asks to deploy the change; let it. Then, still in the
**shserver** service, press **Cmd+K** (Mac) or **Ctrl+K** (Windows), type
**Deploy Latest Commit** and choose it. Railway isn't yet picking up new
code on its own, and deploying a change of variables only restarts the
version already running, which may not have sign-in yet.

## 3. Check it

1. Open
   [shserver-production.up.railway.app/api/health](https://shserver-production.up.railway.app/api/health).
   It should say `"auth":"google"`. If it doesn't mention `auth` at all,
   the older version is still running: do **Deploy Latest Commit** as in
   step 2.
2. Open the app. It shows **Sign in**; tap **Sign in with Google** and pick
   your account. You land back in the app, and the **Account** tab shows
   your name.
3. On an iPhone, sign in from the home-screen app itself, not Safari: the
   two keep separate cookies.

If Google says the redirect doesn't match, the address in step 1.4 has a
typo. If the app says the account "isn't set up for Session Hire", it isn't
a sessionhire.com Workspace account and isn't in `STAFF_EMAILS`.

## Good to know

- Anyone signed in can do everything for now; roles come later.
- A session lasts 60 days after the device was last used. Signing out (the
  Account tab) also clears that device's copy of the data.
- Once anyone has signed in, the server won't start without the two Google
  variables, so they can't go missing unnoticed. To run without sign-in on
  purpose, set `AUTH_MODE` to `open`.
