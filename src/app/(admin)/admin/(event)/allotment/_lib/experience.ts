// Experience is free text ("Two previous conferences", "HRC 2025, Lok Sabha").
// ponytail: counts listed entries or a stated number; a real field would need a
// form change. Good enough to sort first-timers from regulars.
const NONE = /^(none|no|nil|na|n\/a|nothing|-|0|first( time| mun)?.*)$/i
const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 }
export function experienceScore(text: string | null): number {
  const t = text?.trim() ?? ""
  if (!t || NONE.test(t)) return 0
  const stated = t.match(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\b/i)?.[1]?.toLowerCase()
  const n = stated ? Number(stated) || WORD_NUM[stated] || 0 : 0
  return Math.max(n, t.split(/[,;\n]|\band\b/i).filter((x) => x.trim()).length)
}
