// Is this deployment anything other than production?
//
// APP_ENV is "production" | "staging", set on our own AWS host at build and at
// runtime (Dockerfile build arg, deploy/compose.yml). VERCEL_ENV is the same
// signal on Vercel, kept as the fallback while both hosts exist. Absent locally,
// which counts as not-preview: a dev box does not need to be told it is not
// production.
//
// NOT available in client bundles. Next.js only inlines NEXT_PUBLIC_* into
// client code, so reading this from a "use client" component silently yields
// false. Server components read it directly.
const deployEnv = process.env.APP_ENV ?? process.env.VERCEL_ENV

export const IS_PREVIEW: boolean = !!deployEnv && deployEnv !== "production"
