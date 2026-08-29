#!/usr/bin/env tsx
// Runnable check for quiz scoring:
//   npx tsx scripts/check-quiz-scoring.ts
//
// The invariant that matters most: elapsed time is an INPUT, derived by the
// caller from the server's record of when the slide went live. The request body
// used to carry `submittedAt`, and posting 0 scored full marks on every correct
// answer. check-security.ts pins that the route never reads a client clock;
// these pin that the arithmetic on top of it is right.
import assert from "node:assert"
import { readFileSync } from "node:fs"
import {
  DEFAULT_BASE_POINTS,
  MAX_STREAK,
  normalizeAnswerText,
  scoreAnswer,
  speedMultiplier,
} from "../src/lib/quiz-scoring"
import {
  DEFAULT_MCQ_CONFIG,
  DEFAULT_NUMERIC_CONFIG,
  DEFAULT_TRUE_FALSE_CONFIG,
  DEFAULT_TYPE_ANSWER_CONFIG,
  isScoredType,
  type MCQConfig,
  type NumericConfig,
  type TypeAnswerConfig,
} from "../src/lib/quiz-types"

// --- unscored slide types stay unscored --------------------------------------
{
  for (const type of ["WORDCLOUD", "SCALE", "OPEN_TEXT", "CONTENT"] as const) {
    const result = scoreAnswer({
      type,
      config: DEFAULT_MCQ_CONFIG,
      answer: { selectedIndices: [0] },
      elapsedSeconds: 0,
    })
    assert.equal(result.correct, null, `${type} is an opinion, not an answer`)
    assert.equal(result.points, 0)
    assert.equal(isScoredType(type), false)
  }

  // A quiz slide with no correct answer configured is a poll, and must not
  // silently award points to whoever happens to pick option 0.
  const unconfigured = scoreAnswer({
    type: "MCQ",
    config: { ...DEFAULT_MCQ_CONFIG, correct: [] },
    answer: { selectedIndices: [0] },
    elapsedSeconds: 0,
  })
  assert.equal(unconfigured.correct, null, "an MCQ with no correct answer is not scored")
}

// --- MCQ, including the partial credit that did not exist before -------------
{
  const single: MCQConfig = { ...DEFAULT_MCQ_CONFIG, options: ["a", "b", "c"], correct: [1] }
  const right = scoreAnswer({ type: "MCQ", config: single, answer: { selectedIndices: [1] }, elapsedSeconds: null })
  assert.equal(right.correct, true)
  assert.equal(right.points, DEFAULT_BASE_POINTS, "no timer means no speed component")

  const wrong = scoreAnswer({ type: "MCQ", config: single, answer: { selectedIndices: [0] }, elapsedSeconds: null })
  assert.equal(wrong.correct, false)
  assert.equal(wrong.points, 0)

  // Multi-select: 2 of 3 right used to score exactly the same as answering
  // nothing at all.
  const multi: MCQConfig = {
    ...DEFAULT_MCQ_CONFIG,
    options: ["a", "b", "c", "d"],
    correct: [0, 1, 2],
    allowMultiple: true,
    partialCredit: true,
  }
  const partial = scoreAnswer({ type: "MCQ", config: multi, answer: { selectedIndices: [0, 1] }, elapsedSeconds: null })
  assert.equal(partial.correct, false, "partly right is not a green tick")
  assert.ok(partial.points > 0 && partial.points < DEFAULT_BASE_POINTS, "but it is worth something")

  // Selecting everything must not be a winning strategy.
  const shotgun = scoreAnswer({
    type: "MCQ",
    config: multi,
    answer: { selectedIndices: [0, 1, 2, 3] },
    elapsedSeconds: null,
  })
  assert.ok(shotgun.points < partial.points, "a wrong extra pick must cost more than it gains")

  const allRight = scoreAnswer({ type: "MCQ", config: multi, answer: { selectedIndices: [0, 1, 2] }, elapsedSeconds: null })
  assert.equal(allRight.correct, true)
  assert.equal(allRight.points, DEFAULT_BASE_POINTS)

  // Partial credit is opt-out.
  const strict: MCQConfig = { ...multi, partialCredit: false }
  assert.equal(
    scoreAnswer({ type: "MCQ", config: strict, answer: { selectedIndices: [0, 1] }, elapsedSeconds: null }).points,
    0,
    "partialCredit: false restores all-or-nothing",
  )
}

// --- true/false ---------------------------------------------------------------
{
  const config = { ...DEFAULT_TRUE_FALSE_CONFIG, correct: [0] }
  assert.equal(
    scoreAnswer({ type: "TRUE_FALSE", config, answer: { selectedIndices: [0] }, elapsedSeconds: null }).correct,
    true,
  )
  assert.equal(
    scoreAnswer({ type: "TRUE_FALSE", config, answer: { selectedIndices: [1] }, elapsedSeconds: null }).correct,
    false,
  )
  // Picking both is not a hedge that works.
  assert.equal(
    scoreAnswer({ type: "TRUE_FALSE", config, answer: { selectedIndices: [0, 1] }, elapsedSeconds: null }).correct,
    false,
  )
}

// --- typed answers -------------------------------------------------------------
{
  assert.equal(normalizeAnswerText("  Hello   World "), "hello world", "case and whitespace are noise")

  const config: TypeAnswerConfig = { ...DEFAULT_TYPE_ANSWER_CONFIG, accepted: ["Kofi Annan", "Annan"] }
  const answer = (text: string) =>
    scoreAnswer({ type: "TYPE_ANSWER", config, answer: { text }, elapsedSeconds: null })

  assert.equal(answer("Kofi Annan").correct, true)
  assert.equal(answer("  kofi   annan  ").correct, true, "spacing and case must not fail someone")
  assert.equal(answer("Annan").correct, true, "any accepted alternative counts")
  assert.equal(answer("Kofi Annan!").correct, true, "punctuation is ignored unless exact")
  assert.equal(answer("Ban Ki-moon").correct, false)
  assert.equal(answer("").correct, false, "an empty answer is not a right answer")

  // Substring must NOT pass: a question asking for a name should not accept an
  // essay that happens to contain it.
  assert.equal(answer("I think it was Kofi Annan actually").correct, false)

  const exact: TypeAnswerConfig = { ...config, exact: true }
  assert.equal(
    scoreAnswer({ type: "TYPE_ANSWER", config: exact, answer: { text: "kofi annan!" }, elapsedSeconds: null }).correct,
    false,
    "exact mode still ignores case and spacing, but not punctuation",
  )
}

// --- numeric, closest wins ------------------------------------------------------
{
  const config: NumericConfig = { ...DEFAULT_NUMERIC_CONFIG, target: 100, tolerance: 10 }
  const at = (value: number) =>
    scoreAnswer({ type: "NUMERIC", config, answer: { value }, elapsedSeconds: null })

  assert.equal(at(100).correct, true)
  assert.equal(at(100).points, DEFAULT_BASE_POINTS)

  // Inside the band earns a share, scaling to nothing at the edge.
  assert.equal(at(105).correct, false, "close is not exact")
  assert.ok(at(105).points > 0)
  assert.ok(at(102).points > at(105).points, "closer must be worth more")
  assert.equal(at(110).points, 0, "the edge of the band is worth nothing")
  assert.equal(at(200).points, 0)

  // Symmetric.
  assert.equal(at(95).points, at(105).points, "over and under by the same amount score the same")

  // Zero tolerance means exact only.
  const strict: NumericConfig = { ...config, tolerance: 0 }
  assert.equal(scoreAnswer({ type: "NUMERIC", config: strict, answer: { value: 100 }, elapsedSeconds: null }).points, DEFAULT_BASE_POINTS)
  assert.equal(scoreAnswer({ type: "NUMERIC", config: strict, answer: { value: 101 }, elapsedSeconds: null }).points, 0)

  // Junk input is wrong, not a crash.
  assert.equal(scoreAnswer({ type: "NUMERIC", config, answer: { value: NaN }, elapsedSeconds: null }).points, 0)
  assert.equal(scoreAnswer({ type: "NUMERIC", config, answer: {}, elapsedSeconds: null }).points, 0)
}

// --- the speed bonus ------------------------------------------------------------
{
  const timed = { ...DEFAULT_MCQ_CONFIG, correct: [0], timerSeconds: 20 }

  assert.equal(speedMultiplier(timed, 0), 1, "instant is full marks")
  assert.equal(speedMultiplier(timed, 20), 0.5, "the buzzer is half, the documented curve")
  assert.equal(speedMultiplier(timed, 10), 0.75)

  // A skewed or missing clock must degrade to the SLOWEST score, never a free
  // maximum. This is the direction that matters: the other way is exploitable.
  assert.equal(speedMultiplier(timed, 999), 0.5, "answering after the buzzer is clamped, not negative")
  assert.equal(speedMultiplier(timed, -5), 1, "a negative elapsed clamps to zero, worth no more than instant")
  assert.equal(speedMultiplier(timed, null), 1, "no start time means no speed component")
  assert.equal(speedMultiplier({ ...DEFAULT_MCQ_CONFIG, timerSeconds: null }, 5), 1)

  // Configurable weight: 0 turns speed off entirely.
  assert.equal(speedMultiplier({ ...timed, speedWeight: 0 }, 20), 1)
  assert.equal(speedMultiplier({ ...timed, speedWeight: 1 }, 20), 0, "full weight can zero it out")
  // Nonsense weights fall back to the default rather than producing nonsense.
  assert.equal(speedMultiplier({ ...timed, speedWeight: 5 }, 20), 0.5)
  assert.equal(speedMultiplier({ ...timed, speedWeight: -1 }, 20), 0.5)

  // Configurable base.
  const rich = scoreAnswer({
    type: "MCQ",
    config: { ...DEFAULT_MCQ_CONFIG, correct: [0], basePoints: 500 },
    answer: { selectedIndices: [0] },
    elapsedSeconds: null,
  })
  assert.equal(rich.points, 500)
}

// --- streaks --------------------------------------------------------------------
{
  const config = { ...DEFAULT_MCQ_CONFIG, correct: [0], streakBonus: 100 }
  const withStreak = (streak: number) =>
    scoreAnswer({ type: "MCQ", config, answer: { selectedIndices: [0] }, elapsedSeconds: null, streak })

  assert.equal(withStreak(0).points, DEFAULT_BASE_POINTS, "no streak, no bonus")
  assert.equal(withStreak(0).streakBonus, undefined)
  assert.equal(withStreak(2).points, DEFAULT_BASE_POINTS + 200)
  assert.equal(withStreak(2).streakBonus, 200)

  // Capped, so a runaway leader does not become unreachable.
  assert.equal(withStreak(50).streakBonus, MAX_STREAK * 100)

  // Off by default: an existing slide scores exactly as it did before.
  assert.equal(
    scoreAnswer({ type: "MCQ", config: { ...DEFAULT_MCQ_CONFIG, correct: [0] }, answer: { selectedIndices: [0] }, elapsedSeconds: null, streak: 3 }).points,
    DEFAULT_BASE_POINTS,
  )

  // A wrong answer never earns a streak bonus, even mid-run.
  assert.equal(
    scoreAnswer({ type: "MCQ", config, answer: { selectedIndices: [1] }, elapsedSeconds: null, streak: 3 }).points,
    0,
  )
}

// --- the route must not regress to trusting the client -------------------------
{
  const route = readFileSync("src/app/api/quiz/responses/route.ts", "utf8")
  assert.match(route, /currentSlideStartedAt/, "elapsed time comes from the server's record")
  assert.doesNotMatch(
    route,
    /body\.submittedAt|submittedAt\s*[,}]/,
    "the request body's clock must never be read again",
  )
  assert.match(route, /scoreAnswer\(/, "scoring goes through the shared, tested scorer")
  assert.match(route, /avatar:/, "the avatar is persisted for the final leaderboard")
}

// --- the reveal must reach every scored type ------------------------------------
//
// The presenter gated reveal on `type !== "MCQ"`, so a typed or numeric question
// could never be revealed: the projector would not show the answer and every
// phone would sit on a verdict that never arrived. The participant now WAITS for
// this event, which turns that from a cosmetic gap into a dead end.
{
  const presenter = readFileSync(
    "src/app/(admin)/admin/quiz/[id]/present/_components/presenter-app.tsx",
    "utf8",
  )
  assert.match(presenter, /isScoredType\(currentSlide\.type\)/, "reveal must cover every scored type")
  assert.doesNotMatch(presenter, /currentSlide\.type !== "MCQ"/, "the MCQ-only reveal gate must stay gone")

  const screen = readFileSync(
    "src/app/(admin)/admin/quiz/[id]/present/_components/question-screen.tsx",
    "utf8",
  )
  assert.match(screen, /isScoredType\(type\) && mode === "QUIZ"/, "the reveal button too")

  // The participant must hold the verdict until the host reveals, or a phone
  // spoils the projected answer for everyone still deciding.
  const participant = readFileSync(
    "src/app/(public)/quiz/[code]/_components/participant-app.tsx",
    "utf8",
  )
  assert.match(participant, /setRevealed\(true\)/, "REVEAL must be handled, not ignored")
  assert.match(participant, /revealed && result\.correct !== null/, "the verdict waits for it")
}

console.log("quiz scoring checks passed (5 types, partial credit, speed curve, streaks)")
