import { feedCodeFor, feedPath } from '@sh/shared'
import { useEffect, useState } from 'react'

/**
 * A person's read-only calendar feed address (ADR 0012), worked out on the
 * device from their private link, the same way as the server. Empty until
 * it is ready, or where the browser can't work it out (an address that
 * isn't https).
 */
export function useFeedAddress(linkToken: string | undefined): string {
  const [feed, setFeed] = useState({ token: '', address: '' })
  useEffect(() => {
    if (!linkToken || !globalThis.crypto?.subtle) return
    let live = true
    void feedCodeFor(linkToken).then((code) => live && setFeed({ token: linkToken, address: `${location.origin}${feedPath(code)}` }))
    return () => {
      live = false
    }
  }, [linkToken])
  // A new link gives a new address: never show the old one meanwhile.
  return feed.token === linkToken ? feed.address : ''
}

/** Calendar apps on iPhones, Macs and Outlook subscribe when opened with webcal:. */
export const webcal = (address: string) => address.replace(/^https?:/, 'webcal:')
