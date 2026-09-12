import { z } from "zod"

/** Canonical institution name written when a delegate self-identifies as DTU. */
export const DTU_INSTITUTION = "Delhi Technological University"

export const coDelegateSchema = z.object({
  fullName: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  phone: z.string().min(7, "Enter a valid phone number"),
  institution: z.string().optional(),
  munExperience: z.string().optional(),
})

export const registerSchema = z.object({
  // Step 1 – personal
  fullName: z.string().min(2, "Name must be at least 2 characters"),
  // Trimmed and lowercased at the boundary. The duplicate check and the unique
  // index both compare exact strings, so "Foo@Gmail.com" and "foo@gmail.com"
  // registered as two different delegates. Every other intake path (the Google
  // Form importer, the cross-delegation import) already lowercases via
  // normalizeEmail; this was the one that didn't.
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  whatsapp: z.string().min(7, "Enter a valid WhatsApp number"),
  altPhone: z.string().optional(),
  institution: z.string().min(2, "Institution is required"),
  isDtu: z.boolean(),
  munExperience: z.string().optional(),
  // Step 2 – first preference
  pref1CommitteeId: z.string().min(1, "Select a committee"),
  pref1Portfolio: z.string().min(1, "Enter a portfolio preference"),
  // Step 3 – second preference or co-delegate (conditional; server action enforces business rules)
  pref2CommitteeId: z.string().optional(),
  pref2Portfolio: z.string().optional(),
  coDelegate: coDelegateSchema.optional(),
  // Step 4 – accommodation
  needsAccommodation: z.boolean(),
  outsideNcr: z.boolean(),
  // Step 5 – undertaking
  undertaking: z
    .boolean()
    .refine((v) => v === true, { message: "You must accept the undertaking to proceed." }),
  reference: z.string().optional(),
})

export type RegisterFormValues = z.infer<typeof registerSchema>
export type CoDelegateFormValues = z.infer<typeof coDelegateSchema>
