// Paste into the browser console on any page, in EACH theme, to find text that
// cannot be read. Returns a list of WCAG AA failures, worst first.
//
//   npx tsx  -- no. This is a browser snippet, not a node script:
//   1. open the page, 2. devtools console, 3. paste this file, 4. auditContrast()
//
// Why a console snippet rather than a CI check: measuring real contrast needs
// real layout and real computed styles, which means a browser. Adding a headless
// browser to `npm run check` would slow every PR and introduce a flaky gate for
// something that is a design judgement, not a build error. This is a tool you
// run when you change a colour, not a wall you have to climb past.
//
// auditContrast()      resting state
// auditHover()         :hover state -- a different set of bugs entirely, since a
//                      hover rule can pair a new colour with a new background and
//                      neither author ever sees the combination.
//
// It found four real bugs on the marketing homepage, all one defect: a FIXED
// colour (gold-300, gold-700, paper) paired with a surface that CHANGES with the
// theme (bg-primary inverts light<->dark; the page background does too). Each
// looked fine in the theme it was written in.
//
// Two things it deliberately skips, because it cannot measure them and guessing
// produces noise instead of findings:
//   - text over an <img> or a background-image: there is no CSS colour behind it
//   - anything with a background-image anywhere in its ancestor chain
// An earlier version reported both as failures. They were artefacts of the
// measurement, not defects in the page.
function auditContrast({ minRatio = null, verbose = false } = {}) {
  const cv = document.createElement("canvas").getContext("2d", { willReadFrequently: true })

  // Paint the colour and read the pixel back. getComputedStyle returns lab() and
  // oklab() in modern browsers, which no naive rgb() parser handles; the canvas
  // is the only thing guaranteed to normalise every CSS Color 4 format.
  const rgba = (css) => {
    cv.clearRect(0, 0, 1, 1)
    cv.fillStyle = "#000"
    cv.fillStyle = css
    cv.fillRect(0, 0, 1, 1)
    const d = cv.getImageData(0, 0, 1, 1).data
    return [d[0], d[1], d[2], d[3] / 255]
  }

  const luminance = ([r, g, b]) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  const over = (fg, bg) =>
    fg[3] >= 1 ? fg : [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat([1])
  const contrast = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05)
  }

  // Composite the WHOLE ancestor stack, bottom-up. Stopping at the first
  // "mostly opaque" layer compares against the wrong surface: a header at
  // alpha 0.9 over a dark body was scored as if it were the body.
  const backdrop = (el) => {
    const layers = []
    let n = el
    let overImage = false
    let owner = null
    while (n && n !== document.documentElement) {
      const cs = getComputedStyle(n)
      if (cs.backgroundImage && cs.backgroundImage !== "none") overImage = true
      const c = rgba(cs.backgroundColor)
      if (c[3] > 0) { layers.push(c); if (!owner) owner = n }
      if (c[3] >= 1) { owner = n; break }
      n = n.parentElement
    }
    const html = rgba(getComputedStyle(document.documentElement).backgroundColor)
    let bg = html[3] >= 1 ? html : [255, 255, 255, 1]
    for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg)
    return { bg, overImage, owner }
  }

  const results = []
  for (const el of document.querySelectorAll("a,button,p,h1,h2,h3,h4,span,li,dt,dd,label")) {
    const text = (el.innerText || "").trim()
    if (!text || text.length > 60) continue
    // Leaf nodes only, or a container is scored using its child's text.
    if (el.querySelector("a,button,p,h1,h2,h3,h4,span,li,dt,dd,label")) continue
    const box = el.getBoundingClientRect()
    if (box.width < 4 || box.height < 4) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === "hidden" || cs.opacity === "0") continue
    if (el.closest("figure")?.querySelector("img")) continue

    const { bg, overImage, owner } = backdrop(el)
    if (overImage) continue

    const fg = over(rgba(cs.color), bg)
    const ratio = contrast(fg, bg)
    const px = parseFloat(cs.fontSize)
    const isLarge = px >= 24 || (px >= 18.66 && parseInt(cs.fontWeight) >= 700)
    const required = minRatio ?? (isLarge ? 3 : 4.5)
    if (ratio >= required) continue

    results.push({
      ratio: +ratio.toFixed(2),
      required,
      text: text.slice(0, 40),
      px: Math.round(px),
      fg: fg.slice(0, 3).map(Math.round).join(","),
      bg: bg.slice(0, 3).map(Math.round).join(","),
      on: owner ? `${owner.tagName}.${String(owner.className || "").split(" ").filter((c) => c.startsWith("bg-")).join(".")}` : "?",
      el: verbose ? el : undefined,
    })
  }

  const unique = [...new Map(results.map((r) => [r.text + r.ratio, r])).values()]
  unique.sort((a, b) => a.ratio - b.ratio)
  console.table(unique.map(({ el, ...r }) => r))
  return unique
}

// ---------------------------------------------------------------------------
// :hover
//
// Resting-state auditing misses hover entirely, and hover is where a fixed
// colour and a fixed background get paired by two different utilities that were
// never looked at together.
//
// There is no way to force :hover from page script, so this reads the CSSOM:
// collect every rule whose selector mentions :hover, strip the pseudo-class, and
// test whether the element matches what remains. Tailwind emits
// `.hover\:bg-paper:hover`, so stripping leaves `.hover\:bg-paper`, which the
// element carries as a class.
//
// Two limits worth knowing:
//   - Later rule wins, which approximates source order. Utilities are nearly all
//     the same specificity so this holds in practice, but a hand-written rule
//     with higher specificity could win in the browser and lose here.
//   - It reads declared values, so it cannot see anything a JS handler changes.
function hoverRules() {
  const out = []
  for (const sheet of document.styleSheets) {
    let rules
    try { rules = sheet.cssRules } catch { continue }   // cross-origin
    const walk = (list) => {
      for (const r of list) {
        // CSSStyleRule.cssRules exists but is EMPTY in modern browsers, so a
        // truthiness check here skips every style rule. Check length.
        if (r.style && r.selectorText && r.selectorText.includes(":hover")) out.push(r)
        if (r.cssRules && r.cssRules.length) walk(r.cssRules)
      }
    }
    walk(rules)
  }
  return out
}

function auditHover() {
  const rules = hoverRules()
  const cv = document.createElement("canvas").getContext("2d", { willReadFrequently: true })
  const rgba = (css) => {
    cv.clearRect(0, 0, 1, 1); cv.fillStyle = "#000"; cv.fillStyle = css; cv.fillRect(0, 0, 1, 1)
    const d = cv.getImageData(0, 0, 1, 1).data
    return [d[0], d[1], d[2], d[3] / 255]
  }
  const luminance = ([r, g, b]) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  const over = (f, b) => (f[3] >= 1 ? f : [0, 1, 2].map((i) => f[i] * f[3] + b[i] * (1 - f[3])).concat([1]))
  const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05) }
  const resolveVars = (val, el) =>
    val ? val.replace(/var\((--[\w-]+)\)/g, (_, n) => getComputedStyle(el).getPropertyValue(n).trim() || "transparent") : null

  const hoverStyle = (el) => {
    let color = null, bg = null
    const via = []
    for (const r of rules) {
      for (const sel of r.selectorText.split(",")) {
        const base = sel.trim().replace(/:hover/g, "")
        let ok = false
        try { ok = el.matches(base) } catch { continue }
        if (!ok) continue
        if (r.style.color) { color = r.style.color; via.push(sel.trim()) }
        if (r.style.backgroundColor) { bg = r.style.backgroundColor; via.push(sel.trim()) }
      }
    }
    return { color, bg, via: [...new Set(via)] }
  }

  const backdrop = (el) => {
    const layers = []
    let n = el, image = false
    while (n && n !== document.documentElement) {
      const cs = getComputedStyle(n)
      if (cs.backgroundImage && cs.backgroundImage !== "none") image = true
      const c = rgba(cs.backgroundColor)
      if (c[3] > 0) layers.push(c)
      if (c[3] >= 1) break
      n = n.parentElement
    }
    const html = rgba(getComputedStyle(document.documentElement).backgroundColor)
    let bg = html[3] >= 1 ? html : [255, 255, 255, 1]
    for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg)
    return { bg, image }
  }

  const results = []
  for (const el of document.querySelectorAll('a,button,[role="button"],[role="tab"],summary')) {
    const text = (el.innerText || "").trim()
    if (!text || text.length > 50) continue
    const box = el.getBoundingClientRect()
    if (box.width < 4 || box.height < 4) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === "hidden" || cs.opacity === "0") continue
    const h = hoverStyle(el)
    if (!h.color && !h.bg) continue        // hover changes no colour: nothing to check
    const { bg: resting, image } = backdrop(el)
    if (image) continue
    const hoverBgRaw = resolveVars(h.bg, el)
    const hoverBg = hoverBgRaw ? over(rgba(hoverBgRaw), resting) : resting
    const fg = over(rgba(resolveVars(h.color, el) || cs.color), hoverBg)
    const ratio = contrast(fg, hoverBg)
    const px = parseFloat(cs.fontSize)
    const required = px >= 24 || (px >= 18.66 && parseInt(cs.fontWeight) >= 700) ? 3 : 4.5
    if (ratio >= required) continue
    results.push({
      ratio: +ratio.toFixed(2), required, text: text.slice(0, 40),
      fg: fg.slice(0, 3).map(Math.round).join(","), bg: hoverBg.slice(0, 3).map(Math.round).join(","),
      via: h.via.join(" + "),
    })
  }
  const unique = [...new Map(results.map((r) => [r.text + r.ratio, r])).values()].sort((a, b) => a.ratio - b.ratio)
  console.table(unique)
  return unique
}

if (typeof window !== "undefined") {
  window.auditContrast = auditContrast
  window.auditHover = auditHover
}
