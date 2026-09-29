/**
 * Shared by the History tab and the exported history (ADR 0006).
 */

/** A change that waited on its device this long or longer was made offline (or with the app closed before it could send). */
export const OFFLINE_AFTER_SECONDS = 60

/** "under a minute", "25 min", "2 h 10 min", "3 days 4 h". */
export function waitLabel(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  if (minutes < 1) return 'under a minute'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`
  const days = Math.floor(hours / 24)
  return `${days} ${days === 1 ? 'day' : 'days'}${hours % 24 ? ` ${hours % 24} h` : ''}`
}
