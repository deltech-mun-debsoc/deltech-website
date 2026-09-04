#!/usr/bin/env tsx
// Guards the two failures this replaced.
//
// 1. The sign-in page promised "expires in 10 minutes" while the Resend
//    provider was on its 24h default, because nothing tied the copy to the
//    config. Now both read MAGIC_LINK_MAX_AGE_S, and this asserts it.
// 2. All nine templates hand-rolled the same scaffold and redeclared the same
//    six style tokens, which is how the magic-link email ended up on stock
//    Auth.js styling instead. Every template must now go through EmailShell.
import assert from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";
import { render } from "@react-email/render";
import {
  MAGIC_LINK_MAX_AGE_S,
  MAGIC_LINK_MAX_AGE_MIN,
} from "../src/lib/magic-link";
import { STRINGS } from "../src/content/strings";
import { MagicLinkEmail } from "../src/emails/magic-link";
import { RegistrationReceivedEmail } from "../src/emails/registration-received";
import { CoDelegateRegisteredEmail } from "../src/emails/co-delegate-registered";
import { AllotmentEmail } from "../src/emails/allotment";
import { CoDelegateNoticeEmail } from "../src/emails/co-delegate-notice";
import { PaymentConfirmedEmail } from "../src/emails/payment-confirmed";
import { PaymentReminderEmail } from "../src/emails/payment-reminder";
import { BlogApprovedEmail } from "../src/emails/blog-approved";
import { BlogChangesRequestedEmail } from "../src/emails/blog-changes-requested";
import { BlogRejectedEmail } from "../src/emails/blog-rejected";
import { StaffInviteEmail } from "../src/emails/staff-invite";
import { RecruitmentSelectedEmail } from "../src/emails/recruitment-selected";
import { recruitmentRecipientEmails } from "../src/lib/recruitment/recipient-emails";

const EMAIL_DIR = "src/emails";
const SHELL = "_shell.tsx";

// --- the expiry the user is promised must be the one we enforce -------------

assert.ok(MAGIC_LINK_MAX_AGE_S > 0, "magic link maxAge must be set");
assert.ok(
  MAGIC_LINK_MAX_AGE_S <= 60 * 60,
  "a magic link is a bearer credential; keep the window at an hour or less",
);

const promised = STRINGS.auth.checkEmailExpiry.match(/(\d+)\s*minute/);
assert.ok(
  promised,
  `checkEmailExpiry must state a minute count, got: "${STRINGS.auth.checkEmailExpiry}"`,
);
assert.equal(
  Number(promised![1]),
  MAGIC_LINK_MAX_AGE_MIN,
  "sign-in copy promises a different expiry than the provider enforces",
);

// --- recruitment recipients ------------------------------------------------

assert.deepEqual(
  recruitmentRecipientEmails("typed@example.com", {
    Email: "typed@example.com",
    "Email Address": "captured@example.com",
  }),
  ["typed@example.com", "captured@example.com"],
  "typed and Google-captured addresses must both receive selection mail",
);
assert.deepEqual(
  recruitmentRecipientEmails("same@example.com", {
    Email: " SAME@example.com ",
    "Email Address": "same@example.com",
  }),
  ["same@example.com"],
  "the same address must never receive duplicate copies",
);
assert.deepEqual(
  recruitmentRecipientEmails("broken address", {
    Email: "also-broken",
    "Email Address": "captured@example.com",
  }),
  ["captured@example.com"],
  "a malformed typed address must not block the Google-captured address",
);

// --- every template routes through the shared shell ------------------------

const templates = readdirSync(EMAIL_DIR).filter(
  (f) => f.endsWith(".tsx") && f !== SHELL,
);

assert.ok(
  templates.length >= 10,
  `expected at least 10 templates, found ${templates.length}`,
);
assert.ok(
  templates.includes("magic-link.tsx"),
  "the magic-link template must exist",
);

const TOKENS = ["brand", "bg", "card", "muted", "gold", "serif"];

for (const file of templates) {
  const src = readFileSync(join(EMAIL_DIR, file), "utf8");

  assert.match(src, /from "\.\/_shell"/, `${file} must import from ./_shell`);
  assert.match(src, /<EmailShell/, `${file} must render <EmailShell>`);

  // The duplication that caused the drift: a local re-declaration of a token.
  for (const token of TOKENS) {
    assert.doesNotMatch(
      src,
      new RegExp(`^const ${token} = `, "m"),
      `${file} re-declares the "${token}" style token instead of importing it from _shell`,
    );
  }

  // The scaffold belongs to the shell alone.
  assert.doesNotMatch(
    src,
    /<Html>/,
    `${file} must not hand-roll <Html>; EmailShell owns it`,
  );
  assert.doesNotMatch(
    src,
    /<Body\b/,
    `${file} must not hand-roll <Body>; EmailShell owns it`,
  );
}

// --- every template actually renders ---------------------------------------
//
// The static checks above cannot catch a template that throws at render time,
// which is the real risk when nine of them move onto a shared shell.

const contacts = [
  { name: "A Sharma", role: "USG Delegate Affairs", phone: "+91 90000 00000" },
];

const cases: Array<[string, ReactElement, string[]]> = [
  [
    "magic-link",
    MagicLinkEmail({ url: "https://x.test/cb?t=1", expiryMinutes: 30 }),
    ["https://x.test/cb?t=1", "30 minutes"],
  ],
  [
    "registration-received",
    RegistrationReceivedEmail({
      fullName: "Riya",
      email: "r@x.test",
      eventName: "DelTech MUN 2026",
      paymentsEnabled: true,
      statusUrl: "https://x.test/status/t",
    }),
    ["Riya", "DelTech MUN 2026"],
  ],
  [
    "registration-received (free)",
    RegistrationReceivedEmail({
      fullName: "Riya",
      email: "r@x.test",
      eventName: "Intra MUN",
      paymentsEnabled: false,
    }),
    ["free Intra MUN"],
  ],
  [
    "co-delegate-registered",
    CoDelegateRegisteredEmail({
      coDelegateName: "Sam",
      primaryDelegateName: "Riya",
      primaryDelegateEmail: "r@x.test",
      eventName: "DelTech MUN",
      committeeName: "UNSC",
      paymentsEnabled: true,
    }),
    ["Sam", "UNSC"],
  ],
  [
    "allotment (paid)",
    AllotmentEmail({
      eventName: "DelTech MUN",
      fullName: "Riya",
      committeeName: "UNSC",
      portfolioName: "France",
      agenda: "Sahel",
      amountInr: 1200,
      payLink: "https://x.test/pay/t",
      paymentsEnabled: true,
      needsAccommodation: true,
      accommodationNote: "Hostel D",
      conferenceDates: "12-13 Sep",
      venue: "DTU",
      paymentDeadline: "5 Sep",
      paymentProofUrl: "https://x.test/proof",
      refundPolicy: "No refunds.",
      contactEmail: "c@x.test",
      contacts,
    }),
    ["France", "UNSC", "1,200", "Hostel D"],
  ],
  [
    "allotment (free)",
    AllotmentEmail({
      eventName: "Intra MUN",
      fullName: "Riya",
      committeeName: "UNSC",
      portfolioName: "France",
      agenda: null,
      paymentsEnabled: false,
      needsAccommodation: false,
      accommodationNote: "",
      conferenceDates: "",
      venue: "",
      paymentDeadline: "",
      paymentProofUrl: "",
      refundPolicy: "",
      contactEmail: "c@x.test",
      contacts,
    }),
    ["Nothing to pay"],
  ],
  [
    "co-delegate-notice",
    CoDelegateNoticeEmail({
      coDelegateName: "Sam",
      primaryDelegateName: "Riya",
      committeeName: "UNSC",
      portfolioName: "France",
      paymentsEnabled: true,
    }),
    ["Sam", "France"],
  ],
  [
    "payment-confirmed",
    PaymentConfirmedEmail({
      eventName: "DelTech MUN",
      fullName: "Riya",
      committeeName: "UNSC",
      portfolioName: "France",
      amountInr: 1200,
      confirmedAt: new Date("2026-09-01T00:00:00Z"),
      whatsappCommunityUrl: "https://chat.test/x",
      contactEmail: "c@x.test",
      contacts,
    }),
    ["1,200", "France"],
  ],
  [
    "payment-reminder",
    PaymentReminderEmail({
      fullName: "Riya",
      committeeName: "UNSC",
      portfolioName: "France",
      amountInr: 1200,
      payLink: "https://x.test/pay/t",
    }),
    ["1,200", "https://x.test/pay/t"],
  ],
  [
    "blog-approved",
    BlogApprovedEmail({
      authorName: "Riya",
      postTitle: "On the Sahel",
      postUrl: "https://x.test/blog/p",
    }),
    ["On the Sahel"],
  ],
  [
    "blog-changes-requested",
    BlogChangesRequestedEmail({
      authorName: "Riya",
      postTitle: "On the Sahel",
      reviewNote: "Tighten the intro.",
      editUrl: "https://x.test/write/p",
    }),
    ["Tighten the intro."],
  ],
  [
    "blog-rejected",
    BlogRejectedEmail({
      authorName: "Riya",
      postTitle: "On the Sahel",
      reviewNote: "Not a fit for this edition.",
    }),
    ["On the Sahel", "Not a fit for this edition."],
  ],
  [
    "staff-invite",
    StaffInviteEmail({
      role: "MAINTAINER",
      signInUrl: "https://x.test/signin/staff",
    }),
    ["a maintainer", "https://x.test/signin/staff"],
  ],
  [
    "recruitment-selected",
    RecruitmentSelectedEmail({
      fullName: "Riya",
      cycleName: "DelTech Recruitment 2026",
      societyRole: "MEMBER",
      whatsappUrl: "https://chat.test/group",
      note: "First meeting is Saturday.",
      contactEmail: "deltech.mun@gmail.com",
      contacts: [],
    }),
    ["Congratulations", "https://chat.test/group", "deltech.mun@gmail.com"],
  ],
];

async function main() {
  for (const [name, element, expected] of cases) {
    const html = await render(element);
    assert.ok(
      html.length > 500,
      `${name} rendered suspiciously little HTML (${html.length} chars)`,
    );
    // The shell's footer proves the wrapper ran, not just the body.
    assert.match(
      html,
      /Delhi Technological University/,
      `${name} is missing the shell footer`,
    );
    // React splits adjacent text nodes with <!-- -->, so "in {n} minutes"
    // renders as "in 30<!-- --> minutes". Strip those before matching copy.
    const text = html.replace(/<!--.*?-->/g, "");
    for (const needle of expected) {
      assert.ok(
        text.includes(needle),
        `${name} render is missing ${JSON.stringify(needle)}`,
      );
    }
  }

  console.log(
    `✅ check-emails passed (${templates.length} templates on the shared shell, ${cases.length} render cases)`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
