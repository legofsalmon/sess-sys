# ADR 0014: Kit on jobs, with shortages

- **Status:** Accepted, 30 September 2026. The second part of Phase 2.
- **Decides:** how a job says what kit it needs, how the app works out
  whether there's enough, and what happens when there isn't, before pick
  lists and scanning build on it.

## Context

The catalogue ([ADR 0013](0013-warehouse-catalogue.md)) knows what Session
Hire owns: numbered items in stock plus what's counted. Jobs
([ADR 0007](0007-jobs.md)) have phases of whole days. Phase 2 needs the two
joined: "equipment lines on projects, with live availability and shortage
warnings, including subhire lines" ([roadmap](../roadmap.md)).

Three things shape how:

- **The stock list starts empty and fills over weeks** as the warehouse
  counts and labels. For a while, "not enough" will often mean "not
  counted yet".
- **Planning often runs ahead of the kit.** A job gets confirmed first and
  the shortfall is subhired or juggled after. The architecture's escape
  hatches say an availability warning is overridden with a note, not
  blocked ([architecture](../architecture.md), "Principle: open and
  flexible").
- **Two people can plan the same speakers onto two jobs with no signal.**
  Whatever the rule, it has to hold when both changes arrive later.

## Decision

- **A kit line** is a product and how many, on a job, for the whole job
  or for one of its phases, with an optional note ("spare", "side
  stage"). The code calls it a kit line; the architecture calls it an
  equipment line.
- **Its days.** A line for a phase covers that phase's days. A line for
  the whole job covers every day from the job's first phase to its last,
  gaps included, since kit sent to a site usually stays until the load
  out. A job with no phases has no days yet, so its kit takes nothing
  until it has some.
- **Which jobs take kit.** Confirmed jobs hold it. Enquiries and quotes
  are pencilled in: shown beside the confirmed ones, never counted as
  taken. Cancelled and lost jobs hold nothing; their lines stay for the
  record.
- **Short.** A line is short on a day when Session Hire owns fewer than
  it needs once the confirmed jobs on that day have theirs. The app says
  by how many, on which day, and who else has them: "Short 2 on Fri 3
  Oct: 10 owned, 8 on Electric Picnic". A line on an enquiry or a quote
  is checked the same way, as if it went ahead. A line with enough can
  still say "enough, unless the Fuel quote goes ahead" when the
  pencilled jobs on its days would use the rest.
- **Never refused for being short.** The server keeps the line as asked:
  the count may be unfinished, or someone is about to subhire. The
  shortage shows until it's sorted: subhire, fewer, other dates or
  another product.
- **Subhire.** A line can say how many of it are hired in from another
  company, and who from (typed, with suppliers already used suggested).
  Those don't come out of Session Hire's own stock. A short line offers
  to subhire the ones it's short.
- **Worked out on each device** from the jobs, phases, lines and stock
  list it already has, so it works with no signal and updates as other
  devices' changes arrive. Only days from today on are checked.
- **Where it shows.** The job page gets a Kit card: its lines by
  department, each with its state, and a form to add more (adding a
  product already on the job for the same days adds to that line). The
  jobs list flags jobs with kit short. The Stock tab lists every line
  short from today on. A product's page lists the jobs it's on, with
  what's free.
- **The server keeps the rules**, whichever device a change comes from:
  the job, the phase (of that job) and the product must exist; at least
  one of anything; no more subhired than the line needs, checked as the
  line will be when two people change it at once; a phase with kit on it
  can't be removed, as with crew; and a product on any job's kit can't
  be taken out of the stock list.

## Consequences

- A shortage is only as good as the stock list: until the counting is
  done, lines will show short that aren't. A product with nothing counted
  yet says so rather than just "short".
- Whole days, not hours: jobs are whole days (ADR 0007), so kit coming
  back from one job and going out to another on the same day counts
  twice. That errs towards a warning, which a person can read past.
- A case on a job doesn't yet take what's inside it (an amp rack's amps).
  List the contents as lines too if they matter; pick lists, next, will
  pack cases for a job.
- Items away for repair will come off what's owned when faults and
  inspections arrive, later in Phase 2.
- Pick lists and scanning out and in will work from the lines: numbered
  items scanned against their line, counted ones counted.
- Prices on lines come with quotes, in finance.
- Kit lists typed into the notes of jobs brought in from Google Calendar
  stay as notes. Turning them into lines can come once the stock list has
  the products to match them against.
- The Phase 0 sync test stays at the bottom of Stock until the phone field
  test ([field-test.md](../field-test.md)) is done, then goes.
