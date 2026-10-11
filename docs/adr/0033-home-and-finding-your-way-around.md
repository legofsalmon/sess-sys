# ADR 0033: Home, and finding your way around

- **Status:** accepted
- **Date:** 11 October 2026
- **Asked for by:** Colly, 11 October 2026

## Context

Colly asked for a look at the app as each kind of person would use it
(directors, heads of department, freelancers, warehouse staff), and said
two things about the app on a phone: there's no feel for how it is laid
out, as every screen looks the same, and there's nowhere that gives an
overview of how things stand.

Both were true. The bar had five tabs of equal weight (Jobs, Stock, Crew,
History, Account), each a long column of cards. Crew ran to more than five
phone screens with seven cards; Stock had eight. The area's name was a
small grey word under the brand, and nothing said what was further down a
screen without scrolling to it. To know whether the week was all right, a
director had to open three tabs and read each to the bottom.

The personas, the flows they follow and the problems rated are in
[personas.md](../personas.md).

## Decision

1. **Home, first in the bar.** One screen, shown for *the company*, *a
   department*, *the warehouse* or *me*:
   - **Company:** today's jobs with their crew, the counts that need
     someone across every area, the week ahead, and how many jobs are
     confirmed against enquiries and quotes.
   - **Department:** the same counts narrowed to the department's people
     (by the department on their profile, ADR 0025) and its kit (by the
     matching stock department), who in it is working this week, and who
     is away.
   - **Warehouse:** what's going out in the next week with how much is
     out, the counts that are kit, and what's still to come back.
   - **Me:** my bookings, my leave, and for an approver, the time off
     waiting on them.

   It starts on the person's own department when their profile has one,
   or else on the company, and the phone remembers the choice (a
   warehouse phone stays on the warehouse). The bare address and `#home`
   open it.

2. **A count that is nothing isn't shown.** Healthy is quiet: the few that
   aren't nothing stand out, and when all are, Home says so in a line.
   Each count opens the screen that sorts it out. Counts that stop work
   (kit still out after a job, kit short on a confirmed job, a fault that
   stops kit going out, an item that can't go out until tested) have
   their number in the bad colour; the rest are neutral.

3. **Five places, each with a picture and a word:** Home, Jobs, Stock,
   Crew, Admin. History moved under Admin, which is Account renamed, as
   both hold things used now and then. A phone's bar holds five before
   anything has to hide behind a menu, which people use about half as
   often. Account keeps its address, `#account`, and History keeps
   `#history`, so links and bookmarks still work.

4. **An area's own screen has its name as its title**, large, under the
   bar; a record's page keeps its own title and the way back. History
   gets "‹ Admin".

5. **On this screen.** In the bar, a strip of the screen's parts by name,
   with each heading's count, scrolling sideways on a phone. A tap scrolls
   to the part and puts the focus on its heading; the part in view is
   marked as the screen scrolls. It is built from the cards on the screen,
   as the Shell already finds each screen's heading, so a new card joins
   it without being listed anywhere. A screen of one or two parts has no
   strip.

6. **A freelancer's page says what's waiting first**: a line at the top,
   "1 offer to answer · 1 timesheet to send · Next: Harbour Lights
   Festival, Wed 14 Oct, call 08:00", each part a link down the page.

7. **The demo copy opens on "See it as…"** (Colly, the same day): the six
   personas, each saying who they are and what they look at first. Picking
   one opens the app where that person starts (Home for the company, a
   department or the warehouse, Crew for the office, Home for me as a
   member of staff with bookings) or, for a freelancer, a made-up
   freelancer's own page. A bar on every screen says whose eyes these are,
   with **Choose someone else** back to the choice; the freelancer's page
   has the same bar. Only on the passcode-locked demo (PR #61), never on
   the live app. The choice is kept on the device (`sh.preview`). It
   doesn't hide any tab, since there are no roles; the choice says so.

## Considered

- **A tab for each part of an area** (Stock: Catalogue, Pick lists,
  Faults…), one part at a time. Truer to "one view, one job", but it hides
  what isn't on the current tab, would nest tabs under the bar, and moves
  every card a person has learned. The strip gives the map without taking
  anything off the screen. Worth revisiting for Crew if the strip isn't
  enough in the office trial.
- **A sixth tab for History.** Six won't fit a phone's bar with words.
- **Roles that decide what Home shows.** There are no roles or
  permissions yet, and inventing them for a dashboard would be a lock
  that isn't one. Home is a view anyone can switch; the default comes
  from their profile.

## Consequences

- Crew calls have a role but no department, so a department's Home can't
  narrow *crew still needed*; it says so. A department on each call is
  the next step.
- The phone's choice of view is stored on the phone (`sh.home`), not
  synced: it's a convenience, like the folds, not data.
- Every screen built from cards gets the strip for nothing. A card with
  a heading that reads badly as a short label shows up as it is.
