import { prisma } from "@/lib/prisma"

function generateRoomCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

function isRetryable(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code
  // P2002: the generated roomCode collided with an existing one.
  // P2034: two callers raced and Postgres aborted this transaction.
  return code === "P2002" || code === "P2034"
}

// A *run* is the unit of results: one room code, one set of responses, one
// leaderboard. Opening the presenter view starts a new run rather than resuming
// whatever session happened to still be marked live, because resuming one meant
// the previous audience's scores were still on the board, and anyone who had
// already answered a slide was refused with `already_submitted` when it came
// round again.
//
// Two cases must still resume, so the rule is not simply "always create":
//
//   - Two staff opening the presenter view at once have to land in ONE room. An
//     untouched session is exactly that case, so it is shared. (This is the
//     race the Serializable transaction below was added for.)
//   - A presenter whose page reloads mid-run must not lose the run. That one is
//     explicit: the presenter URL carries ?session=, so a reload resumes by id
//     through `resumeQuizSession`, and never lands here.
//
// The old run is ended rather than left live, so its room code stops admitting
// anyone and the audience cannot end up split across two codes. Its responses
// stay attached to it, which is what makes the previous results still readable.
export async function createOrGetQuizSession(presentationId: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const live = await tx.quizSession.findFirst({
            where: { presentationId, status: { in: ["lobby", "active"] } },
          })

          if (live) {
            const used = await tx.response.findFirst({
              where: { sessionId: live.id },
              select: { id: true },
            })
            if (!used) return live

            await tx.quizSession.updateMany({
              where: { presentationId, status: { in: ["lobby", "active"] } },
              data: { status: "ended", endedAt: new Date() },
            })
          }

          return tx.quizSession.create({
            data: { presentationId, roomCode: generateRoomCode(), status: "lobby" },
          })
        },
        { isolationLevel: "Serializable" },
      )
    } catch (err) {
      if (attempt >= 4 || !isRetryable(err)) throw err
    }
  }
}

// Resumes one specific run, for a presenter whose page reloaded. Null if the id
// is not this presentation's or the run has already ended, in which case the
// caller starts a fresh one.
export async function resumeQuizSession(presentationId: string, sessionId: string) {
  return prisma.quizSession.findFirst({
    where: { id: sessionId, presentationId, status: { in: ["lobby", "active"] } },
    select: { id: true, roomCode: true },
  })
}
