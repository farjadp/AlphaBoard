# AlphaBoard v2 — Technical UI audit (impeccable)

Date: 2026-09-29 · Build: `5c3811f` · Method: impeccable detector over `app/` + `components/` (0 findings); axe-core 4.13 (WCAG 2.0/2.1 A+AA + best practices) on 17 routes at 1440px and 5 routes at 390px, signed out and as a signed-in admin test account (deleted afterwards); WCAG contrast computed for every token pair; mobile touch-target and overflow measurement; keyboard Tab walk (25 stops) on the market screen; static review of motion, dependencies and hard-coded colours.

## Health score

| # | Dimension | Score | Key finding |
|---|-----------|-------|-------------|
| 1 | Accessibility | 2 | `ink-3` secondary text is 3.2–3.6:1 — 411 contrast failures on every page; 11 unlabeled form controls (journal, academy) |
| 2 | Performance | 3 | Lean: next/image, charts only on the market route, largest chunk ≈ 71 KB gz; 3 unused dependencies |
| 3 | Responsive | 3 | No horizontal overflow at 390px; small inline text links under 24px tall; dense controls under 44px |
| 4 | Theming | 3 | Token system used everywhere; a few hard-coded hovers/colours; light-only by decision (no dark theme) |
| 5 | Implementation integrity | 4 | Detector clean; one coherent “briefing” system; honest empty/unavailable states |
| **Total** | | **15/20** | **Good** — one systemic colour fix and a labelling pass away from AA |

**Integrity verdict: pass.** One product-specific system (tokens in `app/globals.css`, Manrope/JetBrains Mono/Bricolage, panels, ticket perforation, decision-first market screen), zero detector findings, and content that refuses to invent numbers.

## Findings

### P1 — fix before release
1. **Secondary text contrast (systemic).** `ink-3 #7d8896` on page/paper/wash = 3.18 / 3.60 / 3.38:1 (AA needs 4.5:1 for text under 18.66px bold / 24px). Also `up #138a4b` on paper 4.41, `amber #a86f06` on paper 4.25, and badge text on soft fills (`up`/`up-soft` 3.86, `down`/`down-soft` 4.42, `amber`/`amber-soft` 3.85). 411 nodes, all 22 page views. WCAG 1.4.3. **Fix:** darken the tokens once in `@theme` (ink-3, up, down, amber) so every pair clears 4.5:1; no component changes. → `/impeccable polish`
2. **Unlabeled form controls.** Journal: entry/exit price inputs and position/emotion selects; Academy: two selects. Screen readers announce them as “edit text” / “combo box” with no name. WCAG 1.3.1, 4.1.2. **Fix:** `htmlFor`/`id` pairs or `aria-label`. → `/impeccable harden`

### P2 — next pass
3. **Scroll areas not reachable by keyboard** (mobile timeframe ladder, Performance breakdown tables). Keyboard users can't scroll them. WCAG 2.1.1. **Fix:** `tabIndex={0}` + `aria-label` on the scroll container. → `/impeccable adapt`
4. **Landmarks/headings:** `/login` and `/setup` have no `<main>`; `/login` has no `<h1>`; heading levels skip on journal, archive, alerts, admin/ai. WCAG 1.3.1 (best practice). → `/impeccable harden`
5. **Reduced motion kills feedback:** the global `prefers-reduced-motion` rule sets `animation: none !important` on everything, so loading skeletons and the “AI Parsing…” pulse lose their only “working” cue. **Fix:** keep a static loading state (text/opacity) instead of removing it. → `/impeccable animate`
6. **Small targets:** inline text links (“Performance →”, “Reset account…”, footer “Risk disclaimer & terms”) are under 24px tall (WCAG 2.5.8 AA minimum); most dense controls are 24–43px (fine for AA, below the 44px comfort target on phones). → `/impeccable adapt`

### P3 — polish
7. Empty `<th>` cells (Performance breakdowns, Admin → AI) — add `sr-only` text.
8. Unused dependencies `axios`, `ws`, `@hello-pangea/dnd`; legacy CSS aliases (`.glass-card`, `.glow-btn`, `.gradient-text`, `--text/--surface…`) still defined. → `/impeccable distill`
9. Hard-coded colours: hover `#23313f` (several buttons), landing dark-band text `#c3ccd6`, academy legend colours — move to tokens. → `/impeccable polish`

## Positive findings
- Keyboard: all 25 Tab stops on the market screen have a visible focus ring, in a logical order (nav → search → bell → account → watchlist → timeframes → plan).
- No horizontal overflow at 390px on any tested page; the footer notice stays visible.
- Charts ship `sr-only` data tables; icon buttons have `aria-label`s; images have descriptive alt text.
- `prefers-reduced-motion` is respected (see P2-5 for the nuance).
- Performance: optimized images, route-scoped chart library, no layout thrash patterns found.

## Recommended order
1. [P1] `/impeccable polish` — token contrast fix (1 file) + hard-coded colours.
2. [P1] `/impeccable harden` — form labels, landmarks, headings, empty headers.
3. [P2] `/impeccable adapt` — keyboard-scrollable regions, target sizes.
4. [P2] `/impeccable animate` — reduced-motion alternative for loading states.
5. [P3] `/impeccable distill` — unused deps and legacy aliases.
6. `/impeccable polish` — final pass, then re-run this audit.

---

## Re-run after fixes (same day)

axe-core on the same 22 page views, now also with the WCAG 2.2 AA rules (target size): **0 violations** (first run: 8 rule types, 520+ nodes). Detector: 0 findings. Tests 216/216, lint and build clean.

| # | Dimension | Before | After | What changed |
|---|-----------|--------|-------|--------------|
| 1 | Accessibility | 2 | 4 | Tokens `ink-3 #616a74`, `up #117c43`, `down #c23329`, `amber #936105` — every text pair ≥ 4.6:1 on page/paper/wash/soft fills; 11 form controls labelled (`htmlFor`/`id`, `useId`, `aria-label`); three click-only upload areas are now keyboard buttons; `<main>` + `<h1>` on login/setup; heading levels fixed on journal, archive, alerts, admin/ai; empty `<th>` get `sr-only` names |
| 2 | Performance | 3 | 4 | Removed unused `axios`, `ws`, `@hello-pangea/dnd` |
| 3 | Responsive | 3 | 4 | Horizontal scroll regions are focusable and named; standalone text links ≥ 24px tall (WCAG 2.5.8) |
| 4 | Theming | 3 | 3 | Hard-coded hovers → `ink-hover`, `accent-soft-hover`, `on-ink-2` tokens; legacy aliases and `--text/--surface…` variables removed. Still light-only by decision; academy chart-annotation colours stay literal (canvas drawing palette) |
| 5 | Implementation integrity | 4 | 4 | `.glass-card` → `.panel` everywhere |
| **Total** | | **15/20** | **19/20** | **Excellent** |

Reduced motion now keeps a slow opacity "breath" on skeletons and busy indicators instead of removing every animation, so loading stays visible without movement.
