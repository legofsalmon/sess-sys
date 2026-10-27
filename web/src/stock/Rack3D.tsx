import { acrossAt, acrossFor, RACK_SIDE_LABELS, spanAcross, TAPE_COLOUR_SWATCHES, type ModelView, type RackAcross, type RackPart, type RackSide, type RackView, type SlotView } from '@sh/shared'
import { useEffect, useRef, useState, type DragEvent } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { DRAG_TYPE, heldOf, type Held } from './rack-drag.ts'
import { GUESS_KIT_DEPTH, RACK_U as U, rackSize } from './rack-size.ts'

/**
 * The rack in 3D (ADR 0076), loaded only when the designer shows it: the
 * case, its four rails and each thing on them drawn to its size, front
 * kit from the front rails back, back kit from the back rails forward, so
 * two that meet in the middle are seen. Turned by dragging, zoomed by
 * scrolling or pinching, or set square to the front, back or side.
 *
 * Kit is put in as on the flat view: dragged from the list, or picked up
 * (pressed) and then pressed where it goes, onto the face that's towards
 * you. A thing in the rack is pressed to pick it up. The flat view stays,
 * for the keyboard and for anyone who'd rather.
 */

/** The 19-inch panel's width, and the width of the body behind a full-width panel, in mm. */
const PANEL = 482.6
const BODY = 430
const RAIL = 16

type Look = 'angle' | 'front' | 'rear' | 'side'
const LOOKS: [Look, string][] = [
  ['angle', 'At an angle'],
  ['front', 'Front'],
  ['rear', 'Back'],
  ['side', 'Side'],
]

interface Props {
  r: RackView
  held: Held | undefined
  /** What's held, for its size where it would go. */
  heldModel: ModelView | undefined
  mayChange: boolean
  /** Slots something's wrong with. */
  bad: ReadonlySet<string | undefined>
  onHold: (h: Held | undefined) => void
  onPlace: (h: Held, top: number, side: RackSide, across?: RackAcross) => void
}

/** A colour role from the page's stylesheet, as three.js reads colours, whatever form the stylesheet gives it in. */
function roleColour(el: Element, role: string, fallback: string): THREE.Color {
  const value = getComputedStyle(el).getPropertyValue(role).trim() || fallback
  const c = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  if (!c) return new THREE.Color(fallback)
  c.fillStyle = fallback
  c.fillStyle = value
  c.fillRect(0, 0, 1, 1)
  const [r, g, b] = c.getImageData(0, 0, 1, 1).data
  return new THREE.Color().setRGB(r! / 255, g! / 255, b! / 255, THREE.SRGBColorSpace)
}

/**
 * A thing's panel: its label or name, a strip of its tape colour at the
 * left (content, as the tape is), and for a rack part (ADR 0079) what
 * makes it one: a vent's slots, a drawer's handle, a shelf's lip.
 */
function labelTexture(text: string, units: number, parts: number, ink: THREE.Color, face: THREE.Color, tape: string | null, part: RackPart | null | undefined): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(1024 / parts)
  canvas.height = Math.round(1024 * ((units * U) / PANEL))
  const c = canvas.getContext('2d')!
  const inkHex = `#${ink.getHexString(THREE.SRGBColorSpace)}`
  c.fillStyle = `#${face.getHexString(THREE.SRGBColorSpace)}`
  c.fillRect(0, 0, canvas.width, canvas.height)
  c.strokeStyle = inkHex
  c.globalAlpha = 0.35
  c.lineWidth = 6
  if (part === 'vent')
    for (let x = 80; x < canvas.width - 80; x += 36) {
      c.beginPath()
      c.moveTo(x, canvas.height * 0.25)
      c.lineTo(x, canvas.height * 0.75)
      c.stroke()
    }
  if (part === 'drawer') {
    c.lineWidth = 10
    c.strokeRect(canvas.width * 0.38, canvas.height * 0.62, canvas.width * 0.24, canvas.height * 0.12)
  }
  if (part === 'shelf') c.fillRect(0, canvas.height * 0.82, canvas.width, canvas.height * 0.18)
  c.globalAlpha = 1
  if (tape) {
    c.fillStyle = tape
    c.fillRect(0, 0, 28, canvas.height)
  }
  c.fillStyle = inkHex
  c.font = `600 ${Math.min(64, canvas.height * (part === 'drawer' ? 0.3 : 0.45))}px system-ui, sans-serif`
  c.textBaseline = 'middle'
  c.fillText(text, 48, part === 'drawer' ? canvas.height * 0.3 : canvas.height / 2, canvas.width - 96)
  const t = new THREE.CanvasTexture(canvas)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** Where a thing on the rails sits, in mm from the middle of the rack: x across, y up, z towards the front. */
function boxOf(s: SlotView, size: ReturnType<typeof rackSize>) {
  const units = s.model?.units ?? 1
  const [from, to] = spanAcross(s.model?.rackWidth, s.across)
  const parts = Math.round(1 / (to - from))
  const face = PANEL / parts
  // A blank or vent is a panel and no more; a shelf a tray behind it (ADR 0079).
  const part = s.model?.rackPart
  const deep = part === 'blank' || part === 'vent' ? 4 : (s.model?.depthMm ?? GUESS_KIT_DEPTH)
  const h = units * U - 1.5
  const front = s.side === 'front'
  return {
    units,
    face,
    body: parts === 1 ? BODY : face - 8,
    parts,
    deep,
    h,
    // Left and right as seen facing those rails: from the back, the rack's left is on the right.
    x: (front ? 1 : -1) * (-PANEL / 2 + ((from + to) / 2) * PANEL),
    y: size.height / 2 - (s.top! - 1) * U - h / 2 - 0.75,
    faceZ: front ? size.depth / 2 + 2 : -size.depth / 2 - 2,
    bodyZ: front ? size.depth / 2 - deep / 2 : -size.depth / 2 + deep / 2,
  }
}

export default function Rack3D({ r, held, heldModel, mayChange, bad, onHold, onPlace }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const three = useRef<{
    renderer: THREE.WebGLRenderer
    scene: THREE.Scene
    camera: THREE.PerspectiveCamera
    controls: OrbitControls
    rack: THREE.Group
    ghost: THREE.Mesh
    render: () => void
  }>(undefined)
  const [look, setLook] = useState<Look>('angle')
  const [noGl, setNoGl] = useState(false)
  const size = rackSize(r)
  // Kept current for the pointer handlers set up once.
  const now = useRef({ r, held, heldModel, size, onHold, onPlace, mayChange })
  now.current = { r, held, heldModel, size, onHold, onPlace, mayChange }

  // The scene, the camera and the controls, once.
  useEffect(() => {
    const el = box.current
    if (!el) return
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
    } catch {
      setNoGl(true)
      return
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    el.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    scene.add(new THREE.HemisphereLight(0xffffff, 0x666666, 2.2))
    const sun = new THREE.DirectionalLight(0xffffff, 1.6)
    sun.position.set(800, 1400, 1200)
    scene.add(sun)
    const camera = new THREE.PerspectiveCamera(35, 1, 10, 50_000)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = false
    controls.minDistance = 300
    controls.maxDistance = 12_000
    const rack = new THREE.Group()
    scene.add(rack)
    const ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.45, depthWrite: false }))
    ghost.visible = false
    scene.add(ghost)
    const render = () => renderer.render(scene, camera)
    controls.addEventListener('change', render)
    const fit = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      if (!w || !h) return
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      render()
    }
    const watch = new ResizeObserver(fit)
    watch.observe(el)
    three.current = { renderer, scene, camera, controls, rack, ghost, render }
    fit()
    return () => {
      watch.disconnect()
      controls.dispose()
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
          o.geometry.dispose()
          for (const m of [o.material].flat()) {
            ;(m as THREE.MeshStandardMaterial).map?.dispose()
            m.dispose()
          }
        }
      })
      renderer.dispose()
      renderer.domElement.remove()
      three.current = undefined
    }
  }, [])

  // The rack and what's in it, drawn again whenever they change.
  useEffect(() => {
    const t = three.current
    const el = box.current
    if (!t || !el) return
    for (const o of [...t.rack.children]) {
      t.rack.remove(o)
      o.traverse((x) => {
        if (x instanceof THREE.Mesh || x instanceof THREE.LineSegments) {
          x.geometry.dispose()
          for (const m of [x.material].flat()) {
            ;(m as THREE.MeshStandardMaterial).map?.dispose()
            m.dispose()
          }
        }
      })
    }
    const ink = roleColour(el, '--ink', '#222222')
    const panel = roleColour(el, '--panel', '#ffffff')
    const line = roleColour(el, '--ds-line-strong', '#888888')
    const muted = roleColour(el, '--muted', '#777777')
    const warn = roleColour(el, '--warn', '#9a6700')
    const accent = roleColour(el, '--accent', '#ee3744')
    ;(t.ghost.material as THREE.MeshBasicMaterial).color = accent

    // The case, see-through, and its edges.
    const o = size.outside
    const shell = new THREE.BoxGeometry(o.w, o.h, o.d)
    t.rack.add(new THREE.Mesh(shell, new THREE.MeshStandardMaterial({ color: line, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide })))
    t.rack.add(new THREE.LineSegments(new THREE.EdgesGeometry(shell), new THREE.LineBasicMaterial({ color: muted })))
    // The rails, front and back, either side.
    const railMat = new THREE.MeshStandardMaterial({ color: muted, metalness: 0.4, roughness: 0.5 })
    for (const x of [-1, 1])
      for (const z of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(RAIL, size.height, 3), railMat.clone())
        rail.position.set(x * (PANEL / 2 - RAIL / 2), 0, z * (size.depth / 2))
        t.rack.add(rail)
      }
    // Each rack unit marked across the rails, front and back, so where kit would go is seen.
    const marks: number[] = []
    for (let u = 0; u <= size.units; u++)
      for (const z of [size.depth / 2, -size.depth / 2]) marks.push(-PANEL / 2, size.height / 2 - u * U, z, PANEL / 2, size.height / 2 - u * U, z)
    const unitLines = new THREE.BufferGeometry()
    unitLines.setAttribute('position', new THREE.Float32BufferAttribute(marks, 3))
    t.rack.add(new THREE.LineSegments(unitLines, new THREE.LineBasicMaterial({ color: line, transparent: true, opacity: 0.6 })))
    // Each thing on the rails.
    for (const s of r.slots) {
      if (s.top === null) continue
      const b = boxOf(s, size)
      const wrong = bad.has(s.id)
      const picked = held?.kind === 'slot' && held.slotId === s.id
      const tone = wrong ? warn : picked ? accent : line
      const group = new THREE.Group()
      group.userData.slotId = s.id
      const part = s.model?.rackPart
      // A shelf is a tray, not a box: what's on it shows.
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(b.body, part === 'shelf' ? 3 : b.h - 2, b.deep),
        new THREE.MeshStandardMaterial({ color: tone, roughness: 0.8, transparent: !!s.model?.dryHire, opacity: s.model?.dryHire ? 0.55 : 1 })
      )
      body.position.set(b.x, part === 'shelf' ? b.y - b.h / 2 + 2 : b.y, b.bodyZ)
      const named = part === 'blank' && !s.label ? '' : `${s.label || s.model?.name || '?'}${s.model?.dryHire ? ' · dry hire' : ''}`
      const label = labelTexture(named, b.units, b.parts, wrong ? warn : ink, panel, s.colour ? TAPE_COLOUR_SWATCHES[s.colour] : null, part)
      const plain = new THREE.MeshStandardMaterial({ color: panel, roughness: 0.6 })
      const faces = [plain, plain, plain, plain, plain, plain].map((m) => m.clone())
      // A box's faces run +x, -x, +y, -y, +z, -z: the name goes on the one towards whoever faces that rail.
      faces[s.side === 'front' ? 4 : 5] = new THREE.MeshStandardMaterial({ map: label, roughness: 0.6 })
      const plate = new THREE.Mesh(new THREE.BoxGeometry(b.face, b.h, 4), faces)
      plate.position.set(b.x, b.y, b.faceZ)
      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(plate.geometry), new THREE.LineBasicMaterial({ color: tone }))
      edge.position.copy(plate.position)
      group.add(plate, edge)
      if (part !== 'blank' && part !== 'vent') group.add(body)
      t.rack.add(group)
    }
    t.ghost.visible = false
    t.render()
  }, [r, held, bad, size.height, size.depth, size.outside.w, size.outside.h, size.outside.d])

  // Square to a face, or at an angle.
  useEffect(() => {
    const t = three.current
    if (!t) return
    const o = size.outside
    // Far enough back for the whole case to fit, across or up, whichever is tighter.
    const radius = Math.hypot(o.w, o.h, o.d) / 2
    const vFov = THREE.MathUtils.degToRad(t.camera.fov)
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * t.camera.aspect)
    const far = (radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.02
    const at: Record<Look, [number, number, number]> = {
      angle: [far * 0.55, far * 0.3, far * 0.8],
      front: [0, 0, far],
      rear: [0, 0, -far],
      side: [far, 0, 0],
    }
    t.camera.position.set(...at[look])
    t.controls.target.set(0, 0, 0)
    t.controls.update()
    t.render()
  }, [look, size.outside.w, size.outside.h, size.outside.d])

  /** The rack unit and the face under the pointer: the face towards the camera. */
  const target = (clientX: number, clientY: number): { top: number; side: RackSide; across: RackAcross } | undefined => {
    const t = three.current
    if (!t) return undefined
    const rect = t.renderer.domElement.getBoundingClientRect()
    const ray = new THREE.Raycaster()
    ray.setFromCamera(new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1), t.camera)
    const { size } = now.current
    const side: RackSide = t.camera.position.z >= 0 ? 'front' : 'rear'
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), side === 'front' ? -size.depth / 2 : size.depth / 2)
    const hit = ray.ray.intersectPlane(plane, new THREE.Vector3())
    if (!hit || Math.abs(hit.x) > PANEL / 2 + 60 || Math.abs(hit.y) > size.height / 2) return undefined
    // Seen from the back, the left of the rack is on the right.
    const x = side === 'front' ? (hit.x + PANEL / 2) / PANEL : (PANEL / 2 - hit.x) / PANEL
    const across = acrossAt(Math.min(1, Math.max(0, x)), now.current.heldModel?.rackWidth)
    return { top: Math.min(size.units, Math.floor((size.height / 2 - hit.y) / U) + 1), side, across }
  }

  /** Shows where what's held would go. */
  const ghostAt = (at: { top: number; side: RackSide; across: RackAcross } | undefined) => {
    const t = three.current
    if (!t) return
    const { size, heldModel } = now.current
    t.ghost.visible = !!at
    if (at) {
      const h = (heldModel?.units ?? 1) * U
      const [from, to] = spanAcross(heldModel?.rackWidth, at.across)
      t.ghost.scale.set(PANEL * (to - from), h, 30)
      t.ghost.position.set((at.side === 'front' ? 1 : -1) * (-PANEL / 2 + ((from + to) / 2) * PANEL), size.height / 2 - (at.top - 1) * U - h / 2, at.side === 'front' ? size.depth / 2 + 18 : -size.depth / 2 - 18)
    }
    t.render()
  }

  /** The thing on the rails under the pointer. */
  const slotUnder = (clientX: number, clientY: number): string | undefined => {
    const t = three.current
    if (!t) return undefined
    const rect = t.renderer.domElement.getBoundingClientRect()
    const ray = new THREE.Raycaster()
    ray.setFromCamera(new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1), t.camera)
    for (const hit of ray.intersectObjects(t.rack.children, true)) {
      let o: THREE.Object3D | null = hit.object
      while (o && !o.userData.slotId) o = o.parent
      if (o) return o.userData.slotId as string
    }
    return undefined
  }

  // A press, told from a turn by how far the pointer moved.
  const down = useRef<{ x: number; y: number }>(undefined)

  const placed = r.slots.filter((s) => s.top !== null)
  return (
    <div className="rack-3d">
      <div className="filters" role="group" aria-label="Look at it">
        {LOOKS.map(([k, label]) => (
          <button key={k} type="button" aria-pressed={look === k} onClick={() => setLook(k)}>
            {label}
          </button>
        ))}
      </div>
      {noGl ? (
        <p className="hint">This browser can't draw in 3D. Front and back shows the same rack, flat.</p>
      ) : (
        <div
          ref={box}
          className={`rack-3d-scene${held ? ' holding-one' : ''}`}
          role="img"
          aria-label={`${r.model.name} in 3D: ${placed.length === 1 ? '1 thing' : `${placed.length} things`} on the rails${placed.length ? `: ${placed.map((s) => `${s.label || s.model?.name || '?'} at U${s.top}${acrossFor(s.model?.rackWidth).length ? ` ${s.across === 'middle' ? 'in the middle' : `on the ${s.across}`}` : ''} on the ${RACK_SIDE_LABELS[s.side].toLowerCase()}`).join(', ')}` : ''}. Front and back shows the same, to use with a keyboard.`}
          onPointerDown={(e) => {
            down.current = { x: e.clientX, y: e.clientY }
          }}
          onPointerMove={(e) => now.current.held && !now.current.held.drag && ghostAt(target(e.clientX, e.clientY))}
          onPointerUp={(e) => {
            const d = down.current
            down.current = undefined
            if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || !now.current.mayChange) return
            const { held, onPlace, onHold } = now.current
            if (held) {
              const at = target(e.clientX, e.clientY)
              if (at) onPlace(held, at.top, at.side, at.across)
              return
            }
            const slotId = slotUnder(e.clientX, e.clientY)
            if (slotId) onHold({ kind: 'slot', slotId })
          }}
          onDragOver={(e: DragEvent) => {
            if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
            e.preventDefault()
            ghostAt(target(e.clientX, e.clientY))
          }}
          onDragLeave={() => ghostAt(undefined)}
          onDrop={(e: DragEvent) => {
            e.preventDefault()
            ghostAt(undefined)
            const h = heldOf(e)
            const at = target(e.clientX, e.clientY)
            if (h && at) now.current.onPlace(h, at.top, at.side, at.across)
          }}
        />
      )}
      <p className="hint">
        Drag to turn it, scroll or pinch to zoom. Kit goes on the face towards you{look === 'angle' || look === 'front' ? ', the front' : look === 'rear' ? ', the back' : ''}: turn it round to put kit on the back.
        {size.depthGuessed ? ' No depth is given for the rack, so it is drawn 500 mm deep.' : ''}
      </p>
    </div>
  )
}
