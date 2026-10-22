# ADR 0073: A job's steps, and who has each

- **Status:** accepted
- **Date:** 22 October 2026
- **Asked for by:** Colly, 22 October 2026 ("On each jobs page it would be
  good to get a linear flow illustrating the steps each job goes through
  from quote to deprep back in the warehouse. At each step can they be
  assigned to different staff members to be updated on their to do list.")
- **Builds on:** [ADR 0059](0059-a-job-page-in-parts.md) (the job page),
  [ADR 0042](0042-quotes-prices-and-a-money-view.md) (quotes),
  [ADR 0017](0017-pick-lists-and-scanning-out-and-in.md) and
  [ADR 0072](0072-picking-on-the-phone.md) (pick lists),
  [ADR 0034](0034-roles-and-what-each-can-change.md) (roles),
  [ADR 0058](0058-notifications.md) (notifications) and
  [ADR 0048](0048-messages-to-crew-off-until-said.md) (nobody is contacted).

## Context

A job passes through several hands between the quote and the kit being
put away again: the office quotes and books, heads plan crew and kit, the
warehouse picks, loads and deprepped. Nothing on the job page said where a
job had got to or whose turn it was, so it lived in people's heads and in
messages. Most of the steps are already visible in the app's own records
(a quote sent, every call booked, the kit scanned out and back); a few
are only known to the person doing them (the kit list settled, the deprep).

## Decision

- **One list of steps for every gig and dry hire, in order:** Quote sent,
  Confirmed, Crew booked, Kit and vans, Picked, On the job, Back in,
  Deprepped. Errands and meetings have none; a cancelled or lost job's
  steps are stopped (names and ticks can still come off).
- **The app ticks what it can tell, afresh each time, on the device:**
  Quote sent (a quote marked sent or answered, or the job quoted or
  confirmed); Confirmed (the job confirmed, or the client's yes on the
  quote); Crew booked (every person needed confirmed on every day);
  Picked (everything on the kit has gone out, counting what's since come
  back); On the job (its last day has passed); Back in (something went
  out and nothing is still out, saying how many are missing). Crew on a
  dry hire with none asked for is "Not needed". Kit and vans and
  Deprepped are ticked by hand. Any step not ticked by the app can be
  ticked by hand, as work happens outside it too. Until done, each says
  how far along it is ("1 of 3 booked", "24 of 40 out").
- **A step is given to one member of staff** (not a freelancer, not
  archived or erased), or to nobody. A tick by hand records when and who:
  the signed-in person, or with sign-in off whoever the device says.
- **Kept:** a `job_steps` row per job and step that has been given or
  ticked (`<job>.<step>`), in its own module (`steps_schema_version`). One
  command, `jobStep.set`, changes only what it names.
- **Who changes them:** a new ability, `steps`: directors, the office and
  heads change any step; staff crew only a step that's theirs (tick it,
  take the tick off, or hand it on); freelancers none.
- **Where it shows.** On the job page under the summary, a line of eight
  dots joined by a rule, each with its name and who has it (dots alone on
  a phone); done is quiet grey with a tick, the step the job is at is in
  full ink with a ring (`aria-current="step"`), steps to come are
  outlined. The step picked opens below: what done means, how far along it
  is, who it's down to (a list of staff, "Give it to me"), its tick, and a
  link to the part of the job or the pick list where the work is.
- **Each person's to-do list:** on Home, "Your steps": on Me all of them,
  on the other views the ones each job is at now (up to five), on top.
  Each opens its job.
- **Told in the app only.** A step given to you, or changed by someone
  else while it's yours, is in your Notifications (and its job's changes
  too). Nothing is emailed, texted or messaged (ADR 0048).

## Design

- One job of the view: where is this job, and whose turn is it.
- Behaviour: Goal Gradient (a line filling in towards the end), and
  Default Effect kept honest: the app's own ticks come from records and
  can't go stale; nothing is assumed done.
- The design system's infographic steps (`ds-info__steps`) and tabs, as
  sess-sys's own markup: the current step drawn in ink rather than the
  accent, as sess-sys's red means "you" and the selected tab.
- Heuristic check: no 3s left. A 2: on a phone the names show only for the
  step opened below; the dots carry numbers and their spoken names.

## Consequences

- Taking a calendar bring-in back is refused once a step on its jobs has
  been given or ticked; jobs and people made one carry their steps
  (a job keeps one of each, its own first).
- Not done, for later if wanted: steps per company (adding or renaming
  them), due dates on steps, and a list of every step by owner for the
  office.
