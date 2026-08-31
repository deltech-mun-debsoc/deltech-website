// Recruitment audit trail. Separate from src/lib/audit.ts because recruitment
// events carry cycle/candidate/session correlation the generic AuditLog has no
// columns for, and because RecruitmentAuditEvent is append-only at the database
// level (a trigger rejects UPDATE and DELETE: see the recruitment_module
// migration).
//
// Unlike the generic audit(), a REJECTED event is a first-class outcome: refused
// permission checks and refused state transitions are recorded, not dropped.

import { randomUUID } from "node:crypto"
import { prisma } from "@/lib/prisma"
import type { Prisma, PrismaClient } from "@/generated/prisma/client"

export type AuditActor = {
  id?: string | null
  email: string
  role?: string | null
}

export interface RecruitmentAuditInput {
  eventType: string
  actor: AuditActor
  cycleId?: string | null
  candidateId?: string | null
  sessionId?: string | null
  evaluationId?: string | null
  groupId?: string | null
  previousState?: Prisma.InputJsonValue | null
  newState?: Prisma.InputJsonValue | null
  reason?: string | null
  meta?: Prisma.InputJsonValue | null
  requestId?: string | null
  outcome?: "SUCCESS" | "REJECTED" | "FAILED"
}

// Any Prisma client or interactive-transaction client. Passing the transaction
// client makes the audit row part of the same atomic unit as the change it
// describes, which is what stops a successful write with a missing audit trail.
type Db = PrismaClient | Prisma.TransactionClient

function toData(input: RecruitmentAuditInput): Prisma.RecruitmentAuditEventUncheckedCreateInput {
  return {
    eventType: input.eventType,
    cycleId: input.cycleId ?? null,
    candidateId: input.candidateId ?? null,
    sessionId: input.sessionId ?? null,
    evaluationId: input.evaluationId ?? null,
    groupId: input.groupId ?? null,
    actorId: input.actor.id ?? null,
    actorEmail: input.actor.email,
    actorRole: input.actor.role ?? null,
    previousState: input.previousState ?? undefined,
    newState: input.newState ?? undefined,
    reason: input.reason ?? null,
    meta: input.meta ?? undefined,
    requestId: input.requestId ?? newRequestId(),
    outcome: input.outcome ?? "SUCCESS",
  }
}

// Inside a transaction: the audit row must succeed or the whole change rolls back.
// Use this for everything that mutates recruitment state.
export async function auditRecruitmentTx(db: Db, input: RecruitmentAuditInput): Promise<void> {
  await db.recruitmentAuditEvent.create({ data: toData(input) })
}

// Many rows, one round trip.
//
// Finishing a session writes an audit row per candidate, and each one used to be
// its own trip inside a transaction with a five-second ceiling. On a database in
// the same process that is free; on a remote one it is a linear cost that grows
// with the size of the panel.
export async function auditRecruitmentManyTx(
  db: Db,
  inputs: readonly RecruitmentAuditInput[],
): Promise<void> {
  if (inputs.length === 0) return
  await db.recruitmentAuditEvent.createMany({ data: inputs.map(toData) })
}

// Outside a transaction: best-effort, mirroring the contract of src/lib/audit.ts.
// Use this for refusals and read-side events, where failing the user's request
// because the audit insert failed would be the worse outcome.
export async function auditRecruitment(input: RecruitmentAuditInput): Promise<void> {
  try {
    await prisma.recruitmentAuditEvent.create({ data: toData(input) })
  } catch (err) {
    console.error("[recruitment-audit]", input.eventType, err)
  }
}

// Correlation id, so a retry storm or a partially-failed multi-step action can be
// reconstructed from the trail.
export function newRequestId(): string {
  return randomUUID()
}
