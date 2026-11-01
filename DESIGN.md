---
name: AlphaBoard
description: Forecast Verification Bulletin. Every plan is issued, stamped valid-until, then verified against what price did.
colors:
  accent: "#2149b0"
  accent-soft: "#e2e9f7"
  accent-soft-hover: "#d3ddf3"
  up: "#0d7446"
  up-soft: "#e0f1e7"
  down: "#b9302a"
  down-soft: "#f8e5e2"
  amber: "#7f5700"
  amber-soft: "#f6edd6"
  page: "#eceee8"
  paper: "#fafbf8"
  wash: "#f2f4ef"
  ink: "#16202b"
  ink-hover: "#26323f"
  ink-2: "#3f4a57"
  ink-3: "#596470"
  on-ink-2: "#c5cdd6"
  line: "#d9ded3"
  line-2: "#c2c9bc"
  isobar: "rgb(33 73 176 / 0.16)"
  night-accent: "#86a8ff"
  night-accent-soft: "#1b2947"
  night-accent-soft-hover: "#24365c"
  night-up: "#4fcb8f"
  night-up-soft: "#0f2a1f"
  night-down: "#ff8378"
  night-down-soft: "#341719"
  night-amber: "#edb94c"
  night-amber-soft: "#2d2411"
  night-page: "#0a101b"
  night-paper: "#101928"
  night-wash: "#152032"
  night-ink: "#e6ebf2"
  night-ink-hover: "#cbd3de"
  night-ink-2: "#b4becc"
  night-ink-3: "#8e9aab"
  night-on-ink-2: "#3b4655"
  night-line: "#1f2b40"
  night-line-2: "#2c3b56"
  night-isobar: "rgb(134 168 255 / 0.12)"
typography:
  display:
    fontFamily: "Public Sans, Segoe UI, system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Public Sans, Segoe UI, system-ui, sans-serif"
    fontSize: "27px"
    fontWeight: 800
    lineHeight: 1.12
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Public Sans, Segoe UI, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Public Sans, Segoe UI, system-ui, sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.625
    fontFeature: "\"ss01\""
  label:
    fontFamily: "Public Sans, Segoe UI, system-ui, sans-serif"
    fontSize: "10.5px"
    fontWeight: 700
    letterSpacing: "0.08em"
  band:
    fontFamily: "Public Sans, Segoe UI, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    letterSpacing: "0.09em"
  figure:
    fontFamily: "JetBrains Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "17px"
    fontWeight: 600
    letterSpacing: "-0.01em"
    fontFeature: "\"tnum\""
  stamp:
    fontFamily: "JetBrains Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "10.5px"
    fontWeight: 600
    letterSpacing: "0.06em"
rounded:
  sheet: "0px"
  sm: "2px"
  md: "3px"
  lg: "4px"
  xl: "5px"
  2xl: "6px"
  3xl: "8px"
  full: "9999px"
spacing:
  hair: "2px"
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  2xl: "24px"
components:
  sheet:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.sheet}"
    padding: "20px"
  bulletin-band:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.paper}"
    typography: "{typography.band}"
    padding: "8px 24px"
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.lg}"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.ink-hover}"
    textColor: "{colors.paper}"
  button-secondary:
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    height: "40px"
  button-secondary-hover:
    backgroundColor: "{colors.wash}"
  seg:
    backgroundColor: "{colors.wash}"
    rounded: "{rounded.lg}"
    padding: "2px"
  seg-item:
    textColor: "{colors.ink-2}"
    rounded: "{rounded.md}"
    padding: "4px 12px"
  seg-item-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
  chip:
    textColor: "{colors.ink-3}"
    typography: "{typography.stamp}"
    rounded: "{rounded.md}"
    padding: "3px 9px"
  chip-active:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
  stamp:
    textColor: "{colors.ink-3}"
    typography: "{typography.stamp}"
    rounded: "{rounded.sm}"
    padding: "2px 6px"
  direction-badge-long:
    backgroundColor: "{colors.up-soft}"
    textColor: "{colors.up}"
    rounded: "{rounded.md}"
    padding: "4px 10px"
  direction-badge-short:
    backgroundColor: "{colors.down-soft}"
    textColor: "{colors.down}"
    rounded: "{rounded.md}"
    padding: "4px 10px"
  callout-caution:
    backgroundColor: "{colors.amber-soft}"
    textColor: "{colors.amber}"
    rounded: "{rounded.lg}"
    padding: "8px 12px"
---

# Design System: AlphaBoard

## Overview

**Creative North Star: "The Forecast Verification Bulletin"**

A trade plan is treated like a weather forecast. It is issued, stamped with when it was issued and how long it is valid, and later verified against what price did. The interface is the bulletin office: square-cut paper sheets with a heavy printed rule along the top, boxed monospace issue stamps, a masthead with a UTC clock, and faint isobar contours on the chart paper behind everything. It explicitly rejects two looks: the dark neon trading terminal and the soft rounded-card dashboard.

There are two themes that share every token name. **Day chart** (light) is cool off-white paper with near-black ink. **Radar night** (dark) is deep navy with pale ink. The theme follows the OS preference until the user pins it with the masthead switch (`<html data-theme>`, stored as `alphaboard.theme`); a boot script in `app/layout.tsx` applies the pin before first paint. Any surface that paints its own pixels, such as a chart canvas or an embedded widget, must read the tokens at runtime and rebuild when the theme changes.

Density is a working desk: compact 12–13.5px UI text, figures in tabular mono, sheets on a 16px gap. Colour is mostly ink on paper. Hue carries meaning: price direction, caution, or emphasis.

**Key Characteristics:**
- Square-cut sheets with a 3px ink top rule over a hairline border
- One committed colour field per screen: the isobar-blue band on the trade ticket
- Boxed uppercase mono stamps for every issue and validity time, always in UTC
- Isobar contour mask behind the whole app, tinted by the `isobar` token
- Drawn SVG glyphs (direction triangles, masthead mark, theme icons), never icon fonts or unicode arrows
- Every text pair clears WCAG AA (4.5:1) in both themes

## Colors

Ink on paper, with three meaning-bearing hues and a single blue accent. Every token is defined twice in `app/globals.css`: day values under `@theme` and radar-night values under `:root[data-theme="dark"]` and the `prefers-color-scheme: dark` fallback. The `night-*` keys in the frontmatter are the dark values of the same utility names (`bg-paper`, `text-ink-2`, and so on). Components never switch tokens per theme.

### Primary
- **Isobar Blue** (`accent` / `night-accent`): emphasis and active state. Used for the active nav underline, the key figure inside a plan headline ("Buy near **price**"), the entry price line and EMA 20 on the chart, pressed study chips, focus rings, text selection and the caret. It is also the only filled colour field: the trade ticket's bulletin band.
- **Isobar Wash** (`accent-soft`, `accent-soft-hover`): the fill behind a pressed chip or an accent callout.

### Secondary (price direction)
- **Rising Green** (`up`, `up-soft`): price went or is expected to go up. Used for long setups, take-profit levels, positive R, the live-candle dot and bullish candles.
- **Falling Red** (`down`, `down-soft`): price went or is expected to go down. Used for short setups, stop levels, negative R, bearish candles and error callouts.

### Tertiary (caution)
- **Watch Amber** (`amber`, `amber-soft`): caution, expiry and secondary studies. Used for an expired "Valid to" stamp, inconsistent-plan warnings and the EMA 50 line.

### Neutral
- **Page** (`page`): the ground behind every sheet. The perforation notch cut-outs also use it.
- **Paper** (`paper`): sheet surface and chart background, and the text colour on ink and accent fills.
- **Wash** (`wash`): recessed fills such as segmented-switch tracks, resolved or neutral badges, skeletons and hover rows.
- **Ink** (`ink`, `ink-hover`): primary text, the 3px sheet rule, the masthead's 2px bottom rule, primary buttons and the active segment.
- **Ink 2 / Ink 3** (`ink-2`, `ink-3`): secondary text and quiet metadata (labels, stamps, chart axis text). `on-ink-2` is secondary text on ink surfaces.
- **Hairline** (`line`, `line-2`): sheet borders, dividers, chart grid; `line-2` for chip and secondary-button strokes, perforations and scrollbars.
- **Isobar** (`isobar`): only the background contour mask.

### Named Rules
**The Direction-Only Rule.** Green and red mean price direction and nothing else: long/short, target/stop, positive/negative R, candles. Never use them for "success" chrome, brand or decoration. Errors borrow `down-soft`/`down` because an error is a stop.

**The One Field Rule.** The trade ticket's bulletin band is the one committed colour field on the market screen. Everywhere else the accent is a stroke, a word or a line, never a filled panel.

**The AA Both Ways Rule.** Every text colour clears 4.5:1 on page, paper, wash and its own `-soft` fill in both themes (the tightest pair, `up` on `page` in day chart, is about 5.0:1). A new token, or a change to an old one, must be re-checked in both themes before it ships.

## Typography

**Display Font:** Public Sans (with Segoe UI, system-ui)
**Body Font:** Public Sans
**Label/Mono Font:** JetBrains Mono (with ui-monospace, SF Mono, Menlo)

**Character:** Public Sans is the plain workhorse face of public-service bulletins, so one family carries both UI and display. Headlines are set extra-bold (800) with tight negative tracking. JetBrains Mono is reserved for anything a reader compares or times: prices, percentages, R multiples, timeframes and stamps. Body text enables stylistic set `ss01`.

### Hierarchy
- **Display** (800, 30px, line-height 1, -0.03em): the symbol at the top of the chart sheet, set beside the live price in mono at the same size.
- **Headline** (800, 26–27px, ~1.12, -0.02em, balanced): the plan statement on the ticket ("Stay flat. No clean setup on 1H.").
- **Title** (800, 17px): masthead wordmark and sheet titles.
- **Body** (400, 13.5px, relaxed 1.625): explanations and reasoning; 12–13px for supporting copy and legends.
- **Label** (700, 10.5px, 0.08em, uppercase, `ink-3`): field labels inside a sheet (`Entry`, `24h high`).
- **Band** (700, 11px, 0.09em, uppercase, paper on accent): the bulletin band only.
- **Figure** (mono 600, 17px, tabular, -0.01em): plan figures; mono 11–12px for chips, timeframe segments and axis labels.
- **Stamp** (mono 600, 10.5px, 0.06em, uppercase): issue and validity stamps, UTC clock.

### Named Rules
**The Figures-Only Mono Rule.** Monospace is only for figures and timestamps. Prose, labels and buttons are always Public Sans.

**The No-Eyebrow Rule.** Uppercase labels name a field inside a sheet. Never put one above a heading as an eyebrow or kicker; a heading carries its own meaning.

## Layout

The market screen is a centred column (max 1680px, 16px gutters, 24px from `md`) of sheets on a 16px gap. From `xl` the chart sheet and a fixed 400px trade ticket sit side by side (`minmax(0,1fr) 400px`). The timeframe ladder runs full width below them, then a three-column row of patterns, futures/stats and news (`1fr 1fr 1.3fr` from `lg`). Below these breakpoints everything stacks in a single column. Content pages use `max-w-6xl`.

The masthead is 56px tall on `md` and up, with a 2px ink bottom rule. On narrow screens the nav wraps to its own horizontally scrolling row. The UTC clock appears from `lg`.

Spacing follows Tailwind's 4px steps. Sheets use 16–20px padding and the ticket uses 24px side padding. Gaps are mostly 12px, 8px and 6px, with 2px inside segmented tracks. The chart is 340px tall on mobile and 480px from `md`.

## Elevation & Depth

Depth comes from rule weight and the page/paper contrast, not from lift. A sheet carries one near-flat shadow (`0 1px 0 rgb(0 0 0 / 0.02), 0 10px 24px -18px rgb(10 16 27 / 0.25)`) so it reads as paper resting on the chart table. Floating menus (account, notifications, asset search) add a shadow because they sit above content. Nothing else casts a shadow.

### Named Rules
**The Printed Rule Rule.** Hierarchy comes from line weight: 3px ink across the top of a sheet, 2px ink under the masthead, 1px hairlines everywhere else. Shadows do not do this job.

## Shapes

Shapes are square-cut. Sheets have a 0px radius. The whole Tailwind radius scale is tightened (`sm` 2px through `3xl` 8px), so `rounded-lg` on a button renders as a crisp 4px corner. Stamps use 2px, chips and segments 3px, and buttons and callouts 4px. Full rounding is reserved for dots (the live indicator) and avatars.

The trade ticket contains a **perforation**: a dashed `line-2` rule with half-circle notches in the `page` colour at each edge. It is the tear line between the forecast and its figures.

## Components

### Sheet (panel)
- **Character:** a printed bulletin sheet.
- **Shape:** 0px radius, 1px `line` border with a 3px `ink` top border, sheet shadow.
- **Background:** `paper`. Padding 16px on mobile and 20px from `md`; the ticket uses 24px side padding below its band.

### Bulletin band (trade ticket header)
- Full-width `accent` strip at the top of the ticket, with paper text in the band style. Left: "Forecast · {timeframe}". Right: the state ("Drafting", "Not issued", or "AI confidence NN%" with the number in mono). The right side is set at 0.9 opacity.

### Issue stamps
- Boxed `1px currentColor` border, 2px radius, mono uppercase, `ink-3` by default. "Issued 14:05 UTC" (with a date prefix such as "04 NOV" when it is not today) and then "Valid to …" in `accent`, which becomes "Expired …" in `amber`. A "Verified" stamp lands with the `stamp-in` animation (420ms, expo-out, small scale and rotate) when a plan has resolved.

### Direction badge and glyph
- 3px-radius badge on `up-soft`/`down-soft`/`wash` with matching text, extra-bold 12px, 0.04em: "LONG SETUP", "SHORT SETUP", "NO TRADE", or "… · PLAYED OUT" on `wash` once resolved. It leads with the drawn **DirectionGlyph**, a 10px SVG front symbol: a rising triangle, a falling triangle, or a flat bar.

### Buttons
- **Primary:** `ink` fill, `paper` text, 4px corners, 40–44px tall, extra-bold 13–14px; hover `ink-hover`; disabled at 40% opacity.
- **Secondary:** 1px `line-2` stroke, `ink` text, bold 13px; hover fills `wash`.
- **Text action:** `accent` bold 12.5px, underline on hover ("Regenerate plan" while a plan is live).
- **Icon button:** 32px square, 3px corners, `line` stroke, `ink-2` icon; hover darkens stroke and icon.

### Segmented switch and chips
- **Seg:** `wash` track with a `line` border, 4px corners and 2px padding. Items are 12px semibold `ink-2`; hover shows `paper`; the selected item (`aria-selected` or `aria-pressed`) is filled `ink` with `paper` text. It is used for the chart source (AlphaBoard / TradingView) and the timeframe, where items are set in mono.
- **Chip:** mono 11px `ink-3` with a `line-2` stroke and 3px corners. When pressed it switches to an `accent` stroke and text on `accent-soft`. It is used for chart studies (Vol, EMA 20, EMA 50).

### Navigation (masthead)
- `paper` bar with a 2px `ink` bottom rule. On the left is the **BulletinMark** (an SVG closed isobar in ink and accent, cut by a rising price path) with the extra-bold 17px wordmark. Links are 13px semibold `ink-2`; the active link turns `ink` with a 3px `accent` underline bar. On the right are the UTC clock (mono 11px), asset search, theme switch (drawn sun/moon), notification bell and account menu.

### Chart
- **AlphaBoard chart** (lightweight-charts): reads `--color-paper`, `--color-line`, `--color-ink-3`, `--color-up`, `--color-down`, `--color-accent` and `--color-amber` at creation and rebuilds on theme change. It has horizontal grid lines only and mono 11px axis text. Plan levels: entry is solid accent, take profit dashed up, stop dashed down, support/resistance dotted `ink-3`. Volume bars use the candle hue at 35% alpha. A legend under the chart repeats the line styles.
- **TradingView widget:** themed light or dark to match, with `backgroundColor` set to `--color-paper` and `gridColor` to `--color-line` so it sits on the sheet. The "chart by TradingView" attribution link stays visible, as the free widget requires.
- **Live indicator:** a 6px `up` dot with a single slow radar ping (2.4s), "Live candle" in `up`.

### Callouts
- 4px-radius strip at 8px × 12px, 13px text: `down-soft`/`down` for errors, `amber-soft`/`amber` for caution, `up-soft`/`down-soft`/`wash` for a verified outcome.

## Do's and Don'ts

### Do:
- **Do** use the theme tokens (`bg-paper`, `text-ink-2`, `border-line` and so on) for every colour, so both themes work without per-theme code.
- **Do** read tokens with `getComputedStyle` in anything that paints its own pixels, and rebuild it on `useColorScheme()` change.
- **Do** stamp every issued plan with "Issued" and "Valid to" times in UTC using the boxed mono stamp.
- **Do** set every price, percentage, R multiple and timeframe in mono with tabular figures.
- **Do** draw icons and glyphs as inline SVG coloured with `currentColor` or token classes.
- **Do** give every sheet the square-cut 3px ink top rule.
- **Do** show missing data as missing ("—", "Unavailable"). Never present an invented number, statistic, testimonial or count.
- **Do** honour reduced motion: animations collapse, the live ping hides, and loading becomes a slow opacity breath.

### Don't:
- **Don't** use `up`/`down` for anything except price direction, or `amber` for anything except caution.
- **Don't** add a second filled accent field to a screen. The ticket band is the only one.
- **Don't** put uppercase eyebrow labels or kickers above headings.
- **Don't** use unicode arrows or icon fonts for direction. Use the drawn DirectionGlyph.
- **Don't** round sheets, or use radii outside the tightened scale.
- **Don't** use mono for prose, labels or buttons.
- **Don't** ship a text colour pair under 4.5:1 in either theme.
- **Don't** drift toward the neon terminal (glow, black-and-green) or the soft card dashboard (large radii, floating shadowed cards).
