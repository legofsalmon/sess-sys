import { changesLinkOf, COMMAND_NEEDS, PURCHASE_NOT_YOURS, STEP_NOT_YOURS, departmentForRole, RATES_REFUSAL_DEPARTMENT, readsRatesIn, LINKS_REFUSAL, personForEmail, RATES_REFUSAL, refusalFor, roleCan, roleForEmail, setsRates, type Ability, type CommandArgs, type Role, type View } from '@sh/shared'
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

/** The demo's personas, as the roles they stand for. The warehouse is a department, run as a head runs one (ADR 0051); a freelancer has their link. */
const PERSONA_ROLES: Record<string, Role> = { director: 'director', office: 'office', head: 'head', warehouse: 'head', staff: 'crew' }

export interface Access {
  /** The role being held to; none while nothing is checked. */
  role?: Role
  /** Signed in, and nobody is a director yet: everyone can do everything until someone is made one. */
  rolesOff?: true
  /** The Crew tab's person this account is, when found. */
  personId?: string
  /** A system admin, named in the server's settings (ADR 0060): held to a director's role whatever their own says. */
  admin?: true
}

function accessOf(auth: Auth, view: View, persona: string): Access {
  if (auth.status === 'open' && auth.passcode) {
    const role = PERSONA_ROLES[persona]
    return role ? { role } : {}
  }
  if (auth.status !== 'signed-in') return {}
  const admin = auth.admin ? { admin: true as const } : {}
  const { role, on, personId } = roleForEmail(view.crew.people, auth.user.email, !!auth.admin)
  if (on) return { role, ...(personId ? { personId } : {}), ...admin }
  // Roles off: who they are still matters, as the way to switch roles on is making yourself the first director.
  const me = personForEmail(view.crew.people, auth.user.email)
  return { rolesOff: true, ...(me ? { personId: me.id } : {}), ...admin }
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

/**
 * Whether this device is sent crew rates (ADR 0046), as the server last
 * said: a screen without them says they're hidden, and doesn't offer to set
 * or agree one.
 */
export const useSeesRates = () => useView().reading.rates

// Every change goes through the client, so a role's limits hold on every screen, offline too, before anything is kept.
client.guard = (name, args) => {
  const view = client.view()
  const { role, personId } = accessOf(currentAuth(), view, previewKey())
  if (role && !roleCan(role, COMMAND_NEEDS[name])) return refusalFor(role, COMMAND_NEEDS[name])
  // Staff crew change only the steps that are theirs (ADR 0073); the server says the same.
  if (role === 'crew' && name === 'jobStep.set') {
    const a = args as CommandArgs<'jobStep.set'>
    const step = view.steps.of(a.projectId)?.steps.find((s) => s.key === a.step)
    if (!personId || step?.ownerId !== personId) return STEP_NOT_YOURS
  }
  // A request on the purchase list is changed or taken back by whoever asked, or by those who change stock (ADR 0077).
  if (role && !roleCan(role, 'stock') && (name === 'purchase.update' || name === 'purchase.remove')) {
    const r = view.purchases.get((args as { id: string }).id)
    if (!personId || r?.askedBy !== personId) return PURCHASE_NOT_YOURS
  }
  // A new link is for a role that is sent the person's link (ADR 0046); the server says the same.
  const relinked = changesLinkOf(name, args)
  if (relinked && view.crew.people.some((p) => p.id === relinked && p.linkHidden)) return LINKS_REFUSAL
  // Crew pay is for a role that reads it (ADR 0046): setting a rate, agreeing a counter-offer or deciding a timesheet.
  // A head who reads their own department's (ADR 0062) sets those alone; the server says the same.
  if (view.reading.rates && view.reading.ratesBy === 'department' && setsRates(name, args)) {
    const a = args as { id?: string; role?: string; department?: string | null }
    const call =
      name === 'call.create' ? undefined : view.crew.calls.find((c) => c.id === a.id || c.offers.some((o) => o.id === a.id))
    const department = name === 'call.create' ? (a.department ?? departmentForRole(a.role ?? '')) : name === 'call.update' && a.department !== undefined ? a.department : call?.department
    return readsRatesIn(view.reading, department) ? undefined : RATES_REFUSAL_DEPARTMENT
  }
  if (view.reading.rates) return undefined
  const countered = name === 'offer.confirm' && view.crew.calls.some((c) => c.offers.some((o) => o.id === (args as CommandArgs<'offer.confirm'>).id && o.status === 'countered'))
  return setsRates(name, args) || countered ? RATES_REFUSAL : undefined
}
