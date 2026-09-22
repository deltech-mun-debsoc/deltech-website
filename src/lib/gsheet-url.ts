// Accept only Google Sheets document URLs, then rebuild the export endpoint.
// Never preserve caller-controlled hosts, credentials, ports, or query parameters.
export function deriveCsvUrl(input: string): string | null {
  let url: URL
  try { url = new URL(input.trim()) } catch { return null }
  if (url.protocol !== "https:" || url.hostname !== "docs.google.com" || url.port || url.username || url.password) return null
  const match = url.pathname.match(/^\/spreadsheets\/d\/(e\/)?([\w-]+)(?:\/(?:edit|view|preview|export|pub|pubhtml))?\/?$/)
  if (!match) return null
  const gid = url.searchParams.get("gid") ?? new URLSearchParams(url.hash.slice(1)).get("gid")
  if (gid !== null && !/^\d+$/.test(gid)) return null
  if (match[1]) {
    return `https://docs.google.com/spreadsheets/d/e/${match[2]}/pub?output=csv${gid !== null ? `&gid=${gid}` : ""}`
  }
  return `https://docs.google.com/spreadsheets/d/${match[2]}/export?format=csv&gid=${gid ?? "0"}`
}
