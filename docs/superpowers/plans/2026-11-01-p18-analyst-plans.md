# P18a · Analyst Plans Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Paste an outside analysis (e.g. a weekly video summary), have AI turn it into reviewed price zones, and let the worker watch those zones: one Telegram message when price enters a zone or breaks an invalidation level, plus a recorded outcome per zone so every source gets a scorecard.

**Architecture:** New `AnalystPlan` + `AnalystZone` models. `lib/analyst/*` holds the pure parts (extraction normalising, zone hit/break checks, consensus, scoring) and the DB service. One `aiJson` call extracts a draft; nothing is watched until the owner reviews and activates it. `runTick()` gets a new `evaluateZones()` step next to `evaluateAlerts()`. Admin page `/admin/analyst`.

**Tech Stack:** Next.js 16, TypeScript, Prisma/Postgres, zod 4, vitest, existing `aiJson` / `notify` / `getCandles`.

**Spec:** this document (decisions agreed in chat on 2026-11-01: phase 1 = extraction + zone alerts + score data; **no order is ever created or sent by this feature**).

## Global Constraints

- **No execution.** Nothing in P18a creates a `TradeSignal`, paper order or session order. P18b (draft signal + one-tap confirm) only after a source shows an edge.
- **Nothing is watched before review.** Draft → owner edits/confirms → Activate. Zones the model marked uncertain must be confirmed one by one before activation.
- **Price basis.** Analysts quote broker spot; our feed for gold/silver/oil is Yahoo futures (`=F`). Each plan stores a per-symbol `offset` = feed price − analyst price; checks compare `feedPrice − offset`. The review screen shows the feed's last price next to the analyst's reference price and warns on `=F` symbols with offset 0.
- Admin only (AI cost; same gate as Signal Desk). Feature name in AI usage: `analyst-extract`.
- Conventions from `docs/HANDOFF.md`: `adminRoute` + `enforceRateLimit`, `readJson(req, max)`, DB only through `lib/analyst/store.ts` with `userId` on every query, AI only via `aiJson` with a closed JSON schema, TDD, numbers via `lib/format`.
- Model output is untrusted: every field re-validated; unknown symbols dropped with a warning, never guessed.

## Decisions

| Question | Choice |
|---|---|
| Zone kinds | `BUY`, `SELL` (reaction zones), `TARGET`, `INVALIDATION` (a level whose close beyond it kills the scenario), `INFO` (shown, not watched) |
| "Entered" | first 5m bar (or live quote) whose range overlaps `[low, high]` after activation, offset applied |
| "Invalidated" | a closed bar on the zone's `closeTf` (default `4H`) closes beyond the level in the stated `direction` (`ABOVE`/`BELOW`) |
| One message per event | state machine `WAITING → ENTERED → SCORED` / `WAITING → EXPIRED`; `INVALIDATION`: `WAITING → BROKEN`. Updates are `updateMany` guarded on the old state (same at-most-once pattern as alerts) |
| Scoring (BUY/SELL) | from first touch, over the next 24 h of 1H bars: `RESPECTED` if price moves away from the zone in the expected direction by ≥ `max(zone width, 0.3 % of price)` before a 1H close beyond the far edge; `BROKE` if that close comes first; `UNCLEAR` otherwise. MFE/MAE (price units from the zone's near edge) are stored too, so the rule can change later without losing data |
| Scoring (TARGET) | `HIT` if touched before expiry, else `MISSED` |
| Expiry | plan `expiresAt` (default: next Saturday 00:00 UTC after creation); untouched BUY/SELL → `UNTOUCHED` |
| Consensus | zones of the same symbol and kind from **different sources** in active plans overlap → both flagged "agrees with <source>" (computed on read, not stored) |
| Risk events | plan has `events: {at, label}[]` (model extracts any it names; owner adds NFP etc.). A zone message within ±2 h of an event gets a "⚠️ news risk: <label>" line. No external calendar in P18a |
| Symbols | catalog symbols only (`findAsset`); add `DXY` (`DX-Y.NYB`) to the catalog for dollar-index plans |

## File Structure

- `prisma/schema.prisma` + migration `20261101120000_p18a_analyst_plans` — models + enums.
- `lib/market/catalog.ts` — add `DXY`.
- `lib/analyst/extract.ts` — prompt, zod schema, closed JSON schema, `draftFromExtract()` (pure).
- `lib/analyst/zones.ts` — pure: `zoneTouched`, `closedBeyond`, `scoreReaction`, `agreements`, `nearEvent`.
- `lib/analyst/message.ts` — pure: Telegram/in-app text for each event.
- `lib/analyst/store.ts` — server-only service (create draft, edit zone, confirm, activate, archive, list, scorecard).
- `lib/analyst/job.ts` — `evaluateZones()` for the tick.
- `lib/worker/tick.ts` — call it; `TickResult.analyst`.
- `lib/notify/notifications.ts` — type `"analyst_zone"`.
- `app/api/analyst/extract/route.ts`, `app/api/analyst/plans/route.ts`, `app/api/analyst/plans/[id]/route.ts`, `app/api/analyst/zones/[id]/route.ts`.
- `app/admin/analyst/page.tsx`, `components/admin/analyst/*` (PasteBox, ReviewTable, PlanList, Scorecard), `components/admin/AdminNav.tsx` link.
- Tests: `tests/unit/analystExtract.test.ts`, `tests/unit/analystZones.test.ts`, `tests/unit/analystMessage.test.ts`, `tests/db/analystStore.test.ts`, `tests/db/analystJob.test.ts`.

---

### Task 1: Schema, migration, DXY

**Files:** Modify `prisma/schema.prisma`, `lib/market/catalog.ts`; Create migration.

```prisma
enum AnalystPlanStatus { DRAFT ACTIVE ARCHIVED }
enum AnalystZoneKind { BUY SELL TARGET INVALIDATION INFO }
enum AnalystZoneState { WAITING ENTERED BROKEN SCORED EXPIRED }

model AnalystPlan {
  id          String            @id @default(cuid())
  userId      String
  user        User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  source      String            // "Nima Razzaghi"
  title       String?
  rawText     String
  status      AnalystPlanStatus @default(DRAFT)
  /// [{ at: ISO string, label: string }]
  events      Json              @default("[]")
  /// { "XAU/USD": 18.5 } — feed price minus the analyst's price, per symbol.
  offsets     Json              @default("{}")
  expiresAt   DateTime
  activatedAt DateTime?
  createdAt   DateTime          @default(now())
  zones       AnalystZone[]
  @@index([userId, status])
}

model AnalystZone {
  id            String           @id @default(cuid())
  planId        String
  plan          AnalystPlan      @relation(fields: [planId], references: [id], onDelete: Cascade)
  symbol        String           // catalog symbol
  kind          AnalystZoneKind
  low           Float            // analyst's prices (offset applied at check time)
  high          Float
  /// INVALIDATION only: "ABOVE" | "BELOW" and the timeframe whose close counts.
  direction     String?
  closeTf       String?
  /// Entry condition as written, e.g. "only with a lower-timeframe trigger".
  condition     String?
  note          String?
  uncertain     Boolean          @default(false)
  confirmed     Boolean          @default(false)
  state         AnalystZoneState @default(WAITING)
  lastCheckedAt DateTime         @default(now())
  enteredAt     DateTime?
  enteredPrice  Float?
  /// RESPECTED | BROKE | UNCLEAR | UNTOUCHED | HIT | MISSED
  outcome       String?
  mfe           Float?
  mae           Float?
  scoredAt      DateTime?
  @@index([planId])
  @@index([state])
}
```
Add `analystPlans AnalystPlan[]` to `User`. Catalog: `{ symbol: "DXY", name: "US Dollar Index", category: "forex", yahooSymbol: "DX-Y.NYB", newsKeyword: "US dollar index DXY", icon: "💵" }`.

- [ ] Edit schema + catalog.
- [ ] Generate the SQL with the shadow-DB workaround from `docs/HANDOFF.md` (non-interactive shell), then `prisma migrate deploy` + `prisma generate` on dev and test schemas.
- [ ] `npx tsc --noEmit` clean; `tests/unit/marketSymbols.test.ts` still passes.
- [ ] Commit `feat(analyst): plan and zone models, DXY in the catalog`.

### Task 2: Pure zone logic (`lib/analyst/zones.ts`)

**Produces:**
```ts
export interface Bar { time: number; open: number; high: number; low: number; close: number }
export interface ZoneLike { kind: AnalystZoneKind; low: number; high: number; direction?: string | null }
/** First bar at/after `from` overlapping [low−… high] after subtracting `offset` from bar prices; null if none. */
export function zoneTouched(z: ZoneLike, bars: Bar[], from: number, offset: number): { at: number; price: number } | null
/** First *closed* bar (time + tfMs ≤ now) at/after `from` closing beyond the level. */
export function closedBeyond(z: ZoneLike, bars: Bar[], from: number, tfMs: number, now: number, offset: number): { at: number; close: number } | null
/** RESPECTED / BROKE / UNCLEAR plus mfe/mae; null while the 24 h window is still open and undecided. */
export function scoreReaction(z: ZoneLike, bars1h: Bar[], touchedAt: number, now: number, offset: number): { outcome: "RESPECTED" | "BROKE" | "UNCLEAR"; mfe: number; mae: number } | null
/** zoneId → sources of overlapping same-symbol same-kind zones in other plans. */
export function agreements(zones: Array<ZoneLike & { id: string; symbol: string; source: string }>): Map<string, string[]>
export function nearEvent(at: number, events: Array<{ at: string; label: string }>, windowMs?: number): string | null
```
Direction rules: BUY expects up (near edge = `high`, far edge = `low`); SELL expects down.

- [ ] Failing tests in `tests/unit/analystZones.test.ts`: touch from above / below / gap through / bars before `from` ignored / offset shifts the hit (gold zone 3850–3865 with offset 20 is hit by a feed low of 3884); `closedBeyond` ignores the still-open bar and wrong-side closes; scoring: respected, broke first, unclear at 24 h, null before 24 h with no decision, decided early when either side is reached; `agreements` needs different sources and overlap (touching edges count); `nearEvent` ±2 h.
- [ ] Implement; tests pass.
- [ ] Commit `feat(analyst): zone touch, break, scoring and consensus`.

### Task 3: Extraction (`lib/analyst/extract.ts`) + route

**Produces:** `ANALYST_EXTRACT_PROMPT`, `AnalystExtractSchema`, `ANALYST_EXTRACT_JSON`, and
```ts
export interface ZoneDraft { symbol: string; kind: AnalystZoneKind; low: number; high: number; direction: "ABOVE" | "BELOW" | null; closeTf: string | null; condition: string | null; note: string | null; uncertain: boolean }
export interface PlanDraft { source: string | null; title: string | null; events: { at: string; label: string }[]; refPrices: Record<string, number>; zones: ZoneDraft[]; warnings: string[] }
export function draftFromExtract(x: AnalystExtract, now: Date): PlanDraft
```
The model returns per zone: raw symbol text, kind, low, high, direction, closeTf, condition, note, `uncertain` (true when the text marks the number unclear — e.g. ⚠️, two conflicting numbers, or a garbled figure), and per symbol the analyst's "current price" if stated. Prompt tells it: copy numbers as written, never fix them, mark doubt instead; Persian or English input.

`draftFromExtract`: map symbols via `matchCatalogSymbol` (gold/طلا/XAUUSD → `XAU/USD`, داوجونز/US30 → `DJI`, dollar index → `DXY`); drop unknown symbols with a warning; swap `low > high`; drop non-positive; a zone more than 30 % from its symbol's `refPrice` → `uncertain = true` + warning; events with unparsable dates dropped with a warning.

- [ ] Failing tests in `tests/unit/analystExtract.test.ts` using a fixture shaped like the 2026-11-01 Nima Razzaghi summary (XAU sell 3940–3976, buy 3850–3865 uncertain, target 3740–3760, EUR/USD target "12400–12500" → flagged, unknown "Binance coin index" dropped). Plus `jsonSchemas`-style consistency check that `ANALYST_EXTRACT_JSON` keys match the zod schema.
- [ ] Implement; route `POST /api/analyst/extract` (body `{ text ≤ 20 000 chars }`, `enforceRateLimit(req, "ai")`, `aiJson({ feature: "analyst-extract", maxTokens: 2_000 })`) returns `PlanDraft` plus `feed: Record<symbol, lastPrice | null>` (last 5m close per symbol, for the offset column). Nothing stored.
- [ ] Commit `feat(analyst): extract zones from pasted analysis`.

### Task 4: Store + plan routes

**Produces (`lib/analyst/store.ts`):**
```ts
createPlan(userId, input: { source; title; rawText; events; offsets; expiresAt; zones: ZoneDraft[] }): Promise<PlanDto>   // DRAFT
updateZone(userId, zoneId, patch: Partial<ZoneDraft & { confirmed: boolean }>): Promise<ZoneDto>   // DRAFT plans only
updatePlan(userId, planId, patch: { source?; title?; events?; offsets?; expiresAt? }): Promise<PlanDto>
activatePlan(userId, planId, now): Promise<PlanDto>   // 400 if any uncertain zone is unconfirmed; sets lastCheckedAt = now on zones
archivePlan(userId, planId): Promise<void>
listPlans(userId): Promise<PlanDto[]>   // with zones + agreements
scorecard(userId): Promise<Array<{ source; zones; touched; respected; broke; unclear; untouched; targetsHit; targetsMissed }>>
```
Limits: 20 non-archived plans, 60 zones per plan. Routes: `GET/POST /api/analyst/plans`, `PATCH/DELETE /api/analyst/plans/[id]` (`{ action: "activate" | "archive" }` or field patch), `PATCH /api/analyst/zones/[id]`; all `adminRoute`.

- [ ] Failing DB tests (`tests/db/analystStore.test.ts`): owner isolation, activation blocked by an unconfirmed uncertain zone, edits refused once ACTIVE, limits, scorecard counts.
- [ ] Implement; `npm run test:db -- analystStore` passes.
- [ ] Commit `feat(analyst): plan store and routes`.

### Task 5: Worker job + messages

**Produces:** `lib/analyst/message.ts` → `zoneMessage(event, zone, plan, ctx): NewNotification`; `lib/analyst/job.ts` → `evaluateZones({ now, barsOf, bars1hOf, barsTfOf, telegram }): Promise<{ active: number; entered: number; broken: number; scored: number; errors: string[] }>`.

Per tick, for ACTIVE plans:
1. Plan past `expiresAt` → WAITING BUY/SELL → `EXPIRED` + outcome `UNTOUCHED`; WAITING TARGET → `MISSED`; plan → `ARCHIVED`. No message (the weekly summary is P18b).
2. WAITING BUY/SELL/TARGET: `zoneTouched` on 5m bars + live quote → state `ENTERED` (TARGET: `SCORED`, outcome `HIT`), one notification.
3. WAITING INVALIDATION: `closedBeyond` on `closeTf` bars → `BROKEN`, one notification, and every other WAITING zone of that symbol in the plan gets `note` "scenario invalidated" (still watched — the outcome data stays honest).
4. ENTERED BUY/SELL: `scoreReaction` on 1H bars → `SCORED` (no message).
5. Advance `lastCheckedAt` like `evaluateAlerts`.

Message (Persian, the owner's language), example:
```
🟥 XAU/USD وارد زون فروش ۳۹۴۰–۳۹۷۶ شد (Nima Razzaghi)
قیمت: 3,944 · هم‌نظر: تحلیل خودم
شرط ورود: فقط با تریگر در تایم پایین
ابطال: کلوز ۴ساعته بالای ۳۹۷۶
⚠️ ریسک خبر: NFP (جمعه ۸:۳۰ ET)
این فقط هشدار است؛ هیچ سفارشی ثبت نشده.
```
`href: "/admin/analyst"`. Notification type `"analyst_zone"` added to `NewNotification`.

- [ ] Failing tests: `tests/unit/analystMessage.test.ts` (each event, with/without consensus, event line, offset never shown as a fake price — the shown price is the analyst-basis price); `tests/db/analystJob.test.ts` with injected bars: enters once across two ticks, invalidation on closed 4H bar only, scoring after 24 h, expiry archives, DRAFT plans ignored, one symbol's candle error does not stop others.
- [ ] Implement; wire into `runTick()` after alerts (own try/catch, `TickResult.analyst`), 1H/4H via `getCandles` with the existing `marketMemo` cache.
- [ ] Commit `feat(analyst): watch active zones in the tick`.

### Task 6: Admin page

`/admin/analyst` (`requireAdmin`), linked in `AdminNav` as "Analyst Plans". Follows the P15 design tokens (`DESIGN.md`); RTL-safe for Persian notes (`dir="auto"` on free text).
- **Paste box:** source name (datalist of earlier sources), textarea, Extract.
- **Review table:** one row per zone — symbol, kind, low, high, condition, note, uncertain badge + Confirm checkbox; editable inline. Per-symbol strip: analyst ref price, feed price, offset input (prefilled `feed − ref` when both exist; amber warning on `=F` symbols with offset 0). Events list editable. Expiry date. Buttons: Save draft, Activate (disabled with a reason while uncertain zones are unconfirmed).
- **Active plans:** zones with state chips (Waiting / Entered / Broken / Scored · outcome), consensus chips, archive.
- **Scorecard:** per source — zones, touched %, respected / broke / unclear, targets hit / missed. Footnote: "n < 30 is not evidence."

- [ ] Build components with the existing `lib/client/resource.ts` pattern.
- [ ] Commit `feat(analyst): admin page`.

### Task 7: Verify and ship

- [ ] `npm run test:db`, `npx tsc --noEmit`, `npm run lint`, `npm run build` all clean.
- [ ] In the running app (preview `npm start -- -p 3001`): paste the 2026-11-01 summary → review → confirm uncertain rows → activate; run `POST /api/cron/tick` with a zone set around the current price → one notification, second tick no duplicate. Screenshot. Delete test data.
- [ ] `/impeccable audit` on the page; fix findings.
- [ ] Update `docs/HANDOFF.md` (P18a row), CHANGELOG; push `feat/p18a-analyst-plans`, open PR. Fly worker redeploy is needed after merge (tick changed).

## Not in P18a (P18b+)

Weekly Telegram summary per source; draft `TradeSignal` from a zone with one-tap Telegram confirm (only for a source with ≥ 30 scored zones and a positive edge vs random zones); external economic calendar; YouTube URL → transcript fetch.
