# ADR 0016: Scanning with the phone's camera

- **Status:** Accepted, 30 September 2026. The fourth part of Phase 2.
- **Decides:** how the app reads labels and makers' barcodes with a
  phone's camera, what it does with what it reads, and how that works with
  no signal, before pick lists and scanning out and in build on it.

## Context

Labels are printed with a QR code holding just the number, `SH-000123`
([ADR 0015](0015-printing-labels.md)). A USB or Bluetooth scanner already
works in the Stock search: it types the number and Enter, which opens the
item, or offers to put a label that isn't on anything yet on an item
("claim on scan"). Colly chose a QR code with just the number over a web
address a phone's own camera would open, on the understanding that the
app would scan with the camera itself, next.

Most of the crew have a phone and no scanner. The
[stock research](../research/stock-tracking.md) (§1, §6, §9) recommends:

- phones' cameras first: the phone's own barcode reader where the browser
  has one (Chrome on Android), and zxing compiled to WebAssembly where it
  doesn't (iPhone), kept on the phone so it works offline;
- QR codes for Session Hire's labels, with **Code 128** read too, since
  that's what most makers print serial numbers in;
- one way of scanning that the rest of the warehouse (pick lists, scanning
  out and in) builds on, whatever does the reading.

## Decision

- **A Scan button beside the Stock search** opens the camera under it.
  What it reads goes into the search as if a scanner had typed it and
  pressed Enter: a label on an item opens the item, and a label that isn't
  on anything yet opens the form to put it on one.
- **Each code is read once.** The same code again is ignored until another
  has been read, so a label still in view once it's on an item isn't read
  twice. An Android phone buzzes when it reads one (an iPhone doesn't let
  a web app).
- **Labelling a shelf is point, tap, point.** While the form for a new
  label is open, the camera pauses, smaller, so the form fits under it.
  With the product and place from the last label still there, the form's
  button is scrolled into reach with no keyboard in the way; for the first
  label the cursor goes to the product. Once the label is on an item the
  camera carries on. **Scan another** puts a label read by mistake aside.
- **A maker's barcode is a serial number.** Anything read from a Code 128
  barcode that doesn't start with SH is looked up by serial only, so a
  serial of digits such as `000123` finds the item with that serial, never
  SH-000123. An item whose serial matches exactly opens straight away.
- **The reader:** the phone's own where it reads both QR and Code 128;
  otherwise zxing (the `barcode-detector` package, MIT), built into the
  app. Its WebAssembly (about 1.1 MB, 460 KB compressed) is one of the
  app's own files, kept on the phone with the rest of the app when it's
  installed, and never fetched from anywhere else. What the camera sees is
  read on the phone and never leaves it.
- **The camera stops** when the camera is closed, the page is left, or the
  app goes into the background. The phone's light has a button where the
  phone lets a web app switch it on (Chrome on Android), for dark bays and
  trucks.
- **When the camera can't start,** it says why and what to do: blocked
  ("Allow it in the browser's settings for this site"), no camera, or
  another app using it. The Scan button only shows where the browser can
  use a camera.

## Consequences

- Every phone keeps about 1.1 MB more for the app, whether it has its own
  reader or not, so that one that doesn't can scan the first time with no
  signal.
- On an iPhone, zxing reads more slowly than Android's own reader; how
  much, on the crew's own phones in a dark bay, is for the labelling pilot
  to show.
- Only the Stock search scans for now. Pick lists and scanning out and in
  will use the same camera, the same reader and the same "read once" rule.
- Data Matrix, for very small marks such as engraved rigging, and NFC
  come later if they're needed; only QR and Code 128 are read now.
- A scanner that types (USB, Bluetooth or a warehouse handheld) still
  works as before, and is quicker for a long run of labels.
- A web app can only use the camera on a secure page, which the live app
  is.
