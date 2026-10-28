# ADR 0094: Certificates on items

- **Status:** accepted
- **Date:** 28 October 2026
- **Asked for by:** Colly, 28 October 2026 ("Can you add certs to each stock
  item such as ones for Motors and PAT testing for other electrical items?")
- **Builds on:** [ADR 0020](0020-inspections.md) (inspections: the PAT and
  the thorough examination, when each is due, and failed or overdue kit not
  going out), [ADR 0032](0032-venue-and-client-pages-and-their-documents.md)
  (documents kept as a file, a link, or both)

## Context

The app already records each electrical test (PAT) and each thorough
examination of lifting gear, such as chain motors, on the item: who did it,
when, passed or failed. A product says how often its items need each, and
kit whose last one failed, or that's overdue, can't go out (ADR 0020). What
it doesn't keep is the paper: the PAT certificate, the report of thorough
examination that the law asks a competent person to make (S.I. 299/2007),
or the other certificates kit comes with, such as a declaration of
conformity or a fire-retardancy certificate for drapes. Today those sit in
a tester's email or a folder, and finding one when a venue or an inspector
asks means hunting.

A tester usually sends one report for a whole round: forty motors, or a
shelf of speakers, on one PDF. Some send one per item. The report often
comes days after the test.

## Decision

1. **A certificate is kept on the items it covers**, as a file (a PDF or a
   photo of it, up to 10 MB), a link to where it's shared, or both, the
   same way a venue's documents are (ADR 0032): the file in the storage
   bucket, on the same list of files to delete, read only through the
   server. One certificate can cover up to 1,000 items, so a round's report
   is put up once.
2. **Three kinds:** a **PAT certificate**, a **report of thorough
   examination**, and **another certificate**. Each has a title and the day
   on it. Only another can run out on a day of its own; a test's
   certificate is due again as its product says, from the test.
3. **A test's certificate is found by its item, kind and day**: the PAT
   certificate on an item dated the day of its PAT is that test's. The
   tests stay as they were recorded and are never changed (ADR 0020); a
   certificate is kept beside them, so one that comes a week later is
   added without touching the register.
4. **Where they're added and seen.**
   - On an item's page, each test has its certificate to open, or **Add
     certificate** beside a pass with none; and a **Certificates** card
     lists every one the item has, with Open, Change, Remove and **Add
     certificate** for another, such as a declaration of conformity.
   - On the Testing page, after a round is scanned, **Add the PAT
     certificate (or report of thorough examination) for these N passed**
     puts one file or link on every item that passed there that day.
   - The **Inspections due** card lists other certificates that have run
     out or will within 30 days, and says how many items' last test has no
     certificate kept yet.
5. **Nothing is stopped for a certificate.** Kit still can't go out when
   its last test failed or it's overdue, as before. A test recorded with
   no certificate kept here is listed, not stopped, as a test not recorded
   is: the paper may be in the post, or on the sticker. Another
   certificate that has run out is listed, not stopped: whether a
   declaration or an FR certificate matters depends on the job, and
   stopping kit for it would surprise the warehouse. Either can become a
   rule later if the office wants it.
6. **Who:** adding, changing and removing them is stock's, as recording a
   test is ([ADR 0034](0034-roles-and-what-each-can-change.md)). Anyone
   signed in can open one.

## Consequences

- The certificate for any motor's last examination is a tap from its page,
  and a round's report goes on forty motors in one go.
- The History tab says who added, changed or removed each, and Download
  everything has the details in `item_certificates` and
  `item_certificate_items`; the files stay in the storage, like venues'.
- Starting fresh, the daily tidy and the count of stray files all know
  these files.
- Until the storage bucket is set up on the live server, links work and a
  file says it waits on the bucket, as for venues' documents.
- Not yet: emailing a certificate to a venue from a job, a job's pack of
  every certificate its kit needs, and stopping kit whose other
  certificate has run out.
