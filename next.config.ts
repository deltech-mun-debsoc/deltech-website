import type { NextConfig } from "next";

// There were no security headers at all. These four are unconditional: none of
// them can break a page that was not already doing something it should not.
//
// frame-ancestors matters most here. The admin console was framable by any
// origin, which is a clickjacking route to destructive one-click actions
// (revoke, cancel, delete) performed by an authenticated staff member.
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
];

// Content-Security-Policy, REPORT ONLY on purpose.
//
// A blocking CSP shipped blind is exactly the change that breaks production
// silently, and this app has several things a strict policy would cut: Tiptap
// and recharts inject styles at runtime, Next itself needs an inline bootstrap
// script, and blog images come from the Supabase storage origin.
//
// So: observe first. Watch the browser console on /admin, /blog/[slug] and
// /quiz/[code], tighten whatever reports, and only then rename the header to
// Content-Security-Policy. Until that has been done this is documentation
// with telemetry attached, not a control. Do not mistake it for one.
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  // 'unsafe-inline'/'unsafe-eval' are what a nonce-based policy would remove.
  // Getting there needs the proxy to stamp a nonce on every response.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  // amazonaws.com: browser uploads PUT straight to S3 on a presigned URL.
  // Realtime is same-origin now (SSE via /api/realtime), so 'self' covers it.
  "connect-src 'self' https://*.amazonaws.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  // A self-contained server for the Docker image (see Dockerfile). Vercel
  // ignores this and builds as it always has.
  output: "standalone",
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "xlsx"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          ...SECURITY_HEADERS,
          { key: "Content-Security-Policy-Report-Only", value: CSP_REPORT_ONLY },
        ],
      },
    ];
  },
};

export default nextConfig;
