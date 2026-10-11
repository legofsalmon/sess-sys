import { COMMAND_NEEDS, refusalFor, roleCan, roleForEmail, type Ability, type Role, type View } from '@sh/shared'
import { currentAuth, useAuth, type Auth } from './auth.ts'
import { previewKey, usePreview } from './home/Preview.tsx'
import { client } from './sync.ts'
import { useView } from './view.ts'

/**
 * What the person using this device can change (ADR 0034), worked out the
 * way the server works it out, from the device's own copy of the Crew tab,
 * so it holds with no signal and changes as soon as a director's change
 * syncs. Signed in, it's their role once roles are on; on the demo, the
 * persona chosen on "See it as…"; with sign-in off, or roles off, there is
 * none and everything is offered, as before.
 */

/** The demo's personas, as the roles they stand for. A freelancer has their link, not the app. */
const PERSONA_ROLES: Record<string, Role> = { director: 'director', office: 'office', head: 'head', warehouse: 'warehouse', staff: 'crew' }

export interface Access {
  /** The role being held to; none while nothing is checked. */
  role?: Role
  /** Signed in, and nobody is a director yet: everyone can do everything until someone is made one. */
  rolesOff?: true
  /** The Crew tab's person this account is, when found. */
  personId?: string
}

function accessOf(auth: Auth, view: View, persona: string): Access {
  if (auth.status === 'open' && auth.passcode) {
    const role = PERSONA_ROLES[persona]
    return role ? { role } : {}
  }
  if (auth.status !== 'signed-in') return {}
  const { role, on, personId } = roleForEmail(view.crew.people, auth.user.email)
  return on ? { role, ...(personId ? { personId } : {}) } : { rolesOff: true }
}

/** Whether this device's person can make a kind of change. */
export const canWith = (access: Access, ability: Ability) => !access.role || roleCan(access.role, ability)

/** For a screen: who is being held to what, and `can` to ask about a kind of change. */
export function useAccess(): Access & { can: (ability: Ability) => boolean } {
  const auth = useAuth()
  const view = useView()
  const persona = usePreview()
  const access = accessOf(auth, view, persona?.key ?? '')
  return { ...access, can: (ability) => canWith(access, ability) }
}

// Every change goes through the client, so a role's limits hold on every screen, offline too, before anything is kept.
client.guard = (name) => {
  const { role } = accessOf(currentAuth(), client.view(), previewKey())
  return role && !roleCan(role, COMMAND_NEEDS[name]) ? refusalFor(role, COMMAND_NEEDS[name]) : undefined
}
