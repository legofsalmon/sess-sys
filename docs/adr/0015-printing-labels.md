# ADR 0015: Printing labels

- **Status:** Accepted, 30 September 2026. The third part of Phase 2.
- **Decides:** how numbers are set aside for labels before they're
  printed, what a label carries, how labels are printed here or by a
  label maker, and how a label from a roll ends up on an item, before
  scanning out and in builds on them.

## Context

Nothing Session Hire owns is labelled yet. The catalogue
([ADR 0013](0013-warehouse-catalogue.md)) gives each numbered item a
Session Hire number (`SH-` and six digits, never used twice), typed from a
label already stuck on or given out as the next free one, and said that
printing labels would set its numbers aside so that numbers given out in
the office don't land in a roll not yet stuck on.

The [stock research](../research/stock-tracking.md) (§0, §5) recommends:

- a QR code and the number in large type on every numbered item, with the
  QR code holding only the number or a short web address, never anything
  that can change;
- mostly **pre-printed rolls** of numbered QR labels from a label maker
  (polyester for gear, metal tags for cases and rigging): peel the next
  one, stick it on, scan it and say what it's on ("claim on scan"), about
  30 to 60 seconds an item with no printer on site;
- a **desk label printer** for the rest: replacements, cases, bundles.

## Decision

- **Numbers are set aside a run at a time.** Labels (from the Stock tab)
  sets aside as many numbers as asked for, 1 to 10,000 at a time, with a
  note of what they're for ("Label World roll", "Metal tags for cases").
  The server picks them, the next free ones after every number used or set
  aside, so two devices setting some aside at once never get the same ones;
  a device with no signal shows "Numbers when synced" until then.
- **The next free number skips them.** An item given the next free number
  gets one after every number used or set aside, never one waiting on a
  printed label.
- **A run is kept for good.** Its labels may already be printed, so its
  numbers never change and it can't be taken back; numbers never stuck on
  just stay unused. What it's for and its notes can be changed.
- **A label carries** the QR code, the number in large type and "Session
  Hire", plus the product's name when it's an item's own label. Black on
  white, for any printer.
- **The QR code holds just the number**, `SH-000123`: it never goes out of
  date, it isn't tied to any web address or to this app, and it's the
  smallest QR code there is (21 × 21) even with the most error correction
  (up to 30% can be scuffed off and it still reads). The Stock search, a
  scanner and the app all read it back as the number typed. The other way,
  a Session Hire web address in the QR code so a phone's own camera opens
  the item, is Colly's to choose before any roll is ordered: labels
  already printed with just the number would keep working.
- **Printed here**, from the browser, in three layouts: a label printer
  one label to a page, 50 × 25 mm or 25 × 25 mm, or A4 sheets of 65
  (38 × 21 mm) in an office printer for trials. Up to 500 at a time, from
  any number in the run; the layout is remembered on each device. An
  item's own label prints from its page.
- **Printed by a label maker** from a spreadsheet of the whole run, a row
  per label: the number to print and what the QR code holds. The same
  spreadsheet works in a label printer's own software (P-touch Editor,
  ZebraDesigner).
- **Claimed on scan.** Scanning or typing a label that isn't on anything
  yet in the Stock search offers to put it on an item: which product, and
  where it's kept. It becomes that product's item with that number, one of
  those counted there if some are. The product and place stay for the next
  label, since labelling goes a shelf at a time, so each label after the
  first is a scan and Enter. A number from no run and past the next free
  one says to check the label.
- **Each run shows how far it's got:** how many of its numbers are on
  items, worked out on each device.

## Consequences

- The server's next free number reads both the numbers used and the runs,
  under the same lock as every change, so the rule holds whichever device
  asks.
- Printing here is for trials, replacements and small runs; a roll of
  thousands comes cheaper and tougher from a label maker.
- Labels print from the browser's own print dialog. Its paper size has to
  match the labels, and it must print at actual size, not fitted to the
  page; the print screen says so.
- A phone's camera needs the app to read a label for now: scanning with the
  camera in the app comes with scanning out and in, next. A USB or
  Bluetooth scanner works in the Stock search already.
- Runs are in the backups, the download of everything and the history.
