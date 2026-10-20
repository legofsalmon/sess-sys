# ADR 0065: A photo on a person's page

- **Status:** accepted
- **Date:** 20 October 2026
- **Asked for by:** Colly, 20 October 2026 ("allow for upload of peoples
  images on their staff page")
- **Follows:** [ADR 0029](0029-documents.md) (documents' files and where
  they're kept), [ADR 0038](0038-icons-and-pictures.md) (pictures),
  [ADR 0040](0040-a-page-for-each-person.md) (a page for each person),
  [ADR 0062](0062-what-crew-and-freelancers-read-of-other-people.md)
  (what each role reads of other people)

## Context

Every person shows as their initials (ADR 0038): `Avatar` took a photo's
address from the start, but there was nowhere to keep one. Documents' files
have been kept in the backups' bucket since ADR 0029, and the live server
has had its bucket since 19 October, so a photo can go where they go, with
no new setting.

The design system's imagery rule: a face is personal data, so a person's
photo is one they chose or gave, they can change or remove it, and erasing
them erases it.

## Decision

1. **Their page has Add a photo** under their picture, then **Change
   photo** and **Remove photo**. The device makes the middle square of what
   was chosen into a 512-pixel JPEG before sending it, so a phone's photo of
   several megabytes goes as a few dozen kilobytes, comes out the right way
   up, and leaves where it was taken (its EXIF) behind. Removing asks
   first, as the file is deleted.
2. **Who can change it:** the person themselves, and whoever can change
   crew (the office, directors and heads of department). With roles off,
   everyone, as for the rest. The hint under the button says to use a photo
   they gave, or took with their say-so.
3. **Kept as documents' files are** (ADR 0029): in the storage under
   `documents/`, encrypted with BACKUP_KEY when it's set, on the same list
   of files to delete when it's replaced or removed. `people` gains
   `photo_key`, `photo_type`, `photo_bytes` and `photo_at`; devices get only
   `photo.at`, which makes its address, `/api/people/<id>/photo?v=<at>`. A
   new photo is a new address, so the browser keeps each one as long as it
   likes; the app keeps the newest 400 it has shown for three months, so
   faces show with no signal, and one it hasn't kept shows the initials.
4. **Shown wherever the person is:** their page, the People list, and
   Home's "Working this week" and "Away this week". The overlapping faces on
   a job still draw initials.
5. **Read as their phone is** (ADR 0062): staff crew see colleagues'
   photos; a freelancer signed in sees only their own. The server leaves
   `photo` off the person and the address answers 404.
6. **Only what a browser can show:** JPEG, PNG or WebP, checked by the
   first bytes on the server. An iPhone's HEIC is turned into a JPEG by the
   device as it's squared; a browser that can't open it says to choose
   another.
7. **Erasing a person** (ADR 0027) puts the file on the list with their
   documents' and clears the columns; earlier copies devices are sent have
   no photo. A photo can't be put on an erased person's page. **Combining
   people** (ADR 0055): the one kept keeps theirs, or takes the newest of
   the others' if they have none; the rest are deleted. **Starting fresh**
   deletes them all.
8. **The history** says "Put a photo on Dara Quinn's page", "Put a new
   photo on …" and "Took the photo off …", never the picture.

## Considered

- **From a freelancer's private link.** Left for later: the link page has
  no script, so it can't square or shrink a photo, and the office asked for
  it on the staff page.
- **Resizing on the server.** Rejected: it needs an image library on the
  server and the full photo sent on a phone's signal; the device does it
  for nothing.
- **A picture per thing** (products, cases). Not asked for; `Thumb` already
  takes an address, and this storage would do.

## Consequences

- Nothing to set in Railway: the bucket the backups and documents use holds
  photos too. On a server without one, the office's devices say photos wait
  on it, and nobody else is offered the button.
- Backups and Download everything hold the columns, not the files, as for
  documents. A restore from a backup made before a photo was put up shows
  the initials until it's added again.

## Open

- **The office can put up any photo.** The rule is a photo they gave; the
  app asks for that in words and can't check it. Rated 1.
- **Faces on a job** (`Avatars`) still draw initials. Rated 1.
- **Faces stay kept on a device after signing out** until they age out,
  as the map's pictures do. Rated 1.
