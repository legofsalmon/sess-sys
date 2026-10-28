# ADR 0089: Timesheets are off until the company uses them

- **Status:** accepted
- **Date:** 28 October 2026
- **Asked for by:** Colly, 28 October 2026 ("Can you make timesheets a toggle
  in the admin area? I don't think we'll need it for day 1 but might need it
  in the future")
- **Builds on:** [ADR 0022](0022-timesheets.md) (timesheets),
  [ADR 0048](0048-messages-to-crew-off-until-said.md) (the same kind of
  company-wide switch, for messages to crew)

## Context

Timesheets ([ADR 0022](0022-timesheets.md)) let a freelancer send the days
they worked and their extras from their private link, and the office check
and approve them under Crew › Timesheets. Session Hire won't use them on day
one: crew are paid from the office's own records for now. Left on, every
freelancer page asks "1 timesheet to send" after each booking, Home counts
timesheets to approve that nobody will approve, and Crew's row has a page
the office has no use for. Each is noise on a screen used all day, and the
freelancer one asks a person outside the company to do work that goes
nowhere.

## Decision

1. **One company-wide setting, "timesheets", with `useTimesheets` to it,**
   beside the office's details, what heads read and messages to crew. The
   command `timesheets.use { on }` needs the `settings` ability (the office
   and directors, [ADR 0034](0034-roles-and-what-each-can-change.md)). It
   goes in the history as "Turned on timesheets" or "Turned off timesheets".
   The card is under Admin › Company, after Messages to crew.
2. **Off is the default.** No row means off, so this company starts without
   them on deploy, and so does a fresh one (Default Effect: the default is
   what a company on day one wants, and on is one switch away). Made-up
   data turns them on, so the demo still shows them.
3. **While off they're hidden everywhere, and nothing is deleted.**
   - Crew's row has no Timesheets page; the Menu doesn't list it; Home has
     no "timesheets to approve" count.
   - `#crew/timesheets`, or an old timesheet's address, opens a card that
     says timesheets are off, that any already sent are kept, and where
     they're turned on (a link to Admin › Company for those who can).
   - A freelancer's page has no Timesheets section and no "to send" in its
     glance line; their timesheet page answers 404, and a post to it is
     turned down with a plain message and keeps nothing.
   - Notifications leave out timesheets' changes.
   - Money's "Owed to freelancers" is from approved timesheets: it's left
     out while off, unless some approved are still to pay.
4. **What stays.** The table, the commands, the export and erasing a person
   are as they were. Turning them back on brings every timesheet back as it
   was. The office's app doesn't refuse a timesheet command while off: one
   queued on a phone before the switch still lands, and is simply not shown.

## Considered

- **Taking timesheets out of the build.** Colly may need them later, and
  they're tested and working; a switch costs one setting.
- **Refusing timesheet commands on the server while off.** A change queued
  offline before the switch would come back refused for no reason the person
  could see. Hiding the ways in is enough: the links refuse, which is the
  only way in from outside the company.
- **A switch per person or per department.** Nobody asked; one mode.
