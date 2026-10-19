import { iconFrame, icons, type Pin } from '@sh/shared'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef, useState } from 'react'

/**
 * A map (ADR 0057): OpenStreetMap's own pictures of the map, drawn with
 * Leaflet, both open and free to use with their credit shown. Loaded only
 * on the pages that show one, so the rest of the app stays as quick to
 * open. The pictures need signal; ones already seen are kept on the device
 * by the app's worker, and with none the pins and the words around the map
 * still say where.
 *
 * Pins are the design system's venue icon: neutral at rest, and the "you"
 * colour for the one being placed. The page scrolls past the map: the wheel
 * zooms only once the map has been clicked, and on a phone one finger
 * moves the page, never the map, unless a pin is being placed.
 */

export interface Mark {
  id: string
  name: string
  pin: Pin
  /** Its page, opened from its pin's label. */
  href?: string
  /** A few words under its name in the label: "3 jobs". */
  line?: string
}

const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const CREDIT = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>'
/** Ireland, for a map with nothing on it yet. */
const IRELAND: L.LatLngExpression = [53.4, -7.9]

const pinSvg = () =>
  `<svg viewBox="${iconFrame.viewBox}" width="32" height="32" stroke-width="${iconFrame['stroke-width']}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons.venue
    .map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`)
    .join('')}</svg>`

const pinIcon = (here: boolean) => L.divIcon({ className: here ? 'map-pin here' : 'map-pin', html: pinSvg(), iconSize: [32, 32], iconAnchor: [16, 31], popupAnchor: [0, -28] })

/** A pin's label: its name, linking to its page, and its line. Built from nodes, so a name is never read as markup. */
function label(m: Mark): HTMLElement {
  const box = document.createElement('div')
  const name = document.createElement(m.href ? 'a' : 'b')
  name.textContent = m.name
  if (m.href && name instanceof HTMLAnchorElement) name.href = m.href
  box.append(name)
  if (m.line) {
    const p = document.createElement('p')
    p.textContent = m.line
    box.append(p)
  }
  return box
}

export default function MapView({
  marks,
  placing,
  onPlace,
  label: name,
  tall = false,
}: {
  marks: Mark[]
  /** The pin being placed, in the "you" colour, moved by tapping the map or dragging it; null until there is one. */
  placing?: Pin | null
  onPlace?: (p: Pin) => void
  /** What the map is of, for a screen reader: "Map of The Heritage". */
  label: string
  /** The list's map, taller than a venue's. */
  tall?: boolean
}) {
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map>(null)
  const layer = useRef<L.LayerGroup>(null)
  /** The pin last put down on the map itself, by a tap or a drag. */
  const fromMap = useRef<Pin>(null)
  const onPlaceRef = useRef<(p: Pin) => void>(null!)
  onPlaceRef.current = (p: Pin) => {
    fromMap.current = p
    onPlace?.(p)
  }
  const [noPictures, setNoPictures] = useState(false)
  const isPlacing = placing !== undefined

  // The map itself, once.
  useEffect(() => {
    const m = L.map(box.current!, { scrollWheelZoom: false, dragging: !L.Browser.mobile, zoomSnap: 0.5 })
    L.tileLayer(TILES, { maxZoom: 19, attribution: CREDIT, crossOrigin: '' })
      .on('tileerror', () => setNoPictures(true))
      .on('tileload', () => setNoPictures(false))
      .addTo(m)
    // The wheel is the page's until the map is clicked or tabbed to.
    m.on('focus', () => m.scrollWheelZoom.enable())
    m.on('blur', () => m.scrollWheelZoom.disable())
    m.on('click', (e: L.LeafletMouseEvent) => onPlaceRef.current({ lat: round(e.latlng.lat), lng: round(e.latlng.lng) }))
    layer.current = L.layerGroup().addTo(m)
    map.current = m
    m.setView(IRELAND, 6)
    // A map drawn while its box was still settling (a card opening) draws only part of itself.
    const resize = new ResizeObserver(() => m.invalidateSize())
    resize.observe(box.current!)
    return () => {
      resize.disconnect()
      m.remove()
      map.current = null
    }
  }, [])

  // On a phone, one finger moves the map only while a pin is being placed.
  useEffect(() => {
    const m = map.current
    if (!m || !L.Browser.mobile) return
    if (isPlacing) m.dragging.enable()
    else m.dragging.disable()
  }, [isPlacing])

  // The pins, and the view that takes them all in.
  const key = JSON.stringify([marks.map((m) => [m.id, m.name, m.pin.lat, m.pin.lng, m.line]), placing])
  const framed = useRef('')
  useEffect(() => {
    const m = map.current
    const g = layer.current
    if (!m || !g) return
    g.clearLayers()
    for (const mark of marks) {
      L.marker([mark.pin.lat, mark.pin.lng], { icon: pinIcon(false), title: mark.name, alt: mark.name, keyboard: true })
        .bindPopup(() => label(mark))
        .addTo(g)
    }
    if (placing) {
      const moving = L.marker([placing.lat, placing.lng], { icon: pinIcon(true), draggable: true, title: 'The new pin: drag it, or tap the map', alt: 'The new pin', keyboard: true })
      moving.on('dragend', () => {
        const at = moving.getLatLng()
        onPlaceRef.current({ lat: round(at.lat), lng: round(at.lng) })
      })
      moving.addTo(g)
    }
    // Framed again when what's on it changes; a pin put down on the map itself stays where the person put it.
    if (placing) {
      if (fromMap.current && fromMap.current.lat === placing.lat && fromMap.current.lng === placing.lng) return
      framed.current = ''
      m.setView([placing.lat, placing.lng], Math.max(m.getZoom(), 15))
      return
    }
    const points = marks.map((x) => x.pin)
    const frame = JSON.stringify(points)
    if (frame === framed.current) return
    framed.current = frame
    if (points.length === 1) m.setView([points[0]!.lat, points[0]!.lng], 15)
    else if (points.length > 1) m.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])), { padding: [32, 32], maxZoom: 15 })
    else m.setView(IRELAND, 6)
  }, [key])

  return (
    <div className="map-box">
      <div ref={box} className={`map${tall ? ' tall' : ''}${isPlacing ? ' placing' : ''}`} role="region" aria-label={name} />
      {noPictures && <p className="hint">No signal for the map's pictures: the pins still show where. They fill in when you're back online.</p>}
    </div>
  )
}

/** Six places of decimals is a hand's width: as close as a pin needs. */
const round = (n: number) => Math.round(n * 1e6) / 1e6
