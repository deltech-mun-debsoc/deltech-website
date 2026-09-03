"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Image, { type StaticImageData } from "next/image"
import { ArrowLeft, ArrowRight } from "lucide-react"
import { t } from "@/content/strings"
import { cn } from "@/lib/utils"
import assembly from "@/photos/assembly.webp"
import hall from "@/photos/hall.webp"
import floor from "@/photos/floor.webp"
import address from "@/photos/address.webp"
import rostrum from "@/photos/rostrum.webp"
import board from "@/photos/board.webp"
import argument from "@/photos/argument.webp"
import notes from "@/photos/notes.webp"
import thinking from "@/photos/thinking.webp"
import cohort from "@/photos/cohort.webp"
import delegation from "@/photos/delegation.webp"

// The conference carousel.
//
// Built on native scroll-snap rather than a carousel library: the track is a
// scroll container, so touch swipe, trackpad, scrollbar drag and Page keys all
// work before a line of our JS runs. The script here only adds what the platform
// does not give you -- arrow buttons, an index, dots, and autoplay -- and if it
// never hydrates the section is still a scrollable strip of photographs.
//
// Every frame is pre-cropped to one 3:2 shape. A carousel whose slides change
// aspect ratio jumps as you page through it, and a jumping carousel reads as
// broken rather than as variety.

interface Slide {
  src: StaticImageData
  altKey: string
  captionKey: string
}

// Ordered as a walk through the two days: the room first, so the scale lands
// before any one face does, then in to the people, then back out to everyone.
const SLIDES: Slide[] = [
  { src: assembly, altKey: "marketing.gallery.altAssembly", captionKey: "marketing.gallery.capAssembly" },
  { src: hall, altKey: "marketing.gallery.altHall", captionKey: "marketing.gallery.capHall" },
  { src: floor, altKey: "marketing.gallery.altFloor", captionKey: "marketing.gallery.capFloor" },
  { src: address, altKey: "marketing.gallery.altAddress", captionKey: "marketing.gallery.capAddress" },
  { src: rostrum, altKey: "marketing.gallery.altRostrum", captionKey: "marketing.gallery.capRostrum" },
  { src: board, altKey: "marketing.gallery.altBoard", captionKey: "marketing.gallery.capBoard" },
  { src: argument, altKey: "marketing.gallery.altArgument", captionKey: "marketing.gallery.capArgument" },
  { src: notes, altKey: "marketing.gallery.altNotes", captionKey: "marketing.gallery.capNotes" },
  { src: thinking, altKey: "marketing.gallery.altThinking", captionKey: "marketing.gallery.capThinking" },
  { src: cohort, altKey: "marketing.gallery.altCohort", captionKey: "marketing.gallery.capCohort" },
  { src: delegation, altKey: "marketing.gallery.altDelegation", captionKey: "marketing.gallery.capDelegation" },
]

const AUTOPLAY_MS = 5200

export function ConferenceCarousel() {
  const trackRef = useRef<HTMLUListElement>(null)
  const [index, setIndex] = useState(0)
  // Autoplay is a convenience for someone who is not interacting. The moment
  // they do -- swipe, button, dot, keyboard -- it stops for good rather than
  // fighting them for control of the frame they are looking at.
  const [autoplay, setAutoplay] = useState(true)
  const [paused, setPaused] = useState(false)

  // Measured with rects, not offsetLeft. The slides are position:relative inside
  // a position:relative wrapper, so their offsetParent is that wrapper rather
  // than the scroll container -- offsetLeft is therefore not a scroll coordinate,
  // and using it here moved the track nowhere at all.
  const scrollTo = useCallback((i: number, smooth = true) => {
    const track = trackRef.current
    const slide = track?.children[i] as HTMLElement | undefined
    if (!track || !slide) return
    const delta = slide.getBoundingClientRect().left - track.getBoundingClientRect().left
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    track.scrollTo({
      left: track.scrollLeft + delta - (track.clientWidth - slide.clientWidth) / 2,
      behavior: smooth && !reduced ? "smooth" : "auto",
    })
  }, [])

  // The scroll position is the source of truth for which slide is current, not a
  // counter we increment: a swipe or a scrollbar drag moves the track without
  // going through any of our handlers.
  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    let frame = 0
    const read = () => {
      frame = 0
      const trackBox = track.getBoundingClientRect()
      const middle = trackBox.left + trackBox.width / 2
      let best = 0
      let bestGap = Infinity
      for (let i = 0; i < track.children.length; i++) {
        const box = (track.children[i] as HTMLElement).getBoundingClientRect()
        const gap = Math.abs(box.left + box.width / 2 - middle)
        if (gap < bestGap) {
          bestGap = gap
          best = i
        }
      }
      setIndex(best)
    }
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(read)
    }
    track.addEventListener("scroll", onScroll, { passive: true })
    read()
    return () => {
      track.removeEventListener("scroll", onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  useEffect(() => {
    if (!autoplay || paused) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const id = window.setInterval(() => {
      setIndex((current) => {
        const next = (current + 1) % SLIDES.length
        scrollTo(next)
        return current
      })
    }, AUTOPLAY_MS)
    return () => window.clearInterval(id)
  }, [autoplay, paused, scrollTo])

  // Pause while the section is off screen, so a carousel nobody is looking at is
  // not decoding images in the background.
  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    const observer = new IntersectionObserver(
      ([entry]) => setPaused(!entry.isIntersecting),
      { threshold: 0.25 },
    )
    observer.observe(track)
    return () => observer.disconnect()
  }, [])

  const go = (i: number) => {
    setAutoplay(false)
    scrollTo((i + SLIDES.length) % SLIDES.length)
  }

  return (
    <section
      className="border-b border-border/70 py-24 sm:py-32"
      aria-roledescription={t("marketing.gallery.roleCarousel")}
      aria-label={t("marketing.gallery.title")}
    >
      <div className="section-shell">
        <div className="grid gap-8 lg:grid-cols-[1fr_0.8fr] lg:items-end">
          <div>
            <p className="eyebrow">{t("marketing.gallery.eyebrow")}</p>
            <h2 className="display-section mt-5 max-w-[12ch]">{t("marketing.gallery.title")}</h2>
          </div>
          <p className="body-large text-muted-foreground">{t("marketing.gallery.body")}</p>
        </div>
      </div>

      {/* The track breaks out of the shell so the next frame peeks in from the
          edge: that peek is what tells a reader there is more without a caption
          saying so. */}
      <div
        className="relative mt-12"
        onPointerEnter={() => setPaused(true)}
        onPointerLeave={() => setPaused(false)}
        onFocusCapture={() => setPaused(true)}
        onBlurCapture={() => setPaused(false)}
      >
        <ul
          ref={trackRef}
          className="flex snap-x snap-mandatory gap-4 overflow-x-auto px-[max(1rem,calc(50vw-38rem))] pb-2 [-ms-overflow-style:none] [scrollbar-width:none] sm:gap-6 [&::-webkit-scrollbar]:hidden"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight") { event.preventDefault(); go(index + 1) }
            if (event.key === "ArrowLeft") { event.preventDefault(); go(index - 1) }
          }}
          onPointerDown={() => setAutoplay(false)}
        >
          {SLIDES.map((slide, i) => (
            <li
              key={slide.altKey}
              className="relative w-[86vw] shrink-0 snap-center sm:w-[68vw] lg:w-[58rem]"
              role="group"
              aria-roledescription={t("marketing.gallery.roleSlide")}
              aria-label={t("marketing.gallery.slideCount", { current: i + 1, total: SLIDES.length })}
            >
              <figure className="group relative aspect-[3/2] overflow-hidden bg-foreground/5">
                <Image
                  src={slide.src}
                  alt={t(slide.altKey as Parameters<typeof t>[0])}
                  placeholder="blur"
                  // Only the first frame is above the fold on a phone; the rest
                  // arrive as the track is scrolled.
                  priority={i === 0}
                  sizes="(min-width: 1024px) 58rem, (min-width: 640px) 68vw, 86vw"
                  className={cn(
                    "size-full object-cover transition-all duration-700 ease-out",
                    // The frame in the middle is in colour; its neighbours sit
                    // back. This is what makes the peek read as a peek.
                    i === index ? "scale-100 grayscale-0" : "scale-[1.04] grayscale",
                  )}
                />
                <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-5 pt-16 sm:p-7 sm:pt-24">
                  <span className="data-label text-[0.6875rem] text-white/70">
                    {t("marketing.gallery.slideCount", { current: i + 1, total: SLIDES.length })}
                  </span>
                  <p className="mt-1.5 font-heading text-2xl text-white sm:text-3xl">
                    {t(slide.captionKey as Parameters<typeof t>[0])}
                  </p>
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>
      </div>

      <div className="section-shell mt-8 flex flex-wrap items-center justify-between gap-6">
        {/* Dots carry the position; the arrows carry the action. Both are real
            buttons, so this works from the keyboard without the track focused. */}
        <div className="flex items-center gap-2">
          {SLIDES.map((slide, i) => (
            <button
              key={slide.altKey}
              type="button"
              onClick={() => go(i)}
              aria-label={t("marketing.gallery.goTo", { current: i + 1, total: SLIDES.length })}
              aria-current={i === index}
              className={cn(
                "h-1 rounded-full transition-all duration-300",
                i === index ? "w-8 bg-foreground" : "w-3 bg-foreground/25 hover:bg-foreground/50",
              )}
            />
          ))}
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => go(index - 1)}
            aria-label={t("marketing.gallery.previous")}
            className="inline-flex size-12 items-center justify-center rounded-full border border-foreground/25 transition-colors hover:bg-ink hover:text-paper"
          >
            <ArrowLeft className="size-5" />
          </button>
          <button
            type="button"
            onClick={() => go(index + 1)}
            aria-label={t("marketing.gallery.next")}
            className="inline-flex size-12 items-center justify-center rounded-full border border-foreground/25 transition-colors hover:bg-ink hover:text-paper"
          >
            <ArrowRight className="size-5" />
          </button>
        </div>
      </div>
    </section>
  )
}
