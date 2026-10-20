# ADR 0069: To sort out, from today on

- **Status:** accepted
- **Date:** 20 October 2026
- **Asked for by:** Colly, 20 October 2026 ("On the jobs screen I'm getting
  a warning 'To sort out' for a crew gap that's in the past. Can these flags
  be set to only show when it's for today or the near future? Also would
  these notices be also pertinent in the notifications centre")

## Context

The planner's "To sort out" card ([Decision 0010](0010-planner.md)) listed
every clash and check on the days on screen, so this week's Monday still
asked to be sorted on Thursday. Nothing can be done about a day gone, and a
list that is always partly stale teaches the office to stop reading it.
The notification centre ([Decision 0058](0058-notifications.md)) shows
changes others made, but not the clashes still waiting on someone.

## Decision

- **Days gone leave the list.** `plan()` leaves clashes and checks before
  today out of `problems` and `vanProblems`. The day's cell in the week or
  month still shows what happened, as history. A week or month ahead still
  lists its own, since the office went there to look.
- **The notifications show the next four weeks.** For anyone who can change
  crew (heads, office, directors, system admins), a "To sort out" card tops
  the Notifications list with clashes and checks from today to 27 days on
  (`SORT_OUT_DAYS = 28`, `sortOutDays(today)`). Four weeks is about how far
  ahead crew are being found and offered; further out is still pencilled.
  It is the planner's own card (`SortOut`), worked out on the device from
  the synced copy, so it shows without signal and goes as soon as it's
  sorted. In the app only, as the rest of the centre: nobody is contacted.
- **The bell's count is unchanged.** It counts changes not yet read; a
  clash stays until it is sorted, so counting it would keep the badge on
  and make it mean nothing (Loss Aversion is the wrong pull for a standing
  list).

## Design

- One job: show what still needs sorting, while it still can be.
- Behaviour designed for: crew and office scan the list for what to act on
  (Time Scarcity: only what still has time left is asked of them).
- Heuristics: match with the real world (a past day isn't a task), and
  aesthetic and minimalist design (nothing stale on the list). No 3s left
  open.
- Uses the existing card, pills and row; no new parts.
