import { createContext, useContext } from 'react'

/**
 * Home while this device's copy is still arriving (audit, 20 October 2026,
 * finding 1): its counts are still climbing and its empty lists may only be
 * not here yet, so neither is said as if it were so.
 */
export const Copying = createContext(false)

/** What Home says in place of a count or an empty list until the copy has arrived. */
export const STILL_ARRIVING = 'Still catching up: this shows once the company’s copy has arrived on this device.'

export const useCopying = () => useContext(Copying)
