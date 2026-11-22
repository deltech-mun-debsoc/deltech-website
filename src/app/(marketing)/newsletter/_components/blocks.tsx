import Image from "next/image";
import { Globe, Handshake, Leaf, ShieldCheck } from "lucide-react";
import type { Block } from "@/content/newsletter/issue-01";
import { cn } from "@/lib/utils";
import { Rich } from "./rich";

const ICONS = { shield: ShieldCheck, handshake: Handshake, leaf: Leaf, globe: Globe };
const BAR_TONE = { ink: "bg-[var(--nl-ink)]", red: "bg-[var(--nl-red)]", rose: "bg-[var(--nl-rose)]" };

export function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((block, i) => (
        <BlockView key={i} block={block} />
      ))}
    </>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case "facts":
      return (
        <section className="mt-8">
          <div className="flex items-center gap-4">
            <h2 className="nl-red shrink-0 text-sm font-bold uppercase tracking-[0.08em]">{block.title}</h2>
            <span className="h-px flex-1 bg-[var(--nl-ink)]/60" aria-hidden />
          </div>
          <dl className="nl-facts mt-4 grid grid-cols-2 border-b border-[var(--nl-ink)]/50 pb-5 sm:grid-cols-4">
            {block.items.map((fact) => (
              <div key={fact.value} className="flex flex-col-reverse items-center justify-end px-3 py-3 text-center">
                <dt className="nl-serif mt-2 text-[0.95rem] leading-snug sm:text-base">{fact.label}</dt>
                <dd className="nl-serif nl-red text-3xl font-bold leading-none sm:text-4xl">{fact.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      );
    case "row":
      return (
        <div className={cn("nl-cols mt-8 grid gap-7 lg:gap-6", block.widths)}>
          {block.cols.map((col, i) => (
            <div key={i} className="min-w-0 space-y-4">
              <Blocks blocks={col} />
            </div>
          ))}
        </div>
      );
    case "h":
      if (block.rule === "side")
        return (
          <h2 className="nl-serif flex items-center gap-4 text-2xl font-bold sm:text-[1.7rem]">
            {block.text}
            <span className="h-0.5 w-20 bg-[var(--nl-ink)]/60" aria-hidden />
          </h2>
        );
      return (
        <h2
          className={cn(
            "nl-serif text-2xl font-bold sm:text-[1.7rem]",
            block.rule === "under" && "border-b-2 border-[var(--nl-red)] pb-2",
          )}
        >
          {block.text}
        </h2>
      );
    case "sub":
      return <h3 className="nl-serif pt-1 text-xl font-bold">{block.text}</h3>;
    case "p":
      return (
        <p className="nl-body text-[1.0625rem] leading-relaxed lg:text-justify">
          <Rich text={block.text} />
        </p>
      );
    case "label":
      return <h3 className="nl-serif nl-red pt-2 text-base font-bold uppercase tracking-wide">{block.text}</h3>;
    case "timeline":
      return (
        <ol className="relative ml-1.5 space-y-5 border-l-2 border-[var(--nl-red)] pl-5">
          {block.items.map((item) => (
            <li key={item.when} className="relative">
              <span className="absolute -left-[1.68rem] top-1.5 size-2.5 rounded-full bg-[var(--nl-red)]" aria-hidden />
              <p className="nl-body text-[1.0625rem] leading-relaxed">
                <strong className={cn("nl-serif nl-red uppercase", block.stacked && "block")}>{item.when}</strong> {item.text}
              </p>
            </li>
          ))}
        </ol>
      );
    case "devs":
      return (
        <ul className="space-y-4">
          {block.items.map((item) => {
            const Icon = ICONS[item.icon];
            return (
              <li key={item.title} className="flex gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full border-2 border-[var(--nl-ink)]/80">
                  <Icon className="size-5" aria-hidden />
                </span>
                <p className="nl-body text-[0.95rem] leading-snug">
                  <strong>{item.title}</strong> {item.text}
                </p>
              </li>
            );
          })}
        </ul>
      );
    case "numbered":
      if (block.style === "big")
        return (
          <ol className="space-y-7 pt-2">
            {block.items.map((item) => (
              <li key={item.n} className="grid grid-cols-[3.25rem_1fr] gap-3">
                <span className="nl-serif nl-red text-[2rem] font-bold leading-none">{item.n}</span>
                <div className="border-l-2 border-[var(--nl-ink)]/50 pl-3">
                  <p className="nl-serif text-lg font-bold leading-snug">{item.title}</p>
                  <p className="nl-body mt-1 text-[1.0625rem] leading-relaxed">{item.text}</p>
                </div>
              </li>
            ))}
          </ol>
        );
      return (
        <ol className="divide-y divide-[var(--nl-ink)]/35">
          {block.items.map((item) => (
            <li key={item.n} className="grid grid-cols-[1.75rem_1fr] gap-2 py-3 first:pt-0">
              <span className="nl-serif nl-red text-[1.75rem] font-bold leading-none">{item.n}</span>
              <div>
                <p className="nl-serif text-lg font-bold leading-snug">{item.title}</p>
                <p className="nl-body mt-1 text-[1.0625rem] leading-relaxed">{item.text}</p>
              </div>
            </li>
          ))}
        </ol>
      );
    case "bars": {
      const max = Math.max(...block.rows.map((r) => r.value));
      return (
        <figure
          className={cn(
            block.boxed ? "border border-[var(--nl-ink)]/25 bg-white/45 p-4 shadow-sm" : "border-t border-[var(--nl-ink)]/40 pt-4",
          )}
        >
          <figcaption
            className={cn(
              block.boxed ? "text-sm font-bold uppercase tracking-[0.08em]" : "nl-serif text-lg font-bold",
            )}
          >
            {block.title}
          </figcaption>
          <dl className="mt-3 space-y-2.5">
            {block.rows.map((row) => (
              <div key={row.label} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-3">
                <dt className="nl-serif text-base">{row.label}</dt>
                <dd className="h-5">
                  <span
                    className={cn("block h-full", BAR_TONE[row.tone])}
                    style={{ width: `${(row.value / max) * 100}%` }}
                    aria-hidden
                  />
                </dd>
                <dd className="nl-serif text-base font-bold tabular-nums">{row.display}</dd>
              </div>
            ))}
          </dl>
          {block.note && <p className="nl-serif mt-3 text-sm italic leading-snug text-[var(--nl-ink)]/80">{block.note}</p>}
        </figure>
      );
    }
    case "glance":
      return (
        <section>
          <h2 className="nl-serif nl-red text-lg font-bold uppercase">{block.title}</h2>
          <dl className="mt-2 grid grid-cols-2">
            {block.items.map((item, i) => (
              <div key={item.value} className={cn("flex flex-col-reverse", i > 0 && "border-l-2 border-[var(--nl-ink)]/60 pl-4")}>
                <dt className="nl-serif mt-1 text-[0.95rem] leading-snug">{item.label}</dt>
                <dd className="nl-serif nl-red text-4xl font-bold leading-none">{item.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      );
    case "figure":
      return (
        <figure>
          <p className="nl-serif inline-block bg-[var(--nl-red)] px-3 py-1 text-sm font-bold uppercase text-white">{block.label}</p>
          <Image
            src={block.src}
            sizes="(min-width: 1024px) 700px, 100vw"
            width={block.width}
            height={block.height}
            alt={block.alt}
            className="mt-2 h-auto w-full"
          />
          <figcaption className="nl-serif mt-2 text-[0.95rem] italic leading-snug">{block.caption}</figcaption>
        </figure>
      );
    case "callout":
      return (
        <aside className="nl-callout p-4">
          <p className="nl-serif nl-red text-base font-bold uppercase tracking-wide">{block.title}</p>
          <p className="nl-body mt-1 text-[1.0625rem] leading-relaxed">{block.text}</p>
        </aside>
      );
    case "learned":
      return <Learned items={block.items} />;
  }
}

function Learned({ items }: { items: [string, string, string] }) {
  return (
    <section className="nl-band mt-10 grid gap-6 px-6 py-7 sm:px-8 lg:grid-cols-[auto_1fr_1fr_1fr] lg:gap-0">
      <h2 className="nl-serif text-[2rem] font-bold leading-tight lg:pr-8">
        What we
        <br className="hidden lg:block" /> learned
      </h2>
      {items.map((text, i) => (
        <div key={i} className="border-white/40 lg:border-l lg:px-5">
          <p className="nl-serif nl-band-num text-2xl">{String(i + 1).padStart(2, "0")}</p>
          <p className="nl-body mt-1 text-[1.0625rem] leading-snug">{text}</p>
        </div>
      ))}
    </section>
  );
}
