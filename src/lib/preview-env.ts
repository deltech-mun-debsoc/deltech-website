// Is this deployment anything other than production?
//
// APP_ENV is "production" | "staging", set on AWS at build and at runtime
// (Dockerfile build arg, deploy/compose.yml). It is absent locally, which counts
// as not-preview: a dev box does not need a staging ribbon.
//
// NOT available in client bundles. Next.js only inlines NEXT_PUBLIC_* into
// client code, so reading this from a "use client" component silently yields
// false. Server components read it directly.
const deployEnv = process.env.APP_ENV

export const IS_PREVIEW: boolean = !!deployEnv && deployEnv !== "production"
