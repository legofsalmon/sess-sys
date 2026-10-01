import { useEffect, useState } from 'react'
import './storage.css'
import { storage } from './sync.ts'
import { onTabRole, tabRole, takeOverTab, type TabRole } from './tabs.ts'
import type { StorageState } from './storage.ts'

/**
 * One line at the top while this device isn't keeping the data: another
 * tab has it (tabs.ts), the browser keeps nothing between reloads, or the
 * last save failed (storage.ts). Nothing while all is well, which is nearly
 * always.
 */

function useTabRole(): TabRole {
  const [role, setRole] = useState(tabRole)
  useEffect(() => onTabRole(setRole), [])
  return role
}

function useStorageState(): StorageState {
  const [state, setState] = useState(() => storage.state())
  useEffect(() => storage.subscribe(setState), [])
  return state
}

export function StorageBanner() {
  const role = useTabRole()
  const { mode, problem } = useStorageState()
  if (role === 'reader')
    return (
      <div className="keep">
        <span>The app is open in another tab.</span>
        <button type="button" onClick={() => void takeOverTab()}>
          Use this tab
        </button>
      </div>
    )
  if (problem)
    return (
      <div className="keep bad" role="alert">
        {problem}
      </div>
    )
  if (mode === 'memory') return <div className="keep">This browser isn't keeping a copy of the data: changes are sent, but nothing is kept if you close it.</div>
  return null
}
