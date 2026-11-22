# Design Tokens

The global token source is `src/app/globals.css`. It defines the light and dark semantic color variables, font aliases, radii, chart colors, sidebar colors, and reusable editorial utilities consumed by Tailwind v4. Component-level sizes and variants live with their components, such as `src/components/ui/button.tsx` and `src/components/ui/input.tsx`.

Use semantic utilities such as `bg-background`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary`, and `font-heading` instead of embedding raw colors or font stacks in page components. Add a shared visual pattern to `globals.css` only when it is used across multiple routes; otherwise keep the styling beside the component that owns it.

The main shared layout and type utilities are:

- `section-shell` for the responsive page width;
- `display-hero` and `display-section` for editorial display type;
- `body-large` for prominent readable supporting copy;
- `data-label` and `eyebrow` for operational labels;
- `diplomatic-surface`, `paper-grid`, and `noise-wash` for the visual system.

The newsletter (`src/app/(marketing)/newsletter/`) is a deliberate exception. It reproduces a printed issue, so its typefaces (Tinos, Lora, Anton, DM Serif Display, UnifrakturMaguntia), uppercase labels, red accent and paper background are scoped to the `.newsletter` wrapper in `newsletter.css` and stay light in dark mode to match print. Do not reuse them outside that route.
