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

if (typeof window !== "undefined") window.auditContrast = auditContrast
