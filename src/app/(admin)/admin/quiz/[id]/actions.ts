"use server"

import { updateTag } from "next/cache"
import { prisma } from "@/lib/prisma"
import { requireStaff } from "@/lib/authz"
import type { Prisma } from "@/generated/prisma/client"
import { DEFAULT_CONFIGS, parseConfig } from "@/lib/quiz-types"
import type { SlideType, SlideData, PresentationTheme } from "@/lib/quiz-types"
import { quizSlideCacheTag } from "@/lib/quiz-cache"

export async function updatePresentationMeta(
  id: string,
  data: { title?: string; mode?: string; theme?: PresentationTheme },
): Promise<{ error?: string }> {
  await requireStaff()
  try {
    await prisma.presentation.update({
      where: { id },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.mode !== undefined && { mode: data.mode as "POLL" | "QUIZ" }),
        ...(data.theme !== undefined && { theme: data.theme as unknown as Prisma.InputJsonValue }),
      },
    })
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed." }
  }
}

export async function addSlide(
  presentationId: string,
  type: SlideType,
): Promise<{ slide?: SlideData; error?: string }> {
  await requireStaff()
  try {
    const count = await prisma.slide.count({ where: { presentationId } })
    const config = DEFAULT_CONFIGS[type]
    const raw = await prisma.slide.create({
      data: {
        presentationId,
        type,
        order: count,
        prompt: "",
        config: config as unknown as Prisma.InputJsonValue,
      },
    })
    return {
      slide: {
        id: raw.id,
        order: raw.order,
        type: raw.type as SlideType,
        prompt: raw.prompt,
        config: parseConfig(raw.config, type),
      },
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed." }
  }
}

export async function updateSlide(
  slideId: string,
  data: { prompt?: string; config?: unknown },
): Promise<{ error?: string }> {
  await requireStaff()
  try {
    await prisma.slide.update({
      where: { id: slideId },
      data: {
        ...(data.prompt !== undefined && { prompt: data.prompt }),
        ...(data.config !== undefined && { config: data.config as Prisma.InputJsonValue }),
      },
    })
    updateTag(quizSlideCacheTag(slideId))
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed." }
  }
}

export async function deleteSlide(slideId: string): Promise<{ error?: string }> {
  await requireStaff()
  try {
    const deleted = await prisma.slide.delete({ where: { id: slideId } })
    updateTag(quizSlideCacheTag(slideId))
    const remaining = await prisma.slide.findMany({
      where: { presentationId: deleted.presentationId },
      orderBy: { order: "asc" },
    })
    await prisma.$transaction(
      remaining.map((s, i) => prisma.slide.update({ where: { id: s.id }, data: { order: i } })),
    )
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed." }
  }
}

export async function duplicateSlide(slideId: string): Promise<{ slide?: SlideData; error?: string }> {
  await requireStaff()
  try {
    const original = await prisma.slide.findUniqueOrThrow({ where: { id: slideId } })
    const count = await prisma.slide.count({ where: { presentationId: original.presentationId } })
    const raw = await prisma.slide.create({
      data: {
        presentationId: original.presentationId,
        type: original.type,
        order: count,
        prompt: original.prompt,
        config: original.config as Prisma.InputJsonValue,
      },
    })
    const type = raw.type as SlideType
    return {
      slide: {
        id: raw.id,
        order: raw.order,
        type,
        prompt: raw.prompt,
        config: parseConfig(raw.config, type),
      },
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed." }
  }
}

export async function reorderSlides(
  orderedIds: string[],
): Promise<{ error?: string }> {
  await requireStaff()
  try {
    await prisma.$transaction(
      orderedIds.map((id, i) => prisma.slide.update({ where: { id }, data: { order: i } })),
    )
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed." }
  }
}
