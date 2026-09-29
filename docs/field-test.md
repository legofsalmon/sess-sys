# Phone field test

The Phase 0 promise, tried for real: the app keeps working with no signal,
and when the signal comes back it sorts out clashes with a plain reason
instead of losing or doubling anything. This takes about ten minutes with
one phone and one laptop (or two phones).

**Before you start:** open
[shserver-production.up.railway.app/api/health](https://shserver-production.up.railway.app/api/health).
It should say `"db":"postgres"`. If it says `memory` or has no `db` at all,
stop and tell Claude: anything entered would be lost on the next restart.

The app has no sign-in yet, so anyone with the address can use it. Keep the
address to the people testing, and use made-up jobs and kit only.

## Set up

1. On the phone, open **shserver-production.up.railway.app** and add it to
   the home screen. iPhone: Share, then Add to Home Screen. Android: the ⋮
   menu, then Install app. From now on, open it from the home screen icon.
2. On the laptop, open the same address in a browser.
3. The app opens on **Jobs**. This test uses **Stock**, so tap Stock at
   the bottom on both.

## The test

| Step | Where | Do this | You should see |
|---|---|---|---|
| 1 | Laptop | Add a product, e.g. "d&b Y10P", quantity 4 | "4 of 4 free" on both devices within a second or two |
| 2 | Phone | Turn on flight mode, or walk into your worst dead spot | The top pill says "No signal" |
| 3 | Phone | Close the app fully, open it again from the icon, then tap Stock | It opens anyway, with the stock still showing |
| 4 | Phone | Book 4 of the product for a job called "Fuel" | The booking shows "Waiting to sync" |
| 5 | Laptop | Book the same 4, same day, for a job called "Nissan" | "Confirmed" |
| 6 | Phone | Turn flight mode off | Within a few seconds: "Needs attention: Not booked", with the reason, and Nissan in the list |

## Worth noting

- How long step 6 took to catch up.
- Anything that looked wrong, slow or confusing, with a screenshot if you
  can.
- Whether the phone ever showed something different from the laptop once
  both had signal.

Send the notes to Claude in the project thread. Test data can be cleared
before real use.
