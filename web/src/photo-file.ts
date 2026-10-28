import { NOT_A_PHOTO } from '@sh/shared'

/**
 * A photo made small on the device before it's sent (ADR 0065, ADR 0083):
 * a phone's photo of several megabytes goes as a few dozen kilobytes, comes
 * out the right way up, and where it was taken (its EXIF) stays behind.
 * A person's is the middle square; a product's keeps its shape, as a rack
 * panel is wide. The browser turns it the right way up as it draws it.
 */
export async function shrinkPhoto(file: File, { side, square }: { side: number; square: boolean }): Promise<Blob> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    // An iPhone's HEIC opens in Safari; a browser that can't open it is told to send another kind.
    await img.decode().catch(() => {
      throw new Error(NOT_A_PHOTO)
    })
    const w = img.naturalWidth
    const h = img.naturalHeight
    if (!w || !h) throw new Error(NOT_A_PHOTO)
    // What's taken from the photo, and how big it's drawn.
    const crop = square ? { x: (w - Math.min(w, h)) / 2, y: (h - Math.min(w, h)) / 2, w: Math.min(w, h), h: Math.min(w, h) } : { x: 0, y: 0, w, h }
    const scale = Math.min(1, side / Math.max(crop.w, crop.h))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(crop.w * scale))
    canvas.height = Math.max(1, Math.round(crop.h * scale))
    const g = canvas.getContext('2d')
    if (!g) throw new Error(NOT_A_PHOTO)
    g.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/jpeg', 0.85))
    if (!blob) throw new Error(NOT_A_PHOTO)
    return blob
  } finally {
    URL.revokeObjectURL(url)
  }
}
