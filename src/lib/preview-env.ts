// Is this deployment anything other than production?
//
// VERCEL_ENV is "production" | "preview" | "development", set by Vercel on both
// the build and the running server. Absent locally, which counts as not-preview:
// a dev box does not need to be told it is not production.
//
// NOT available in client bundles. Next.js only inlines NEXT_PUBLIC_* into
// client code, so reading this from a "use client" component silently yields
// false. Server components read it directly; client components take it as a
// prop from the server layout above them (see (marketing)/layout.tsx).
export const IS_PREVIEW: boolean =
  !!process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production"
