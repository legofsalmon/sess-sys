# ADR 0095: Cable labels

- **Status:** accepted
- **Date:** 29 October 2026
- **Asked for by:** Colly, 29 October 2026 ("We'd still need to label cable
  that would mark the cable length etc." … "Please add a cable label section
  to each stock item"; "would barcodes on cable labels be easier to scan?")
- **Builds on:** [ADR 0015](0015-printing-labels.md) (printing labels from
  the browser, one to a page on a label printer),
  [ADR 0016](0016-camera-scanning.md) (scanning in the Stock search)

## Context

An item's label (ADR 0015) carries its own number, for kit tracked one by
one. Everyday cables are counted, not numbered (stock research §3), but
crew still need each cable to say what it is and how long, at a glance and
at each end. The office is buying a Zebra industrial label printer, which
prints self-laminating wrap-round labels, flag labels and bag labels.

A QR code wrapped round a thin cable bends and reads badly. A long, thin
Code 128 barcode run along the cable keeps its bars straight however tight
the wrap. Android phones and Zebra handhelds read Code 128 in the app
(BarcodeDetector); iPhones read only QR codes in it today (jsQR).

## Decision

1. **Every product's page has a Cable labels tab** (ADR 0082's parts), not
   only products called cables: the same labels suit the bag, bin or tub
   anything counted lives in.
2. **The label says what it is in big type**: the product's name to start
   with, or anything typed, up to 40 letters, as big as fits.
3. **Three labels**, each one to a page: **wrap round, 50 × 25 mm**
   (self-laminating, the clear tail over the print), **flag, 100 × 25 mm**
   (round the cable and stuck to itself, saying it at both ends with the
   middle left blank), and **bag or bin, 50 × 25 mm**. Two by default, one
   for each end, up to 500 at once.
4. **The code on it is the product's stock code**, as a **Code 128
   barcode**, a **QR code** (the name where there's no stock code), or
   none. A barcode needs a stock code of plain letters, numbers and marks,
   and says so when there isn't one. Scanned or typed in the Stock search,
   a product's stock code opens the product.
5. The layout and the code chosen are remembered on the device, as an
   item's label layout is.

## Consequences

- No new data: the words aren't kept, since they start from the name and
  are printed, not looked up.
- The Code 128 encoder is ours (shared/src/labels.ts), checked once
  against a real decoder (zxing-cpp) when written and by its widths in the
  tests.
- Reading Code 128 on an iPhone needs a 1D reader added to the camera
  fallback; until then iPhones use QR codes, or a Zebra handheld reads the
  barcodes.
