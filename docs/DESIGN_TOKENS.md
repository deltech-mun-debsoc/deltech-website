# Design Tokens

The global token source is `src/app/globals.css`. It defines the light and dark semantic color variables, font aliases, radii, chart colors, sidebar colors, and reusable editorial utilities consumed by Tailwind v4. Component-level sizes and variants live with their components, such as `src/components/ui/button.tsx` and `src/components/ui/input.tsx`.

Use semantic utilities such as `bg-background`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary`, and `font-heading` instead of embedding raw colors or font stacks in page components. Add a shared visual pattern to `globals.css` only when it is used across multiple routes; otherwise keep the styling beside the component that owns it.

The main shared layout and type utilities are:

- `section-shell` for the responsive page width;
- `display-hero` and `display-section` for public editorial headlines (Fraunces). Keep their leading and tracking; tighter values make ascenders collide and fuse "fl";
- `font-heading` / plain `h1`-`h4` follow `--heading-face`: Fraunces on public pages, Geist inside `.admin-shell`, `.recruitment-shell` and `.app-shell` (delegate dashboard, writer area);
- `body-large` for prominent readable supporting copy;
- `eyebrow` is an occasional tracked uppercase marker above a public headline (sentence case inside the app shells). Use it where it adds information, not above every section;
- `data-label` and `section-label` for ordinary labels, in sentence case. Do not add `uppercase` or wide `tracking-*` to labels, buttons, navigation, table headers or statuses;
- `font-mono` only for identifiers, codes and numbers that need aligned digits.

Brand assets live in `public/brand/` and are rendered through `BrandLogo` and `BrandEmblem` (`src/components/brand-logo.tsx`): full lockup and emblem-only, each in white, navy (#244278) and black, extracted from `deltech-mun-source.jpg` without redrawing. Use the emblem where space is small; never shrink the full lockup into an icon.
