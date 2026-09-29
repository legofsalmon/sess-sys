# How Session Hire books work today

Read from the Google Calendars Colly can see on 2026-09-29 (58 events,
June to October 2026). Personal names and emails are left out on purpose.

## The shape of a booking

A gig is not one event. It is **one all-day event per phase per day**, and
the phases are spelled out in the title:

| Pattern seen                                  | Meaning                                  |
| --------------------------------------------- | ---------------------------------------- |
| `Google Summer Party - Prep`                   | Warehouse prep day                       |
| `Google Summer Party - Build 2/2`              | Second of two build days on site         |
| `Nissan - Rehearsals`                          | Rehearsal day                            |
| `Beyond The Pale - Show 2/3`                   | Second of three show days                |
| `Nissan - Show Day 2/ Load Out`                | Show and load out on the same day        |
| `Addison Rae - Babysit`                        | Crew standing by with kit on site        |
| `Tik Tok - Ploughing - Load In`                | Client, event and phase all in the title |

Other facts that matter for the design:

- **Who books:** the events are organised by two ops staff at
  `sessionhire.com`. They invite the crew.
- **Crew are attendees.** Roughly two thirds of attendee addresses are
  personal Gmail, Outlook, iCloud or GMX accounts (freelancers); the rest are
  `sessionhire.com` staff, a few supplier companies (another video company,
  a staging company) and clients. An event has 2 to 46 attendees.
- **RSVP is the crew confirmation.** "Accepted" means the person is on the
  job; "needsAction" means they have not answered.
- **Location is the venue** (RDS, Royal Hospital Kilmainham, Palmerstown
  House, Screggan for the Ploughing, the Guinness Storehouse and so on).
- **The description is the job sheet, when it is filled in.** Most are
  empty. When filled, they hold:
  - a kit list in sections (`Audio`, `Video`, `Lighting`,
    `Transport and labour`) written as `4 x d&b Y10P`, `1 x d20 amp`;
  - which parts a partner company is supplying;
  - a run of show (`5.00pm - Crew Call`, `9:00pm - Doors`);
  - access notes from the venue.
- **Colly's own calendar** carries a second, informal copy of some gigs
  (`Fairview Build`, `Tom jones show`) without attendees.
- A shared calendar called **Session Hire Gigs** exists but is empty.
- Everything is in `Europe/Dublin`.

## What this means for the new system

1. The unit of scheduling is the **phase-day**, not the project. The data
   model has a Project with ordered Phases, and a phase can span days.
2. The calendar sync has to produce exactly this shape, so crew see no
   change on day one: one all-day event per phase-day, the same title
   pattern, the venue as location, crew as attendees.
3. RSVPs map onto crew assignment status, both ways.
4. Kit lists in descriptions can be parsed into draft equipment lines when
   importing history. Accuracy will be partial; the import marks them for
   review rather than trusting them.
5. Freelancers do not have company accounts. Crew-facing features must work
   with a personal email and a magic link, not a Google Workspace login.
