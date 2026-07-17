# Zwep — Design System

> The Zwep web UI and admin panel follow an **OpenAI-inspired design language**:
> clean, neutral, typography-first, generous whitespace, restrained accents, and
> crisp interactions. This document is the single source of truth for tokens,
> typography, colour, spacing, and components.

---

## 1. Design principles

1. **Typography-first.** Content and results are the interface. Chrome recedes.
2. **Neutral, warm greyscale.** Near-black text on near-white; colour used sparingly.
3. **Generous whitespace.** Let results breathe; large line-height, roomy padding.
4. **Soft depth.** Subtle borders and shadows, never heavy. 1px hairlines do most work.
5. **Calm motion.** Fast (120–200ms), ease-out, functional — no bounce, no spectacle.
6. **Accessible by default.** WCAG AA contrast, visible focus rings, reduced-motion.

---

## 2. Colour tokens

OpenAI's system is a warm-neutral greyscale with a single functional accent
(near-black for primary actions) and a restrained green for positive/brand moments.

### Light theme
```css
:root {
  /* Surfaces */
  --z-bg:            #ffffff;   /* page background */
  --z-surface:       #f7f7f8;   /* cards, subtle fills */
  --z-surface-2:     #ececf1;   /* hover fills, dividers bg */
  --z-overlay:       rgba(0,0,0,0.4);

  /* Text */
  --z-text:          #0d0d0d;   /* primary text (near-black) */
  --z-text-secondary:#565869;   /* secondary/labels */
  --z-text-tertiary: #8e8ea0;   /* hints, placeholders */
  --z-text-inverse:  #ffffff;

  /* Lines */
  --z-border:        #e5e5e5;   /* hairline borders */
  --z-border-strong: #d1d1d1;

  /* Accent (primary action = near-black, OpenAI style) */
  --z-accent:        #0d0d0d;
  --z-accent-hover:  #2b2b2b;
  --z-accent-text:   #ffffff;

  /* Brand / positive */
  --z-brand:         #10a37f;   /* OpenAI green — links, highlights, success */
  --z-brand-hover:   #0e8e6d;

  /* Status */
  --z-success:       #10a37f;
  --z-warning:       #d97706;
  --z-danger:        #e02e2e;
  --z-info:          #2563eb;

  /* Focus */
  --z-focus-ring:    rgba(16,163,127,0.45);
}
```

### Dark theme
```css
:root[data-theme="dark"] {
  --z-bg:            #0d0d0d;
  --z-surface:       #171717;
  --z-surface-2:     #212121;
  --z-overlay:       rgba(0,0,0,0.6);

  --z-text:          #ececf1;
  --z-text-secondary:#c5c5d2;
  --z-text-tertiary: #8e8ea0;
  --z-text-inverse:  #0d0d0d;

  --z-border:        #2f2f2f;
  --z-border-strong: #3f3f3f;

  --z-accent:        #ffffff;
  --z-accent-hover:  #ececf1;
  --z-accent-text:   #0d0d0d;

  --z-brand:         #19c39a;
  --z-brand-hover:   #10a37f;

  --z-success:       #19c39a;
  --z-warning:       #f59e0b;
  --z-danger:        #ff5c5c;
  --z-info:          #4b8bff;

  --z-focus-ring:    rgba(25,195,154,0.5);
}
```

**Usage rules**
- Primary buttons use `--z-accent` (near-black in light, white in dark) — the
  signature OpenAI inversion.
- Links and active/selected states use `--z-brand` (green).
- Never place `--z-brand` text on `--z-surface` below AA — check contrast.

---

## 3. Typography

OpenAI uses a clean grotesque system stack (Söhne in production; we approximate
with Inter + system fallbacks). Monospace for code/URLs.

```css
:root {
  --z-font-sans: "Inter", "Söhne", -apple-system, BlinkMacSystemFont,
                 "Segoe UI", Helvetica, Arial, sans-serif;
  --z-font-mono: "JetBrains Mono", "SF Mono", "Söhne Mono", ui-monospace,
                 Menlo, Consolas, monospace;
}
```

### Type scale (1.250 major-third, 16px base)
| Token | Size / line-height | Weight | Use |
|-------|--------------------|--------|-----|
| `--z-text-display` | 48 / 1.1 | 600 | Landing hero |
| `--z-text-h1` | 32 / 1.2 | 600 | Page title |
| `--z-text-h2` | 24 / 1.3 | 600 | Section |
| `--z-text-h3` | 20 / 1.4 | 600 | Sub-section |
| `--z-text-body` | 16 / 1.6 | 400 | Body, result snippet |
| `--z-text-sm` | 14 / 1.5 | 400 | Labels, meta |
| `--z-text-xs` | 12 / 1.4 | 500 | Badges, captions |

- Body line-height is deliberately roomy (1.6) for readability.
- Result titles: `--z-text-h3`, weight 600, `--z-brand` on hover.
- URLs/paths: `--z-font-mono`, `--z-text-secondary`.

---

## 4. Spacing & layout

4px base grid.
```css
:root {
  --z-space-1: 4px;   --z-space-2: 8px;   --z-space-3: 12px;
  --z-space-4: 16px;  --z-space-5: 24px;  --z-space-6: 32px;
  --z-space-7: 48px;  --z-space-8: 64px;  --z-space-9: 96px;
}
```
- **Content width:** search results column max `720px`, centred (readability).
- **Page gutters:** `--z-space-5` mobile, `--z-space-7` desktop.
- **Result item padding:** `--z-space-4` vertical, hairline `--z-border` divider.

---

## 5. Radius, borders, shadows

```css
:root {
  --z-radius-sm: 6px;
  --z-radius-md: 10px;   /* inputs, buttons */
  --z-radius-lg: 16px;   /* cards, popovers */
  --z-radius-pill: 999px;

  --z-shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
  --z-shadow-md: 0 4px 12px rgba(0,0,0,0.08);
  --z-shadow-lg: 0 12px 32px rgba(0,0,0,0.12);
}
```
- Cards: `--z-radius-lg`, `1px solid --z-border`, `--z-shadow-sm` (lift to `md` on hover).
- Inputs/buttons: `--z-radius-md`.
- Shadows are soft and low-opacity — depth by hairline first, shadow second.

---

## 6. Motion

```css
:root {
  --z-ease: cubic-bezier(0.2, 0, 0, 1);   /* ease-out, OpenAI-like */
  --z-dur-fast: 120ms;
  --z-dur-base: 180ms;
  --z-dur-slow: 260ms;
}
```
- Hover/focus: `--z-dur-fast`. Popover/menu: `--z-dur-base`.
- Result list entrance: subtle fade+translateY(4px), staggered ≤ 40ms.
- Always wrap in `@media (prefers-reduced-motion: reduce) { * { animation: none; transition: none; } }`.

---

## 7. Core components

### 7.1 Search bar (hero)
- Large pill/rounded input (`--z-radius-lg`), `1px solid --z-border`, `--z-shadow-sm`.
- Focus: border → `--z-brand`, ring `0 0 0 4px var(--z-focus-ring)`.
- Leading search glyph in `--z-text-tertiary`; optional source/filter chip inside.
- Height 56px hero, 44px in-header.

### 7.2 Result item
```
[ Title (h3, brand on hover) ]
example.com › section              ← mono, secondary
Snippet text with the matched term highlighted (brand, 600). Roomy line-height.
[type badge] [date] [tag] [tag]    ← xs badges, tertiary
```
- Hairline divider between items; whole item is a hit target; keyboard-navigable.
- Matched terms wrapped in `<mark>` styled with `--z-brand` bg tint, not yellow.

### 7.3 Buttons
| Variant | Bg | Text | Border |
|---------|----|----|--------|
| Primary | `--z-accent` | `--z-accent-text` | none |
| Secondary | `--z-surface` | `--z-text` | `--z-border` |
| Ghost | transparent | `--z-text-secondary` | none (hover: `--z-surface`) |
| Danger | `--z-danger` | `#fff` | none |

- Radius `--z-radius-md`, padding `10px 16px`, weight 500, `--z-dur-fast` transitions.

### 7.4 Facet / filter chips
- Pill (`--z-radius-pill`), `--z-surface` bg, `--z-border`. Selected: `--z-accent`
  bg + inverse text. Count badge in `--z-text-tertiary`.

### 7.5 Badges (type/status)
- `--z-text-xs`, `--z-radius-sm`, tinted bg per status (success/warn/danger/info at ~12% alpha), matching text colour.

### 7.6 Empty & loading states
- Empty: centred, tertiary text + a suggestion ("Try fewer keywords").
- Loading: skeleton rows matching result layout (shimmer at `--z-surface-2`).

### 7.7 Admin panel
- Two-column: left nav (Sources, Crawls, Index, Logs, Settings), right content cards.
- Data tables: hairline rows, `--z-text-sm`, monospace for URLs/hashes, status badges.
- Crawl status: progress bar in `--z-brand`; error rows tinted `--z-danger` at 8%.

---

## 8. Iconography
- Line icons, 1.5px stroke, 20/24px grid (e.g. Lucide). Colour inherits text token.
- No filled/duotone by default — matches the restrained OpenAI feel.

---

## 9. Accessibility checklist
- [ ] Text contrast ≥ 4.5:1 (AA); large text ≥ 3:1.
- [ ] Visible focus ring (`--z-focus-ring`) on every interactive element.
- [ ] Full keyboard nav for search + results + facets.
- [ ] `prefers-reduced-motion` respected.
- [ ] Semantic landmarks (`<main>`, `<nav>`, `<search>`), ARIA on live result count.
- [ ] Hit targets ≥ 44×44px.

---

## 10. Do / Don't

**Do**
- Let whitespace and hairlines define structure.
- Use green (`--z-brand`) only for links, highlights, positive states.
- Keep motion fast and subtle.

**Don't**
- Add gradients, heavy shadows, or multiple accent colours.
- Use yellow highlight for matched terms — use the brand tint.
- Crowd results; never drop below `--z-space-4` between items.

---

*This system is intentionally minimal so the crawled content — not the UI — is the
star. Tokens are prefixed `--z-` to avoid collisions when embedded elsewhere.*
