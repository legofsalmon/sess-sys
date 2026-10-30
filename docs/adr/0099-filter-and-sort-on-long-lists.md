# ADR 0099: Filter and sort on the long lists

- **Status:** accepted
- **Date:** 30 October 2026
- **Asked for by:** Colly, 30 October 2026: "Can we add a filter and sort
  system for the long lists like crew/quotes/jobs etc?"
- **Changes:** the lists' searches and filters in
  [ADR 0007](0007-jobs.md) (Jobs), [ADR 0025](0025-crew-profiles-and-bringing-in-the-list.md)
  (People by department), [ADR 0041](0041-where-things-live.md) (Clients and
  Venues), [ADR 0075](0075-dry-hire-stock-and-the-rack-designer.md) (ours or
  dry hire) and [ADR 0088](0088-quotes-in-the-sidebar.md) (Quotes). Keeps
  [ADR 0050](0050-long-lists-drawn-in-a-window.md)'s windowed drawing.

## Context

Each long list had grown its own way of being narrowed, and none could be
put in another order. Jobs had a search and Coming up · Past · Not going
ahead; Quotes a search and a row of statuses; People a search and a
department select; the catalogue department chips and a second row of
Ours · Dry hire chips; Venues only a search; Clients nothing. With 900 jobs,
90 people and 300 products in the live app, "which confirmed jobs still
need crew", "who are our level 4 freelancers", "which quotes are the
biggest" or "which venues aren't on the map" each meant scrolling and
reading.

The design system says a long list gets a filter at the top, not pages
(navigation.md, "Lists in chunks"), and has `filter` and `sort` icons, but
no part for the two together.

## Decision

1. **One shared part, under each list's search** (`web/src/ListTools.tsx`,
   the rules in `shared/src/lists.ts`): a **Sort** select, and a
   **Filter** button that opens a select for each filter. Each list keeps
   its search and its one main choice as it was (Jobs' Coming up · Past ·
   Not going ahead, Quotes' statuses, the catalogue's departments): those
   are the list's tabs, what it's about; the filters narrow inside them.
2. **A filter that's on says so twice** (the system's "a mode shows
   itself twice", Loss Aversion: nothing should look missing): the button
   reads "Filter (2)", and under it each filter is a chip that takes it off,
   with "12 of 140 jobs." and Clear filters. So a list that looks short
   always says why, open or shut.
3. **Each choice says how many it would show**, with the other filters
   and the search as they are ("Confirmed (12)"), so a choice with nothing
   in it is known before it's picked.
4. **What each list offers**, picked for what the office asks of it:
   - **Jobs:** by date (soonest first coming up, newest first in the past),
     name, client, most crew still needed. Filters: status, kind, crew
     (still needed, to confirm, all booked, none asked for), kit short.
     Week headings only while it's by date; any filter, search or other
     order looks past the next fortnight.
   - **Quotes:** last changed, job soonest or newest, biggest total,
     client. Filters: when the job is (coming up, past, no dates) and
     whether it has lines. The quotes from Current RMS stay newest first
     below, by the same search and status: they're kept on the server.
   - **People:** first name, last name, department, highest level, most
     booked ahead. Filters: department (the ones in use, and none), staff
     or freelancer, level (the ones in use). A count on Home for a
     department still opens it narrowed, now as the filter's chip.
   - **The catalogue:** name, category, most or fewest in stock,
     department. Filters: ours or dry hire (once there's any), category
     (the ones in use), some or none in stock. Department stays the chips.
   - **Venues and Clients:** name, most jobs, most recent job. Filters:
     jobs (coming up, any, none), documents, and for venues whether it's
     on the map. Clients get a search by name or contact.
5. **Kept for the tab's life, the order on the device.** Back from a job
   finds the same choices (places.ts). The order is kept on the device
   (`sh.sort.<list>`), as how someone reads a list rarely changes; filters
   are not, so a list opened another day starts whole rather than missing
   something nobody remembers narrowing.
6. **Calls stay as they are.** The Calls page is a queue of what's short,
   by job and by date, with its department choice (ADR 0046); another
   order would hide what's soonest.

## Consequences

- Six lists narrow and order the same way, by the same words and keys.
- A select per filter on a phone opens the phone's own picker: big
  targets, every choice with its count, nothing new to learn.
- Ties keep the list's own order, so a sort never shuffles equal rows.
- The People department select and the catalogue's Ours · Dry hire chips
  move behind Filter; the browser tests say so.
- Unit tests (`shared/test/lists.test.ts`) and a browser test
  (`e2e/lists.spec.ts`) cover the orders, the filters, the counts, the
  chips and Back.
