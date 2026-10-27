import type { JobStep, StepRecord } from '@sh/shared'
import type { Queryable } from '../db.ts'

/** Reading a job's steps back as devices see them (ADR 0073). */

const STEP = `id, project_id, step, owner_id, to_char(done_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS done_at, done_by`

type Row = Record<string, any>

export const toStep = (r: Row): StepRecord => ({
  id: r.id,
  projectId: r.project_id,
  step: r.step as JobStep,
  ownerId: r.owner_id ?? null,
  doneAt: r.done_at ?? null,
  doneBy: r.done_by ?? null,
})

export async function getStep(q: Queryable, id: string) {
  const { rows } = await q.query(`SELECT ${STEP} FROM job_steps WHERE id = $1`, [id])
  return rows[0] ? toStep(rows[0]) : undefined
}
