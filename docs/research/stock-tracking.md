# Stock Tracking for Session Hire: Identification, Labelling, Rollout and Compliance

Research date: 2026-09-29. Scope: an Irish A/V rental company (audio, lighting, video, staging, cables, road cases) with thousands of assets that have no labels yet, 100+ freelancers, hundreds of jobs a year and poor signal at many sites. The company is building its own offline-first PWA, possibly wrapped with Capacitor.

Legend: **[V]** means verified against a cited source during this research. **[I]** means inferred, estimated or from general industry knowledge, and should be checked before relying on it. Prices exclude VAT unless stated. Retail prices change often, so treat them as indicative.

---

## 0. Recommendation (TL;DR)

1. **Primary identifier: a QR code plus a human-readable short ID** (for example `SH-004217`) on every tracked asset and container. Encode only the ID, or a short URL such as `https://s.sessionhire.ie/a/004217`, never data that can change. QR codes can be printed down to about 7x7 mm (Rentman's guidance, [V]). Phones read them with the camera at any angle, and every scanner in the kit below reads them. Allow **Code 128** as a secondary symbology so manufacturer serial barcodes and legacy labels still scan. Use Data Matrix only for very small marks, such as engraved metal on rigging hardware.
2. **Scan with phone cameras first.** Android Chrome has the native `BarcodeDetector`. iOS Safari needs a zxing-wasm polyfill ([V]). For the warehouse, buy 1 or 2 Zebra TC22 handhelds, whose DataWedge sends scans as keystrokes or Android intents (a keyboard wedge), plus Bluetooth HID companion or ring scanners for bulk checkout.
3. **Leave RFID for Phase 3, but design for it now.** UHF RFID pays off mainly for cable returns: one Flex customer reports cable return time falling to about a third of what barcode scanning took ([V]). Rentman and Flex both run RFID alongside barcode or QR rather than instead of it ([V]). NFC is optional: it gives nothing a QR code doesn't, doesn't work on iOS in a PWA, and only reads at contact range.
4. **Label material by asset class** (see §2): polyester labels printed by thermal transfer with resin ribbon and an over-laminate go on most items. Metalphoto or anodised aluminium tags, riveted or bonded, go on road cases and rigging. Brother HSe heat-shrink or TZe wrap-around flag labels go on cables. Laser engraving or Metalphoto goes on rigging hardware that needs a permanent distinguishing mark under Reg. 54(2)(b).
5. **Data model:** `asset_id` is an immutable UUID. Separate `identifier` rows (QR, barcode, NFC UID, RFID EPC, manufacturer serial) point to the asset, so one asset can have many tags and a tag can be retired and replaced. Containers form a tree. Tracking modes are `serialised`, `bulk` and `bulk-bundle`. Scans are append-only events recorded offline and merged later.
6. **Rollout:** (a) label everything going out on each job and everything as it comes back from jobs, (b) blitz by category in value order: rigging and lifting first (legal requirement), then high-value serialised gear, then cases, then cables. Use pre-printed sequential QR rolls for speed and a portable printer for exceptions. Finish with a full baseline stocktake, then move to rolling cycle counts.

---

## 1. Identification technologies compared

| Tech | Cost per tag | Reader cost | Read range | Survives metal and touring? | Offline? | From a phone browser? | Bulk checkout speed |
|---|---|---|---|---|---|---|---|
| **1D Code 128** | €0.02–0.40 printed polyester [I]. OnRent (formerly Current RMS) uses Code 128 by default [V] | Phone camera free. Keyboard-wedge scanners about £40–350 (Tera to Socket S740 £349 [V]) | Contact to about 30 cm (imager) [I] | Printed labels are fine on metal, but long, thin barcodes scuff and are hard to fit on round cables [I] | Yes: the reader is local, and lookups work against a local DB | Android Chrome `BarcodeDetector` [V]. iOS needs a zxing-wasm polyfill (native is 2–3x faster than WASM) [V] | 1 item per scan, about 1–2 s each with a scanner [I] |
| **QR / Data Matrix** | Same as above. Can be 7x7 mm (Rentman) [V] | Same. Needs a 2D imager, not a laser scanner (cheap 1D-only laser models can't read it) [I] | Contact to about 30–50 cm. Larger labels read further [I] | Tolerates about 7–30% damage through error correction (ISO 18004 levels L–H) [I] | Yes | Same as above. QR is the most reliable symbology in both native and polyfill decoders [I] | Same as 1D. Omnidirectional, so faster in practice [I] |
| **NFC (13.56 MHz, NTAG213)** | On-metal ferrite tags €0.92–2.99 each depending on volume (Shop NFC) [V] | Most Android phones have it. iPhones read NFC only in native apps | 1–4 cm [I] | Needs on-metal (ferrite) versions [V]. Hard epoxy or ABS disc versions are durable [V] | Yes | **Web NFC works only in Chrome on Android (89+). No iOS, Firefox or desktop support. About 6% global support** [V]. Needs a Capacitor plugin on iOS [I] | Slower than QR (tap each item). Useful as a backup when a QR is scraped off [I] |
| **UHF RFID (EU band 865–868 MHz)** | Stickers about €0.50 (Geartracking RM4, €124 per 250) [V]. Hard tags €1.55–1.65 (RM2/RM3, €155–165 per 100) [V]. On-metal: Xerafy Metal Skin $0.81, Beontag (formerly Confidex) Ironside Micro $2.23, Slim $3.66 [V]. Cable housings (HID Sentry Cable) about $1–5 [I] | Zebra RFD40 sled £758–794 [V] plus TC22 host £491–562 [V]. Chainway C72 €877, C5 €892 [V]. Portal or dock door $5k–17k+ (Flex) [V]. Zebra FX9600 fixed reader with 4 or 8 ports [V] | 1–6 m handheld typical. Sentry Cable 18–20 ft (5–6 m) on insulated metal [V] | Needs on-metal tags on metal. Readers must be tuned down to avoid picking up neighbouring cases (Rentman) [V]. Dense packed cases read poorly, so Flex advises reading cables while unloading, not through the case [V] | Yes: the reader is local | **Not from a browser.** Needs a Zebra device with DataWedge (RFID input can go out as keystrokes or an intent) [V] or a native SDK through Capacitor [I] | Dozens to hundreds of tags per second. Flex claims 6–10x faster ID capture [V] |
| **BLE trackers** (AirTag, Tile, Kontakt.io) | AirTag $29, or $99 for 4 (US) [V]. Ireland about €39 / €129 [I]. Kontakt.io Nano Tag $4.99–7.99 [V]. Asset Tag 2 has up to 8-year battery [V] | Phones, or BLE gateways for Kontakt [I] | 10–50 m BLE. AirTag and Tile use crowd-sourced networks [I] | Casing is fine. Batteries need changing [I] | Location updates need crowd or network connectivity [I] | AirTag needs iPhone and Find My. There's no web API for either [V/I] | Not for checkout. They show where a case is, not whether it was scanned [I] |
| **GPS / cellular trackers** | Teltonika FMB920 €35.50, FMC130 (4G, backup battery) €41–102 [V], plus a platform or SIM subscription [I] | n/a | Global | Hardwired into trucks. Battery units go in high-value cases [I] | Stores fixes and uploads when back in coverage [I] | n/a | n/a |

Notes:
- AirTags warn nearby iPhones that an unknown tag is travelling with them, which limits their use against theft. Tile has an "Anti-Theft mode" that needs ID verification [V]. AirTags are cheap for finding lost cases, not for controlling stock.
- Recommended role for each: **QR is the system of record.** RFID later speeds up bulk and cable handling. NFC is optional. BLE or AirTag goes in a few high-value cases (for example the video server rack or the console case). GPS goes in the vans.

---

## 2. Label and tag durability for touring gear

| Asset class | Recommended label | Why / notes | Suppliers (IE/UK) |
|---|---|---|---|
| **Speakers, amps, lighting fixtures, video (painted metal or plastic)** | Polyester printed by thermal transfer with **resin ribbon**, ideally with a clear over-laminate. Tamper-evident "VOID" polyester for high-value items | Polyester with resin resists solvents and abrasion. Zebra recommends resin ribbon with polyester [V]. Put the label in a recess or on the rear panel, away from handles and edges, since the back is the usual advice [V] | Label World (Dublin) [V], BKLD.ie [V], Cardlogic.ie (tamper-evident) [V]. Zebra Z-Ultimate 3000T polyester [V] |
| **Road cases (plywood/ABS, aluminium extrusion)** | **Metalphoto or anodised aluminium plate, riveted or bonded with VHB**, as the case ID. Also a large printed QR on a polyester label behind a clear plate or in a recessed dish so it scans from about 1 m | Metalphoto (image sealed under the anodic layer) is rated for 20+ years outdoors [V]. Rivets survive gaffer tape and stencilling. Practitioners also paint case lids in colour codes and stencil numbers [V] | Premium Signs (London, certified Metalphoto converter) [V], BKLD.ie (anodised, etched steel) [V], Jabac [V] |
| **Cables (signal, power, multicore)** | Tracked in bulk (§3). If serialised: **Brother HSe heat-shrink tube** (put on before the connector is fitted or with the connector off) or a **TZe Flexible-ID wrap-around flag label**. If RFID: a cable-tie housing (HID Sentry Cable) [V] | Heat-shrink can't peel off. Flag labels leave space for a QR. Colour-coded tape by length is common practice in the industry [I] | Brother HSe via PT-E560BT (up to 21 mm HSe) [V], PT-P950NW (TZe, HSe) [V] |
| **Rigging (shackles, slings, steels, chain hoists, truss)** | **Laser-engraved or stamped ID, or a Metalphoto tag on a wire or cable tie**, plus a QR tag. Truss: a riveted aluminium tag or a UHF on-metal tag in a drilled recess [I] | Reg. 54(2)(b) needs a "distinguishing number or mark... of long lasting duration" [V]. Don't stamp load-bearing parts yourself; use the manufacturer's marks or tags [I] | Engraving specialists, Premium Signs [V] |
| **Small items (DI boxes, mics, clamps, adaptors)** | Small (12–19 mm) polyester QR or TZe laminate label, or an on-metal NFC disc. Otherwise bulk | Rentman's minimum QR size is 7x7 mm [V] | as above |
| **On-metal RFID (Phase 3)** | Xerafy Metal Skin (thin label), Beontag Ironside (rugged), Geartracking RM3 hard tag or RM7 on-metal sticker [V] | Rentman: RM3 is "extremely durable... on and off metal" for cables, trussing and flight cases. RM7 is best on metal [V]. Flex's tag vendors are HID (Vizinex) and Metalcraft (barcode labels with embedded RFID) [V] | Geartracking.com (EU, €) [V], Atlas RFID Store [V], Tec-RFID UK [V] |

**What AV rental houses actually do** (from vendor guidance and forums):
- Rentman recommends QR codes over barcodes because they print smaller. It puts QR codes on each expensive serial number, and gives bulk items such as cables **one QR per item type** rather than per unit [V].
- In OnRent Events (formerly Current RMS), serialised stock uses its asset number as the barcode, while bulk stock has one barcode per product. It supports any keyboard-wedge scanner that sends a carriage return [V].
- Flex puts **both a barcode and an RFID tag** on each serialised unit for redundancy, scans case barcodes to open or close containers, and reads cables by RFID on return [V].
- ControlBooth practitioners use engraved labels, colour-painted case edges, stencilled shapes and numbers, and matching fixture and case numbers [V].
- Booqable advises ordering samples first, giving IDs prefixes (for example `CA` for cameras), using Code 128 rather than Code 39, and tagging high-value items individually while grouping cheap ones [V].

---

## 3. Serialised vs bulk vs bundle: decision rules

These rules are distilled from Rentman, OnRent and Booqable guidance [V], with thresholds that are Session Hire proposals [I]:

| Mode | Use when | Examples |
|---|---|---|
| **Serialised** (one ID per unit) | Replacement cost is above about €150 **or** it needs individual service or compliance history (PAT, lifting exam, lamp hours, firmware) **or** it's commonly lost or stolen | Speakers, amps, consoles, fixtures, LED panels, projectors, radio mics, chain hoists, shackles and slings (legal register), power distros, every road case |
| **Bulk** (count only, one SKU barcode) | Cheap, interchangeable and not individually inspected | XLR/DMX cables under 10 m, IEC leads, clamps, safeties (unless treated as lifting accessories), gaffer tape, batteries |
| **Bulk with bundle ID** (a loom, bag or crate gets a serial, contents are counted) | A fixed group always travels together, but individual items don't need history | "10x 10 m XLR" bag, a multicore loom plus tails, a drum of Socapex, a crate of 20 clamps |
| **Kit / package** (a virtual group of serialised items, no physical container) | Items are booked together but packed separately | "Wedge monitor pack" = 4 wedges + 2 amps + cable bag |

Special cases:
- **Power cables and extension leads** are bulk for stock purposes, but they fall under Regulation 81 portable-equipment inspection. Either serialise them or record PAT tests per batch or loom so a failed lead can be removed [I, based on Reg. 81 [V]].
- **Lifting accessories must be individually identifiable** (Reg. 54), so they're always serialised [V].

---

## 4. Container and nesting model

How the major systems work:
- **Rentman:** scan an empty case to create a Container, scan items into it, then **seal** it. Scanning the case QR then moves all its contents between statuses. It tracks serialised and bulk contents across projects. Crews should empty containers on site so the system doesn't think items are still in the case [V].
- **Flex:** containers are built virtually "as they are physically" (for example an amp rack holding amps). Contents scanned into a container are **scanned out automatically with it**. Contents are added in "Content Builder". "Serialized Package" models cover permanent racks whose contents aren't rentable separately. Users run "Missing from Container" reports [V].
- **OnRent Events (formerly Current RMS):** **Permanent** serialised containers hold serialised rental stock only. **Temporary** containers can hold rental, serialised, bulk and non-stock items. Scanning the container allocates its contents [V].

**Proposed Session Hire model** [I]:
- A `container` is an asset with `is_container = true`, with a `container_type` of `permanent` (a rack with bolted-in amps) or `temporary` (a cable trunk, packed per job).
- `asset.parent_container_id` allows nesting (a rack goes in a truck pack, which goes in a van) up to a sensible depth limit.
- Scanning a container in a checkout flow expands to its contents (recursively), shows a checklist, and flags differences against what was expected.
- **Sealing:** a sealed container gets a content hash and seal timestamp. Changing its contents breaks the seal and prompts a recount.
- Bulk contents are held as `(sku, qty)` on the container.
- On return, open each container and verify its contents. Differences become "missing from container" exceptions.

---

## 5. Rollout strategy for labelling thousands of unlabelled assets

**Numbering:** `SH-` plus 6 digits, sequential and never reused. Don't put meaning in the number: category, owner and location live in the database, because meaningful numbers go stale [I]. Optionally add a check digit. The QR payload is a URL with the ID, so a freelancer's normal camera app opens the asset page, and the PWA intercepts it [I].

**Pre-printed rolls vs printing on demand:**
- **Pre-printed sequential rolls** (polyester, ordered from Label World, BKLD or similar) are fastest in the field. Peel the next label, stick it, scan it, pick the model. The asset record is created when the label is scanned ("claim-on-scan"), so no printer is needed on site [I]. Price on quote. Estimate €0.05–0.30 per label for polyester at 5–10k volume, and €0.50–2.00 each for Metalphoto [I].
- **On-demand printing:** use a desktop thermal-transfer printer (Zebra ZD421t, or ZD621 for higher volume; GBP price not found, roughly £400–700 [I]) with polyester labels and resin ribbon for replacements and bundle labels that include text such as "10x 10 m XLR". A portable Brother PT-P910BT (£207 [V]) or PT-E560BT (about £185 [V]) handles TZe laminated tape and HSe heat-shrink on cables.
- Hybrid (recommended): pre-printed QR rolls for about 90% of items, plus thermal transfer for bundles, containers and replacements [I].

**Sequence** [I]:
1. **Weeks 0–2, pilot:** order material samples (advice from Booqable [V]). Test them on real cases, cables and fixtures through a wash, gaffer-tape pulls and a gig. Test phone camera scanning on the freelancers' typical Android phones and iPhones. Freeze the ID format and data model.
2. **Weeks 2–6, compliance first:** do all rigging and lifting accessories, chain hoists and truss. Build the lifting register (Reg. 54) and import the last thorough-examination dates. Label PAT-able power distros and leads, and import PAT records.
3. **Weeks 4–12, high value:** audio, lighting, video and control. Label at the bench, category by category, in quiet periods, **and** label anything unlabelled as it comes back from a job. Checkout becomes mandatory by scan for anything labelled, and the rest is checked out by manual count.
4. **Cases and containers:** do these at the same time as their contents, since a permanent rack is labelled once with its contents.
5. **Cables last:** consolidate into bundles, label the bundles, and count the loose stock.
6. **Baseline stocktake:** after about 90% coverage, do one full wall-to-wall count. After that, everything unlabelled counts as an exception.
7. **Phase 3 (optional, 6–12 months later):** pilot UHF RFID on cables and on high-turnover cases with one RFD40 and TC22. Add EPCs as extra identifiers on existing assets.

**Time per item** [I; there are no published benchmarks, so these are rough estimates]:
- Pre-printed QR on a clean surface plus scan-to-claim plus pick model: **about 30–60 s**.
- Also capturing the manufacturer serial and a photo: **about 1.5–3 min**.
- Riveted metal case tag: **about 3–5 min**.
- Heat-shrink on a cable (connector off): **about 3–5 min**. A flag label instead: about 1 min.
- So 3,000 serialised items at about 1.5 min each is about 75 person-hours, plus cables and bundles. That's roughly 2–3 weeks of one person's time, or a few blitz days with a team.

---

## 6. Scanning hardware

| Device | Price | Works with a web app? | Role |
|---|---|---|---|
| **Freelancers' own phones** (camera) | €0 | Android Chrome `BarcodeDetector` [V]. iOS uses the zxing-wasm `barcode-detector` polyfill [V]. Scanning works offline once the WASM is cached by the service worker [I] | Site checks, returns, damage photos |
| **Zebra TC22** (Android rugged handheld, 6") | £491–562 [V] (TC27 is the LTE version) | Yes: DataWedge **keystroke output** types into a focused Chrome field, or use the **intent output** with a Capacitor plugin (`capacitor-zebra-datawedge`) [V] | Warehouse prep and returns. Host for the RFD40 |
| **Zebra RFD40 UHF sled** | £758–794 [V]. Make sure the SKU is the EU (865–868 MHz) variant [I] | Through DataWedge RFID input to keystroke or intent (RFD40 Premium Plus/RFD90 in DataWedge mode) [V]. Rentman tested it with TC22/TC27 plus RFD4030 [V] | Phase 3 RFID |
| **Chainway C72 / C5** (all-in-one Android UHF plus 2D) | €877 / €892 [V] | Chainway uses a keyboard emulator app for keystroke output [I] | Cheaper RFID alternative. Less software ecosystem support |
| **Honeywell CT30 XP** | about £912 [V] | Yes: Honeywell's scan wedge [I] | Alternative to TC22 |
| **Zebra CS60 companion scanner** (Bluetooth HID, 2D) | from £257 [V] | Yes: pairs as a Bluetooth keyboard (HID) with any phone or tablet [I] | Fast bulk checkout paired with a phone or tablet |
| **Socket Mobile S740** (2D, Bluetooth) | £349 [V] | Yes: HID mode, plus native SDK [I] | Same role. Good iOS support |
| **Zebra RS5100 ring** | about $250–550 [V] | HID with Zebra hosts [I] | Hands-free truck loading |
| **Tera HW0010 ring** (2D, Bluetooth HID) | about $50–70 [V] | Yes: HID [V] | Cheap hands-free option. Consumer build quality [I] |

Web-app integration notes [I]:
- A keyboard wedge (HID) needs no browser API. Listen for fast keystroke bursts that end in Enter on a hidden or focused input. Configure the scanner with a prefix or suffix to tell scans apart from typing. OnRent also requires the scanner to send a carriage return [V].
- On iOS, an HID scanner can hide the on-screen keyboard. Use `inputmode="none"`.
- RFID and NFC on iOS need Capacitor native plugins. Web NFC only works in Android Chrome [V].

**Suggested starter kit** [I, based on the [V] prices above]:
- 2x Zebra TC22 with chargers: about £1,100
- 2x Zebra CS60 or Socket S740: about £520–700
- 2x Tera 2D rings for loading: about $140
- 1x Zebra ZD421t (thermal transfer) with polyester labels and resin ribbon: about £500–700
- 1x Brother PT-E560BT with HSe and TZe tapes: about £185 plus about £150 of tape
- Pre-printed QR labels (10k polyester): about €500–2,000 on quote
- Metalphoto case and rigging tags (1,000): about €800–2,000 on quote
- **Starter total: about £4–6k (≈ €4.7–7k).**

Phase 3 RFID adds about £1.3k (RFD40), about €0.5–4 per tag, and £5–17k+ if you want a portal [V/I].

---

## 7. Maintenance and compliance tracking (Ireland)

### Electrical: "PAT" under Regulation 81 of S.I. 299/2007 (as amended by S.I. 732/2007)
- Portable equipment must be **maintained fit for safe use**. Where it is exposed to conditions causing deterioration **and** runs above 125 V AC, it must be **visually checked by the user before use** and **periodically inspected by a competent person** "appropriate to the nature, location and use" [V].
- Reg. 81(2) says a competent person must, "where appropriate", **test** such equipment and **certify** whether it (including cables and plugs) was safe on the day of the test. Equipment that fails must not be used until it is made safe and re-certified (81(3)) [V].
- Circuits over 125 V AC supplying portable equipment (including from generators) need **30 mA RCD** protection (81(1)(a)) [V]. HSA guidance says RCDs should be push-tested regularly and periodically trip-tested by a competent person [V].
- **Frequency is risk-based.** Irish law sets no fixed interval [V]. For touring gear, which is moved, rigged outdoors and handled by many people, a short interval (for example 3–6 months, plus a check on every return) is defensible [I].
- **Standards:** EN 50699:2020 "Recurrent test of electrical equipment" is the European recurrent-test standard and is sold through NSAI [V]. EN 50678 covers testing after repair [V]. There is no specific Irish PAT standard (one secondary source cites "IS 3217", but that is the Irish emergency-lighting standard, so treat the citation as unreliable) [I]. UK practice follows the IET Code of Practice [I].
- **Records:** the regulation requires a certificate. Keeping test results is expected: HSA guidance on installations says to retain test record sheets [V]. A retention period of 5 years is often quoted by Irish providers but wasn't verified in the regulation [I].
- **Hire-specific point:** as the owner hiring equipment out, supply it tested, with the test date visible (a pass label and the QR), and keep the history [I].

### Lifting equipment: Regulations 52–54 and Schedule 1 of S.I. 299/2007 (Irish equivalent of LOLER)
- Schedule 1 Part B sets the maximum intervals between thorough examinations [V]:
  - **Lifting accessories** (chains, ropes, rings, hooks, shackles, clamps, swivels, spreader beams): **6 months**
  - **Hoists**: **6 months**. This most likely covers electric chain hoists and motors [I on classification].
  - **Winches used for lifting loads**: 12 months. Winch *testing* is required every 4 years (Part C).
  - **Items provided for support of lifting equipment**: 12 months. Truss and ground support may fall here [I].
  - Other lifting machines: 12 months for materials only, 6 months if they lift people.
  - Fork-lift or telehandler: 12 months, or 6 if used to lift people.
- The competent person may **shorten** the interval if they give reasons in writing (Reg. 53(2)) [V].
- **Reports** must contain the Part E particulars, including identification, safe working load (SWL), defects and "the latest date by which the next thorough examination must be carried out" [V]. The HSA form is **GA1** [V]. The examiner must send a copy to the HSA within 20 days if they advise immediate cessation [V].
- **Reg. 54:** a copy of the report must be kept with mobile equipment **and** be available at the owner's address. A **register of lifting equipment and accessories** is required, recording each item's distinguishing number, date of first use, and date of the last thorough examination and test. It may be electronic. Items without a distinguishing mark must be given one "of long lasting duration" [V].
- The equipment in Part D (pallet trucks and so on) falls under Reg. 30 inspection instead [V].
- Keeping inspection records is also required under Reg. 30 (the HSA guide notes records "kept available... for 3 years" for certain inspections) [V, partial].

### Cable and other testing [I]
- Signal cables: continuity and pinout tests (for example a cable tester on return), with failures logged against the bundle or serial.
- Lamp hours, firmware versions and fan filters are logged against serialised fixtures.
- Pyro, haze and similar equipment (not in scope here).

**App requirements:** a `compliance_regime` per model (PAT / LOLER / none), `inspection` events holding the result, examiner, certificate PDF, next-due date, SWL and defects, and a **hard block on checkout** when an item is overdue or failed, overridable only by a manager with a reason logged. It also needs a GA1-style register export per Reg. 54(2) [I].

---

## 8. Cycle counting, stocktake and loss reduction

- **Scan-out is mandatory:** a job can't leave the prep state until every serialised line is scanned. Bulk lines are counted. Flex and OnRent both allocate by scan [V]. Freelancers scan at load-out, when rigs change and at load-in, and events are stored offline.
- **Return discrepancies:** on check-in, compare what was scanned out with what was scanned in. Missing items create an exception assigned to the job or crew chief. Damaged items go to **quarantine** with notes and **photos**, the way OnRent's quarantine attaches damage photos [V].
- **Photos on damage** are mandatory for the "damaged" status. Capture them offline and upload when back in coverage [I].
- **Cycle counts** [I]: ABC by value. Count A items (above €2k, high loss risk) monthly, B items quarterly and C items and bulk twice a year. Plus a count at each location for anything that hasn't moved in over 60 days. OnRent's "Inventory Check" treats duplicate scans of a serialised item as one and takes typed quantities for bulk [V], which is a pattern to copy.
- **Blind counts:** counters don't see the expected quantity [I].
- **Container audits:** "missing from container" reports (Flex) [V]. Seals are checked on every return.
- **RFID later:** reading cables as they're unloaded reduces unscanned loss (Flex) [V].
- **BLE or GPS:** a few AirTags or Tiles in high-value cases, and Teltonika trackers in vans, for recovery after theft or misrouting [V prices].

---

## 9. Data-model requirements for the PWA [I]

```
asset(id UUID PK, model_id, tracking_mode ENUM(serialised,bulk_bundle,container),
      status, condition, home_location_id, parent_container_id NULL,
      purchase_date, cost, notes, created_at, retired_at)
identifier(id, asset_id NULL, sku_id NULL, kind ENUM(qr,code128,datamatrix,nfc_uid,rfid_epc,mfr_serial,legacy),
           value UNIQUE(kind,value), active BOOL, attached_at, retired_at, retired_reason)
model/sku(id, name, category, compliance_regime, default_inspection_interval_days, is_bulk, ...)
container_contents_bulk(container_asset_id, sku_id, qty)   -- bulk inside a case/bundle
scan_event(id UUID (client-generated), device_id, user_id, identifier_value, resolved_asset_id,
           action, job_id, location, lat/long NULL, ts_client, ts_server NULL, offline BOOL)
inspection(id, asset_id, regime, result, examiner, cert_file, swl, defects, next_due, ts)
damage_report(id, asset_id, job_id, photos[], description, status)
stocktake(id, scope, started_at, closed_at); stocktake_line(...)
```

Rules:
- **Asset ID is independent of the label.** A damaged label is retired and a new one is attached, and the history follows the asset. Labels print the short ID `SH-004217` for human fallback when a QR won't scan, but the QR payload maps to an `identifier` row, not straight to the primary key.
- **Many identifiers per asset** (QR, plus manufacturer serial, plus RFID EPC later, plus NFC).
- **Unknown-identifier flow:** scanning a label that isn't linked yet offers "claim this label", which is how pre-printed rolls work.
- **Offline:** client-generated UUIDs, append-only scan events, local cache of the asset, identifier and job tables (IndexedDB), conflict resolution on the server, and idempotent sync.
- **Decode engines:** native `BarcodeDetector` where available, the zxing-wasm polyfill otherwise, plus a keyboard-wedge listener, plus (in Capacitor) DataWedge intent, NFC and RFID plugins behind one `scan()` interface.

---

## Sources

- Rentman – Containers: https://rentman.io/product-updates/containers
- Rentman – Set up QR codes and barcodes (search snippet): https://support.rentman.io/hc/en-us/articles/360013101260-Set-up-QR-Codes-and-Barcodes
- Rentman – RFID explained: https://rentman.io/rfid-explained
- Rentman – RFID solution / Zebra scanners: https://rentman.io/solutions/rfid ; https://support.rentman.io/hc/en-us/articles/360015609959-Zebra-Scanners
- Geartracking (Rentman RFID and label shop, EUR prices): https://geartracking.com/
- Flex – Containers and Packages (search snippet): https://helpcenter.flexrentalsolutions.com/hc/en-us/articles/12053032516503-Containers-and-Packages
- Flex – RFID tracking: https://www.flexrentalsolutions.com/flex-rfid-tracking-software/
- Flex – RFID ROI: https://www.flexrentalsolutions.com/flex-rfid-tracking-software/rfid-roi/
- OnRent Events (formerly Current RMS) – How barcodes work: http://help.current-rms.com/en/articles/420529-how-do-barcodes-work-in-onrent-events
- OnRent – Serialised containers: https://www.current-rms.com/latest-features/serialized-containers
- OnRent – Stock levels (bulk vs serialised): https://help.current-rms.com/en/articles/402491-create-stock-levels-for-your-products
- OnRent – Inventory check / quarantine: https://help.current-rms.com/en/articles/3532962-count-your-stock-using-inventory-check ; https://help.current-rms.com/en/articles/422143-what-is-the-quarantine
- ControlBooth – Road case labelling: https://www.controlbooth.com/threads/road-case-labeling-and-identification.28973/
- Booqable – Asset labelling guide: https://booqable.com/blog/the-complete-guide-to-asset-labeling-for-rental-equipment/
- Web NFC support: https://webnfc.org/documentation/browser-support ; https://www.testmuai.com/learning-hub/web-nfc-browser-support/
- BarcodeDetector on iOS / zxing-wasm: https://dev.to/ilhannegis/barcode-scanning-on-ios-the-missing-web-api-and-a-webassembly-solution-2in2 ; https://www.npmjs.com/package/barcode-detector ; https://soledadpenades.com/posts/2025/on-barcodes-and-web-apis/
- Zebra RFD40 UK price: https://www.thebarcodewarehouse.co.uk/shop/zebra/rfid-readers/rfd40/ ; https://www.ers-online.co.uk/p10687/zebra-rfd40-uhf-rfid-sled
- Zebra TC22 UK price: https://www.thebarcodewarehouse.co.uk/shop/zebra/mobile-computers/Zebra-TC-Series/ ; https://www.logiscenter.co.uk/zebra-tc22-mobile-computing
- Zebra CS60: https://www.ers-online.co.uk/o27172/cs6080-sr40004vzww-zebra-cs60-bluetooth-companion-scanner
- Socket Mobile S740 UK: https://androidepos.co.uk/product-category/barcode-scanners/socket-mobile/socketscan/s740/
- Honeywell CT30 XP: https://amlabels.co.uk/honeywell-ct30-xp-series-handheld-mobile-computer.html
- Zebra RS5100: https://www.barcodefactory.com/zebra/scanners/rs5100
- Tera ring scanner: https://tera-digital.com/products/2d-ring-barcode-scanner-hw0010
- Chainway C72/C5 EUR: https://biztech-distribution.eu/en/products/chainway-c72-5-2-handheld-android-13-4gb-ram-64gb-rom-uhf-ip65
- Zebra FX9600: https://www.zebra.com/gb/en/products/spec-sheets/rfid/rfid-readers/fx9600.html
- DataWedge keystroke/intent/RFID input: https://techdocs.zebra.com/datawedge/8-1/guide/output/keystroke/ ; https://techdocs.zebra.com/datawedge/14-1/guide/input/rfid/ ; https://github.com/Cap-go/capacitor-zebra-datawedge
- On-metal RFID tag prices: https://www.atlasrfidstore.com/metal-mount-rfid-tags/ ; https://www.barcodefactory.com/xerafy/xerafy-labels/metal-skin-series ; https://atlasrfidstore.com/confidex-ironside-rfid-tag
- HID Sentry Cable: https://www.hidglobal.com/products/sentry-cable-tag ; https://vizinexrfid.com/product/sentry-cable-iii
- On-metal NFC: https://shopnfc.com/en/6-on-metal-nfc-tags ; https://seritag.com/filter/on-metal-tags
- Kontakt.io: https://kontakt.io/products/physical/for-assets/ ; https://kontakt.io/blog/kontakt-io-unleashes-nano-tag-the-worlds-smallest-disposable-wearable-ble-tag-along-with-two-new-products-opening-a-new-generation-of-kontakt-io-ble-devices/
- AirTag vs Tile: https://www.eufy.com/blogs/smart-tracker/tile-vs-airtag ; https://www.macrumors.com/guide/airtag-vs-tile/
- Teltonika trackers: https://teltone-tracker.com/en/tracker-4glte/34-teltonika-fmc130-4779027312514.html ; https://www.gpstelematics.eu/teltonika-fmb920
- Brother PT-P910BT / PT-P950NW / PT-E560BT / HSe: https://www.senetic.co.uk/product/PTP910BTZ1 ; https://store.brother.co.uk/devices/label-printer/p-touch/pt/ptp950nw ; https://www.ptouchdirect.com/ptouch/pte560btvp-new.html ; https://www.ptouchdirect.com/ptouch/brother-hse-heat-shrink-tube-guide.html
- Zebra ZD421 ribbons/labels: https://www.feedyourzebra.co.uk/zebra-zd421-ribbons.html
- Metalphoto / metal tags UK: https://www.premiumsigns.co.uk/service/metal-asset-tags/ ; https://metalphoto.com/ ; https://jabac.com/metalphoto-photosensitive-anodized-aluminium-labels-tags/
- Irish label suppliers: https://www.labelworld.ie/label-types/asset-tag-labels/ ; https://bkld.ie/product/custom-asset-tags-and-labels/ ; https://cardlogic.ie/asset-tags/
- HSA Guide to General Application Regs – Electricity (Reg. 81): https://www.hsa.ie/eng/Publications_and_Forms/Publications/Retail/Gen_Apps_Electricity.pdf
- HSA Guide – Use of Work Equipment (Regs 52–54): https://www.hsa.ie/eng/publications_and_forms/publications/general_application_regulations/gen_apps_work_equipment.pdf
- S.I. 299/2007 Schedule 1 (revised): https://revisedacts.lawreform.ie/eli/2007/si/299/schedule/1/revised/en/html
- GA1 form context: https://constructionqualifications.com/ga1-lifting-equipment-inspections-report-of-thorough-examination/
- PAT in Ireland (secondary): https://procheck.ie/is-pat-testing-a-legal-requirement-in-ireland/
- EN 50699:2020 at NSAI: https://shop.standards.ie/en-ie/standards/en-50699-2020-1202116_saig_cenelec_cenelec_2901944/
