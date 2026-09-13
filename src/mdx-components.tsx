import type { MDXComponents } from "mdx/types"

import {
  Callout,
  Figure,
  MdxLink,
  MdxTable,
  RoleBadge,
  Screenshot,
  Steps,
} from "@/app/(docs)/_components/mdx"
import { RoleCards, SectionIndex } from "@/app/(docs)/_components/role-cards"

// Required by @next/mdx with the App Router. Two jobs:
//   1. map plain markdown elements onto the design system, and
//   2. make the custom components global so no page.mdx needs an import line.
//
// Element styling lives in the .docs-prose block in globals.css rather than
// here, because a class selector styles nested markdown (list items inside
// callouts, code inside tables) that a component map never sees.
const components: MDXComponents = {
  a: MdxLink,
  table: MdxTable,
  Callout,
  Steps,
  Screenshot,
  Figure,
  RoleBadge,
  RoleCards,
  SectionIndex,
}

export function useMDXComponents(): MDXComponents {
  return components
}
