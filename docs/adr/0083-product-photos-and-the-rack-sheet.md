# ADR 0083: Product photos, on their panels in a rack, and the rack sheet

- **Status:** accepted (part 3 of 3 of a more advanced rack builder)
- **Date:** 27 October 2026
- **Asked for by:** Colly, 23 October 2026, "a more advanced rack builder",
  planned in three parts in the Claude Doc "A more advanced rack builder:
  survey and plan". This is the third part.
- **Builds on:** [ADR 0065](0065-a-photo-on-a-persons-page.md) (a person's
  photo, and how it's kept), [ADR 0038](0038-icons-and-pictures.md)
  (pictures), [ADR 0076](0076-rack-mount-kit-and-the-rack-in-3d.md) (the
  rack in 3D) and [ADR 0079](0079-building-a-rack-up.md) (labels, groups and
  tape).

## Context

The rack builders surveyed for part 1 (STAGERACK, Rackula, Stardraw) draw
each thing with a picture of its front panel, so a rack on screen looks like
the one in the truck, and print a sheet to build it from. Our products had
an icon only, and a rack existed only on screen.

## Decision

- **A product can have a photo.** Its page has Add a photo, then Change
  photo and Remove photo, for whoever changes stock (the office, directors
  and heads of department; everyone with roles off). It's kept as a
  person's photo is: in the documents' storage, read only through the
  server at `/api/models/<id>/photo?v=<when>`, deleted when it's replaced,
  removed, the product is removed, or the app starts fresh. `models` gains
  `photo_key`, `photo_type`, `photo_bytes` and `photo_at`; devices get only
  `photo.at`. A product is nobody's personal data, so everyone signed in
  sees it.
- **Not squared.** The best photo for a rack is often its wide front panel,
  so the device keeps the photo's shape and makes its longer side 1,280
  pixels, as a JPEG with no EXIF. It shows at its own shape on the
  product's page, whole (not cropped) in the stock lists, on a job's kit
  and on an item's page.
- **On its panel in the rack.** Flat, the photo fills the thing's panel and
  its name or label sits on a patch of the panel's colour so it reads over
  any photo. In 3D, the photo is drawn on the face the same way, loaded once
  and drawn again as each one arrives. The tape strip stays at the left.
- **Print the rack sheet**, on the rack's page and in the designer: the
  rack's name, stock code, size and case, its weight, power and what won't
  work, the front and back drawn side by side, the groups key, then what
  goes on the rails top to bottom (where, label and product, group, tape and
  notes) and what's loose in it and in which drawer or shelf. Black on white
  whatever the screen's theme; tape colours and photos print as they show,
  as they're what crew match against. Nothing else on the page prints.
- **The history** says "Put a photo on the product Shure AD4D", "Put a new
  photo on …" and "Took the photo off …", never the picture.

## Considered

- **Sizes filled in from a list of known models** (the plan's "maybe").
  Left out: the open lists (NetBox's device-type library) are of IT kit,
  with few amps, desks or RF, and typing three numbers is quicker than
  checking a match. Revisit if the office finds itself typing the same
  sizes.
- **Several photos a product, or a photo per item.** Not asked for; one is
  enough to know it by and to draw the rack.
- **A PDF made on the server.** The browser's own print, as for call sheets,
  quotes and labels, saves as a PDF anywhere and needs nothing on the
  server.

## Consequences

- Nothing to set in Railway: the bucket the documents and people's photos
  use holds these too. On a server without one, the office is told photos
  wait on it and nobody is offered the button.
- Backups and Download everything hold the columns, not the files, as for
  people's photos.
