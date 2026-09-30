# ADR 0016: Scanning with the camera

- **Status:** Accepted, 30 September 2026. The fourth part of Phase 2.
- **Decides:** how a phone's camera reads labels in the app, what a read
  does in the Stock search, and what pick lists and scanning out and in
  will reuse.

## Context

Labels ([ADR 0015](0015-printing-labels.md)) carry a QR code holding just
the number, `SH-000123`. Colly chose that over a web address in the QR
code, so a phone's own camera app shows the number but can't open the
item: reading labels with a phone needs the app's own camera. Until now
only a scanner that types the number and Enter (USB or Bluetooth) worked,
in the Stock search.

The [stock research](../research/stock-tracking.md) (§0, §6) says to scan
with phone cameras first: Android's Chrome has a barcode reader built in
(`BarcodeDetector`), iPhones need one in the app, and scanning has to work
with no signal. Rugged handhelds and ring scanners come later and type
into the search like any scanner. Freelancers use their own phones.

## Decision

- **Scan** beside the Stock search turns the camera on, in the page: a
  square picture with a frame to put the label in, the back camera, and
  **Stop camera**. Nothing to install; the browser asks once whether the
  app may use the camera.
- **It stays on**, reading one label after another. A new code is read
  at once; the same code isn't read again until it has been out of sight
  for just over a second, so a label held still isn't read twice, and
  going back to one reads it again.
- **Each read is felt and heard:** the frame flashes, "Read SH-000123"
  shows, the phone buzzes where it can (Android), and it beeps. The beep
  can be turned off with **Sound**, remembered on each device. **Light**
  turns on the phone's torch where the browser allows it (Android), for
  dark racks and case interiors.
- **What a read does in the Stock search:** an item's label opens its
  page, as does a maker's serial in a barcode, when exactly one item has
  it. A label on nothing yet opens the claim form from ADR 0015 with the
  camera still on and made small, so the form fits under it: labelling a
  shelf is now a scan and a tap each, as the product and place stay.
  Anything else goes in the search, as if typed.
- **Reading:** the phone's own reader where it has one (Android's Chrome:
  QR codes, and makers' Code 128, Code 39, Data Matrix and EAN-13
  barcodes), and otherwise a QR code reader in the app (`jsQR`, about
  46 kB), loaded the first time the camera is used and kept with the app
  for use with no signal. It looks at the middle of the picture about
  eight times a second.
- **Pictures never leave the phone** and aren't kept: each frame is read
  on the phone and dropped. Nothing about scanning is sent anywhere
  except what a read then does, like any other change.
- **The camera turns off** when the page changes, on Stop camera, and
  while the app is out of sight (another app, the phone locked), and
  comes back on when the app is back. If it can't start, it says why and
  what to do: blocked in the browser's settings, no camera, or another
  app using it; **Try again** retries.

## Consequences

- Any phone with a camera and a current browser scans labels in the app,
  with no signal too, and without buying scanners first.
- iPhones read QR codes only, so Session Hire's labels, not makers'
  barcodes; Android reads both. If makers' barcodes turn out to matter on
  iPhones, a larger reader (`zxing-wasm`, about 1 MB) can replace the one
  in the app.
- A scanner that types (USB, Bluetooth, a rugged handheld) still works in
  the search, with or without the camera on.
- The camera piece is its own part of the app, so pick lists and scanning
  out and in, next, use the same one.
- Tested on a phone-sized screen with a stand-in camera that shows the
  app a label's QR code, and once with Chromium's own test camera; still
  to try on real phones in the warehouse, Android and iPhone, in the
  phone field test.
