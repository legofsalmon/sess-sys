# ADR 0057: Venues on the map

- **Status:** accepted
- **Date:** 19 October 2026
- **Asked for by:** Colly, 19 October 2026 ("Can you add a map interface for
  the individual venue pages and a overall map for the /jobs/venues page")

## Context

A venue's page ([ADR 0032](0032-venue-and-client-pages-and-their-documents.md))
showed its address and a link out to a Google Maps search. The live app has
around sixty real venues, most brought in from calendar titles: many have a
name and no address, and an Eircode, where there is one, is something the
open map data mostly doesn't know. Crew open these pages on a phone in a van
or a car park, often with poor signal.

Colly prefers open tools that don't lock the company in.

## Decision

### The map

- **OpenStreetMap, drawn with Leaflet.** Both are open and free to use with
  their credit shown on the map; no account, no key, no bill. Leaflet loads
  only on the pages with a map (its own chunk, about 45 KB compressed), so the
  rest of the app opens as fast as before.
- **A venue's page** has an "On the map" card under its details: the map at
  its pin and **Directions**, which opens the phone's maps app at the pin.
  The address's Map link stays only until the venue has a pin.
- **The Venues list** (Jobs › Venues) has one map above the list with every
  venue that has a pin; tapping a pin names the venue, with its jobs, and
  links to its page. A line under it says how many are on the map, and each
  venue in the list that isn't says "not on the map yet".
- **The page scrolls past the map.** The mouse wheel zooms only once the
  map has been clicked; on a phone one finger moves the page and two zoom,
  except while a pin is being placed.
- **Dark theme:** the map's pictures are turned to night colours, so a white
  map never lights up a dark room. Pins are the design system's venue icon:
  neutral (the page's ink) at rest, the "you" colour for the pin being
  placed.
- **No signal:** the pins and words still show; the app's worker keeps the
  last 500 map pictures seen for a month, so a venue opened before still
  shows its map. With none, a line says the pictures come back with signal.

### A venue's pin

- **Kept on the venue** (`lat`, `lng`, both or neither), so the map needs no
  look-up once a venue is placed and works offline.
- **Set on its own**, with `venue.pin` (pin or null), never by saving the
  venue's details. A phone on an older version saving a venue leaves its pin
  where it is. It needs what changing jobs needs, is in the history ("Put The
  Heritage on the map", "Took … off the map"), and an offline change to a pin
  someone else has since moved is turned down as a conflict, as for other
  fields ([ADR 0049](0049-holding-up-at-real-size.md)).
- **Placing one**, from the venue's page (Put it on the map, Move the pin):
  - a venue not yet placed is looked up straight away by its name and
    address, and the first place found becomes the new pin to check, with
    the others to pick from;
  - or paste a Google Maps or OpenStreetMap link, or coordinates
    ("53.1336, -7.1512");
  - or tap the map where it is, or drag the pin.
  Nothing is saved until **Save the pin**. **Take it off the map** clears it.
- **Find the rest**, on the Venues list's map: looks up each venue not yet
  placed, one after another, then lists what was found, each ticked, to
  untick any that's wrong; one press puts the ticked ones on the map. Those
  not found are linked, to place from their pages. Stop looking stops it.
  Nothing is placed without someone pressing.

### Looking up

- **Through the server**, which asks OpenStreetMap's search (Nominatim) in
  Ireland and the UK, keeping to its rules: the app names itself, at most one
  search a second however many phones ask, and the same search is answered
  from memory for a day. `NOMINATIM_URL` points it at another copy of the
  search if the company ever runs its own.
- **Best first:** the name and address together, the address, the address
  without its Eircode, then the name alone; the first that finds anything
  answers, at most four searches a venue.
- **When it's down** the reason is said in words, and pasting or tapping
  still places the pin.

## Consequences

- Venues brought in by name only can be placed in one sitting with Find the
  rest, then checked; a wrong one is moved from its page.
- Close venues (several in Dublin) overlap on the whole-country view until
  zoomed in. Grouping pins into clusters is left until the number of venues
  calls for it.
- The map's pictures come from OpenStreetMap's own servers, which ask for
  light use; one company's office and crew is that. If use ever grows, the
  map can point at another provider of the same pictures without changing
  anything else.
- The pin is in the export ("Download everything") with the venue.
