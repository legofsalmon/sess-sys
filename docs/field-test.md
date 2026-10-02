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
address to the people testing, and use made-up jobs and kit only. To have
plenty to look at, tap **Put in made-up data** on the Account tab first:
every screen then says "made-up data" beside its name.

## Set up

1. On the phone, open **shserver-production.up.railway.app** and add it to
   the home screen. iPhone: Share, then Add to Home Screen. Android: the ⋮
   menu, then Install app. From now on, open it from the home screen icon.
2. On the laptop, open the same address in a browser.
3. The app opens on **Jobs**. This test uses **Stock**. On the laptop,
   tap Stock at the bottom, then **Add product**: call it "Test
   speaker", tap **Counted**, and add it. On its page, under **Add a
   count**, count 4 at "Bay T1" and tap **Make the place** when it asks.
4. On the phone, tap Stock and open Test speaker. It shows 4 at Bay T1.

## The test

| Step | Where | Do this | You should see |
|---|---|---|---|
| 1 | Phone | Turn on flight mode, or walk into your worst dead spot | The top pill says "No signal" |
| 2 | Phone | Close the app fully, open it again from the icon, then tap Stock and open Test speaker | It opens anyway, with 4 at Bay T1 still showing |
| 3 | Phone | Beside Bay T1, tap **Move some**: 4, to "Van T1" (make the place) | 4 at Van T1, marked "Waiting to sync" |
| 4 | Laptop | Beside Bay T1, tap **Move some**: 4, to "Van T2" (make the place) | 4 at Van T2, and "Up to date" |
| 5 | Phone | Turn flight mode off | Within a few seconds: "1 not done" at the top; tapped, it says "Move 4 × Test speaker to Van T1" and why ("Only 0 × Test speaker counted at Bay T1"), and the 4 show at Van T2, as on the laptop |

## Worth noting

- How long step 5 took to catch up.
- Anything that looked wrong, slow or confusing, with a screenshot if you
  can.
- Whether the phone ever showed something different from the laptop once
  both had signal.

Send the notes to Claude in the project thread. When you're done, clear
everything on the Account tab: open **Start fresh**, type "delete
everything" and tap **Delete everything**. Every phone empties itself, and
the app is ready for the real data.
