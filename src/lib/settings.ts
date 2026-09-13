import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { ContentSchema, DEFAULTS, type Content } from "@/content/contentSchema";
import { STRINGS, type Strings, type StringKey } from "@/content/strings";
import { deserializeSettingValue } from "@/lib/setting-value";
import { getActiveEvent } from "@/lib/event";

// ---- Content (conference/marketing copy) ----

const KNOWN_MODES = new Set(["SOCIETY", "CONFERENCE", "INTRA_MUN"]);

export const getContent = cache(async (): Promise<Content> => {
  const rows = await prisma.setting.findMany();
  const fromDb: Record<string, unknown> = {};
  for (const { key, value } of rows) {
    // The driver can return either decoded JSON or serialized JSON. Plain JSON
    // string scalars such as CONFERENCE are already decoded and must not be
    // discarded merely because JSON.parse cannot parse them without quotes.
    const decoded = deserializeSettingValue(value);
    if (decoded !== undefined) fromDb[key] = decoded;
  }
  // The active event owns its own identity and capabilities. Those used to be
  // Setting rows, and they are overlaid here rather than read separately so that
  // every existing caller of getContent() keeps working unchanged while the Event
  // row is the single source of truth. A Setting row left over from before the
  // event table existed must never win, so the overlay is applied last.
  const event = await getActiveEvent();
  const fromEvent: Record<string, unknown> = event
    ? {
        activeEventName: event.name,
        registrationOpen: event.registrationOpen,
        paymentsEnabled: event.paymentsEnabled,
        matrixPublic: event.matrixPublic,
        // kind is a free-text label, but ContentSchema parses eventMode as a strict
        // enum and getContent() runs on every page: one unrecognised kind would throw
        // here and take the whole site down. An unknown label is simply not a mode.
        eventMode: KNOWN_MODES.has(event.kind) ? event.kind : "CONFERENCE",
      }
    : // No active event is the society's resting state: nothing open, nothing
      // charged, no matrix on show.
      { registrationOpen: false, paymentsEnabled: false, matrixPublic: false, eventMode: "SOCIETY" };

  const merged = { ...DEFAULTS, ...fromDb, ...fromEvent };
  return ContentSchema.parse(merged);
});

export async function getSetting(key: string): Promise<unknown> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function setContent(partial: Partial<Record<string, unknown>>): Promise<void> {
  const entries = Object.entries(partial).sort(([a], [b]) => a.localeCompare(b));
  await prisma.$transaction(
    entries.map(([key, value]) =>
      prisma.setting.upsert({
        where: { key },
        update: { value: value as never },
        create: { key, value: value as never },
      }),
    ),
    { isolationLevel: "Serializable" },
  );
}

// ---- Strings (UI microcopy with DB overrides) ----

function setPath(obj: Record<string, unknown>, parts: string[], value: string): void {
  const last = parts[parts.length - 1];
  let cur = obj;
  for (const part of parts.slice(0, -1)) {
    if (typeof cur[part] !== "object" || cur[part] === null) {
      cur[part] = {};
    }
    cur = cur[part] as Record<string, unknown>;
  }
  cur[last] = value;
}

// Returns STRINGS deep-merged with DB overrides. Use in server components / admin panel.
// Client components use t() from @/content/strings (always-available static fallback).
export const getStrings = cache(async (): Promise<Strings> => {
  const overrides = await prisma.stringOverride.findMany();
  if (overrides.length === 0) return STRINGS;
  const result = JSON.parse(JSON.stringify(STRINGS)) as Record<string, unknown>;
  for (const { key, value } of overrides) {
    setPath(result, key.split("."), value);
  }
  return result as Strings;
});

export async function setStringOverride(
  key: StringKey,
  value: string,
): Promise<void> {
  await prisma.stringOverride.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

export async function deleteStringOverride(key: StringKey): Promise<void> {
  await prisma.stringOverride.delete({ where: { key } }).catch(() => {});
}
