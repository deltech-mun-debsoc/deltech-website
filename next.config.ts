import createMDX from "@next/mdx";
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

// docs.deltechmun.in is served by the same app, from the (docs) route group.
// beforeFiles is required: it runs ahead of filesystem matching, so "/" on the
// docs host resolves to /docs instead of the marketing homepage.
//
// The lookahead is not optional. Without it this rule also captures
// /_next/static/*, rewrites it to /docs/_next/static/* and 404s every asset on
// the docs host. "docs" itself is excluded so /docs/... and /docs/*.webp stay
// reachable on both hostnames.
const DOCS_HOST = [{ type: "host" as const, value: "docs.deltechmun.in" }];
const NOT_RESERVED = "/:path((?!docs|_next|api|favicon\\.ico|icon).*)";

const nextConfig: NextConfig = {
  // A self-contained server for the AWS Docker image (see Dockerfile).
  output: "standalone",
  pageExtensions: ["ts", "tsx", "md", "mdx"],
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "xlsx"],
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/", has: DOCS_HOST, destination: "/docs" },
        { source: NOT_RESERVED, has: DOCS_HOST, destination: "/docs/:path" },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
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

// Turbopack is the Next 16 default and cannot receive plugin *functions* --
// they are JavaScript and the compiler is Rust. Plugins must be named as
// serializable strings. Do not import remark-gfm / rehype-slug here.
const withMDX = createMDX({
  options: {
    remarkPlugins: [["remark-gfm", {}]],
    rehypePlugins: [["rehype-slug", {}]],
  },
});

export default withMDX(nextConfig);
