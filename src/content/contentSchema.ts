import { z } from "zod";

export const ContentSchema = z.object({
  eventMode: z.enum(["SOCIETY", "CONFERENCE", "INTRA_MUN"]).default("SOCIETY"),
  activeEventName: z.string().default(""),
  activeEventLabel: z.string().default("Next event"),
  paymentsEnabled: z.boolean().default(true),
  publicSections: z
    .object({
      activeEvent: z.boolean().default(false),
      registration: z.boolean().default(false),
      committees: z.boolean().default(false),
      matrix: z.boolean().default(false),
      dispatch: z.boolean().default(true),
      team: z.boolean().default(true),
      quiz: z.boolean().default(true),
      recruitment: z.boolean().default(false),
    })
    .default({
      activeEvent: false,
      registration: false,
      committees: false,
      matrix: false,
      dispatch: true,
      team: true,
      quiz: true,
      recruitment: false,
    }),
  registrationOpen: z.boolean().default(false),
  registrationClosedMessage: z
    .string()
    .default("Registrations are currently closed. Check back soon."),
  conferenceDates: z.string().default(""),
  venue: z.string().default(""),
  societyLocation: z.string().default("Delhi Technological University"),
  societyEmail: z.string().email().default("deltech.mun@gmail.com"),
  landingHero: z
    .object({
      title: z.string().default("DelTech MUN"),
      subtitle: z.string().default(""),
      ctaLabel: z.string().default("Register Now"),
    })
    .default({ title: "DelTech MUN", subtitle: "", ctaLabel: "Register Now" }),
  agendasBlurb: z.string().default(""),
  awards: z.array(z.string()).default([]),
  queryContacts: z
    .array(
      z.object({
        name: z.string(),
        role: z.string(),
        phone: z.string(),
      }),
    )
    .default([]),
  paymentProvider: z.enum(["upi_qr", "razorpay", "static_link"]).default("upi_qr"),
  staticPaymentLink: z.string().default(""),
  upiVpa: z.string().default(""),
  upiPayeeName: z.string().default("DelTech MUN"),
  paymentDeadline: z.string().default(""),
  paymentProofUrl: z.string().default(""),
  refundPolicy: z.string().default("Payments are non-refundable once an allotment is accepted."),
  whatsappCommunityUrl: z.string().default(""),
  secretariatEmail: z.string().default("secretariat.deltechmun@gmail.com"),
  sheetSyncUrl: z.string().default(""),
  recruitmentSheetUrl: z.string().default(""),
  sheetPullSources: z
    .array(
      z.object({
        presetName: z.string(),
        csvUrl: z.string(),
        source: z.enum(["SELF", "CROSS_DEL"]),
      }),
    )
    .default([]),
  matrixPublic: z.boolean().default(true),
  accommodationNote: z.string().default(""),
  blogIntro: z.string().default(""),
});

export type Content = z.infer<typeof ContentSchema>;

export const DEFAULTS: Content = ContentSchema.parse({});
