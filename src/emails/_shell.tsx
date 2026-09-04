import type { ReactNode, CSSProperties } from "react"
import {
  Html, Head, Body, Container, Heading, Text, Hr, Preview, Section, Button,
} from "@react-email/components"

// One place for the look of every transactional email. Before this, all nine
// templates redeclared these tokens and hand-rolled the same scaffold, which
// is how the magic-link email ended up on stock Auth.js styling instead.
export const brand = "#0f766e"
export const amber = "#b45309"
export const bg = "#f4f0e6"
export const card = "#fffdf8"
export const muted = "#71717a"
export const gold = "#8a6a2f"
export const ink = "#18181b"
export const bodyInk = "#3f3f46"
export const border = "#e6ded0"
export const serif = "Georgia, 'Times New Roman', serif"

const sans = "Inter, ui-sans-serif, sans-serif"

export function EmailShell({
  preview,
  eyebrow = "DelTech MUN",
  accent = gold,
  heading,
  children,
  footer = "DelTech MUN · Delhi Technological University · Rohini, Delhi",
}: {
  preview: string
  eyebrow?: string
  accent?: string
  heading: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ fontFamily: sans, backgroundColor: bg, margin: 0 }}>
        <Container style={{ maxWidth: 560, margin: "40px auto", padding: "0 16px" }}>
          <Section
            style={{
              backgroundColor: card,
              borderRadius: 12,
              padding: "40px 40px 32px",
              border: `1px solid ${border}`,
            }}
          >
            <Text
              style={{
                color: accent,
                fontWeight: 700,
                fontSize: 12,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                margin: "0 0 16px",
              }}
            >
              {eyebrow}
            </Text>
            <Heading
              style={{ color: ink, fontFamily: serif, fontSize: 26, fontWeight: 700, margin: "0 0 20px" }}
            >
              {heading}
            </Heading>
            {children}
          </Section>

          <Hr style={{ borderColor: "transparent", margin: "12px 0 0" }} />
          <Text style={{ color: muted, fontSize: 11, textAlign: "center", margin: 0 }}>
            {footer}
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

// Body paragraph. `last` drops the bottom margin.
export function P({
  children,
  last,
  style,
}: {
  children: ReactNode
  last?: boolean
  style?: CSSProperties
}) {
  return (
    <Text
      style={{
        color: bodyInk,
        fontSize: 15,
        lineHeight: "1.6",
        margin: last ? 0 : "0 0 12px",
        ...style,
      }}
    >
      {children}
    </Text>
  )
}

// Emphasis inside a paragraph. Inline styling because email clients cannot be
// trusted to inherit a <strong> colour.
export function B({ children }: { children: ReactNode }) {
  return <strong style={{ color: ink }}>{children}</strong>
}

export function A({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} style={{ color: brand }}>
      {children}
    </a>
  )
}

const CALLOUT = {
  brand: { backgroundColor: "#f0fdf9", border: "1px solid #99f6e4", color: brand },
  amber: { backgroundColor: "#fffbeb", border: "1px solid #fcd34d", color: amber },
} as const

export function Callout({
  tone = "brand",
  children,
}: {
  tone?: keyof typeof CALLOUT
  children: ReactNode
}) {
  const c = CALLOUT[tone]
  return (
    <Section
      style={{
        backgroundColor: c.backgroundColor,
        border: c.border,
        borderRadius: 8,
        padding: "14px 18px",
        margin: "0 0 16px",
      }}
    >
      <Text style={{ color: c.color, fontSize: 14, fontWeight: 700, lineHeight: "1.5", margin: 0 }}>
        {children}
      </Text>
    </Section>
  )
}

export function Cta({
  href,
  tone = "brand",
  children,
}: {
  href: string
  tone?: "brand" | "amber"
  children: ReactNode
}) {
  return (
    <Button
      href={href}
      style={{
        backgroundColor: tone === "amber" ? amber : brand,
        color: "#ffffff",
        fontSize: 15,
        fontWeight: 600,
        borderRadius: 8,
        padding: "12px 28px",
        textDecoration: "none",
        display: "block",
        textAlign: "center",
        margin: "0 0 20px",
      }}
    >
      {children}
    </Button>
  )
}

// Small print under a CTA.
export function Fine({ children }: { children: ReactNode }) {
  return (
    <Text style={{ color: muted, fontSize: 12, textAlign: "center", margin: 0 }}>{children}</Text>
  )
}

// A boxed group of label/value details, used by the allotment and payment
// templates. `tone` matches Callout so a confirmation can stay on brand.
export function Panel({
  title,
  tone = "grey",
  children,
}: {
  title?: string
  tone?: "grey" | "brand"
  children: ReactNode
}) {
  const style =
    tone === "brand"
      ? { backgroundColor: "#f0fdf9", border: "1px solid #99f6e4" }
      : { backgroundColor: "#f4f4f5", border: "1px solid #e4e4e7" }
  return (
    <Section style={{ ...style, borderRadius: 8, padding: "16px 20px", margin: "0 0 24px" }}>
      {title && (
        <Text
          style={{
            color: muted,
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            margin: "0 0 12px",
          }}
        >
          {title}
        </Text>
      )}
      {children}
    </Section>
  )
}

// Contact block shared by the allotment and payment-confirmed emails.
export function Contacts({
  contactEmail,
  contacts,
}: {
  contactEmail: string
  contacts: Array<{ name: string; role: string; phone: string }>
}) {
  return (
    <>
      <Hr style={{ borderColor: "#e4e4e7", margin: "28px 0 20px" }} />
      <Text style={{ color: bodyInk, fontSize: 13, lineHeight: "1.6", margin: "0 0 12px" }}>
        Questions? Write to <B>{contactEmail}</B>.
      </Text>
      {contacts.map((c) => (
        <Text
          key={c.name + c.phone}
          style={{ color: ink, fontSize: 13, lineHeight: "1.5", margin: "4px 0" }}
        >
          <B>{c.name}</B> · {c.role}
          {c.phone ? ` · ${c.phone}` : ""}
        </Text>
      ))}
    </>
  )
}

// One label/value pair inside a Panel.
export function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <>
      <Text style={{ color: muted, fontSize: 11, margin: "0 0 2px" }}>{label}</Text>
      <Text style={{ color: ink, fontSize: 15, fontWeight: 600, margin: "0 0 10px" }}>{value}</Text>
    </>
  )
}
