/** How the app writes sizes and times, the same on every screen. */

export function size(bytes = 0) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** "today at 03:02", "yesterday at 03:01", "tomorrow at 03:00", or "28 Sept at 03:00". */
export function when(iso: string) {
  const at = new Date(iso)
  const time = at.toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit' })
  const dayOffset = (offset: number) => {
    const d = new Date()
    d.setDate(d.getDate() + offset)
    return d.toDateString()
  }
  if (at.toDateString() === dayOffset(0)) return `today at ${time}`
  if (at.toDateString() === dayOffset(-1)) return `yesterday at ${time}`
  if (at.toDateString() === dayOffset(1)) return `tomorrow at ${time}`
  return `${at.toLocaleDateString('en-IE', { day: 'numeric', month: 'short' })} at ${time}`
}
