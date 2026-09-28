import Image from "next/image";
import Link from "next/link";
import AccessForm from "./AccessForm";

/* One icon family: 24px grid, 1.75 stroke, round caps. */
const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
const ICONS = {
  read: "M3 12h3l3-7 4 14 3-7h5",
  decide: "M5 12l4 4L19 6",
  practise: "M4 19V5m0 14h16M8 15l3-4 3 2 5-6",
  measure: "M12 3a9 9 0 1 0 9 9M12 3v9h9",
};

const STEPS: Array<{ key: keyof typeof ICONS; verb: string; title: string; body: string; facts: string[] }> = [
  {
    key: "read", verb: "Read", title: "Every timeframe on one screen",
    body: "Trend and momentum from 5-minute to weekly candles side by side, so you see at a glance whether the timeframes agree. Candlestick and chart patterns, futures funding and positioning, and the day's news sit next to the chart.",
    facts: ["Crypto, gold, indices and forex", "Missing data shows as “Unavailable”, never a guess"],
  },
  {
    key: "decide", verb: "Decide", title: "A plan, or a reason not to trade",
    body: "One click asks the AI model you choose for a plan built from live data the server gathers itself: entry, stop, target, sizing and the reasoning behind them. When the timeframes disagree, the answer can simply be: stay flat.",
    facts: ["OpenAI, Claude, OpenRouter or DeepSeek", "Stop and target checked for the right side before you see them"],
  },
  {
    key: "practise", verb: "Practise", title: "Rehearse it with paper money",
    body: "Send the plan to a paper account and let it run. Stops and targets are checked every minute against candle highs and lows, even with the tab closed, and you get a notification when one is hit.",
    facts: ["10,000 USDT to start, leverage up to 20×", "0.05% slippage and a 0.05% fee on every fill"],
  },
  {
    key: "measure", verb: "Measure", title: "Every call graded afterwards",
    body: "Each signal is replayed on the candles that followed it: did price reach the target or the stop first? You see win rate, expectancy in R, profit factor and drawdown, by model, asset and timeframe.",
    facts: ["Calibration: does 80% confidence really win more?", "Conservative: stop and target in one candle count as a stop"],
  },
];

export default function Landing() {
  return (
    <div className="bg-page text-ink">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-5 md:px-8">
        <Link href="/" className="flex items-center gap-2 font-display text-[19px] font-extrabold">
          <svg width="22" height="22" viewBox="0 0 20 20" aria-hidden="true">
            <rect width="20" height="20" rx="5" className="fill-ink" />
            <path d="M4 14 L8 9 L11 11.5 L16 5" className="stroke-paper" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          AlphaBoard
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1 text-sm font-semibold text-ink-2 md:gap-2">
          <a href="#how" className="hidden rounded-lg px-3 py-2 hover:text-ink sm:block">How it works</a>
          <a href="#honest" className="hidden rounded-lg px-3 py-2 hover:text-ink sm:block">Principles</a>
          <Link href="/login" className="whitespace-nowrap rounded-lg px-2.5 py-2 hover:text-ink sm:px-3">Sign in</Link>
          <a href="#access" className="whitespace-nowrap rounded-lg bg-ink px-3 py-2 text-paper hover:bg-[#23313f] sm:px-4">Request access</a>
        </nav>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-5 pb-10 pt-10 md:px-8 md:pt-20">
          <h1 className="max-w-4xl text-balance font-display text-[2.6rem] font-extrabold leading-[1.02] tracking-[-0.03em] md:text-7xl">
            Know when to trade, and when to <span className="text-accent">stay flat.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-ink-2 md:text-xl">
            AlphaBoard reads live markets across six timeframes, drafts a plan with the AI model you choose, lets you rehearse it
            with paper money, then grades every call against what price actually did next.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a href="#access" className="rounded-lg bg-ink px-5 py-3 text-[15px] font-bold text-paper hover:bg-[#23313f]">Request an invite</a>
            <Link href="/login" className="rounded-lg border border-line-2 bg-paper px-5 py-3 text-[15px] font-bold text-ink hover:border-ink-3">Sign in</Link>
            <span className="text-sm text-ink-3">Invite-only · analysis and paper trading, never real orders</span>
          </div>
        </section>

        <figure className="landing-rise mx-auto max-w-7xl px-3 md:px-8">
          <div className="overflow-hidden rounded-2xl border border-line-2 bg-paper shadow-[0_24px_60px_-20px_rgba(21,32,43,0.28)]">
            <Image
              src="/landing/ticket.webp" alt="AlphaBoard's AI trade ticket for BTC/USDT on 1H reading “Stay flat. No clean setup on 1H.” with the reasoning: higher timeframes bullish, 4H, 15M and 5M bearish."
              width={860} height={830} priority sizes="100vw" className="h-auto w-full sm:hidden"
            />
            <Image
              src="/landing/market.webp" alt="The AlphaBoard market screen for BTC/USDT: a 1-hour candlestick chart, a timeframe agreement row from weekly to 5-minute, and an AI plan that reads “Stay flat. No clean setup on 1H.”"
              width={2880} height={1690} priority sizes="(min-width: 1280px) 1216px, 100vw" className="hidden h-auto w-full sm:block"
            />
          </div>
          <figcaption className="mx-auto mt-3 max-w-3xl px-2 text-center text-sm text-ink-3">
            The real market screen on 28 September 2026<span className="sm:hidden"> (trade ticket shown)</span>. Two timeframes pointed up and three down, so the model&apos;s plan was to do nothing.
          </figcaption>
        </figure>

        <section id="how" aria-labelledby="how-title" className="mx-auto max-w-6xl scroll-mt-6 px-5 pb-8 pt-24 md:px-8 md:pt-32">
          <h2 id="how-title" className="max-w-3xl text-balance font-display text-4xl font-extrabold tracking-[-0.02em] md:text-5xl">
            One loop, from reading the market to checking your judgement.
          </h2>
          <ol className="mt-12 divide-y divide-line border-y border-line">
            {STEPS.map((s) => (
              <li key={s.key} className="grid gap-4 py-9 md:grid-cols-[220px_1fr_300px] md:gap-10">
                <div className="flex items-center gap-3 md:items-start">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ink text-paper"><Icon d={ICONS[s.key]} /></span>
                  <span className="font-display text-3xl font-extrabold tracking-[-0.02em]">{s.verb}</span>
                </div>
                <div className="max-w-[62ch]">
                  <h3 className="text-lg font-bold">{s.title}</h3>
                  <p className="mt-2 text-[15.5px] leading-relaxed text-ink-2">{s.body}</p>
                </div>
                <ul className="space-y-2 self-center text-sm text-ink-2">
                  {s.facts.map((f) => (
                    <li key={f} className="flex gap-2.5">
                      <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                      {f}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
          <p className="mt-6 text-sm text-ink-3">Also inside: a trade journal with AI post-mortems, a chart-reading academy, and price alerts in the app or on Telegram.</p>
        </section>

        <section id="honest" aria-labelledby="honest-title" className="mt-16 scroll-mt-6 bg-ink text-paper">
          <div className="mx-auto grid max-w-6xl gap-12 px-5 py-20 md:grid-cols-[1fr_1.2fr] md:px-8 md:py-28">
            <div>
              <h2 id="honest-title" className="text-balance font-display text-4xl font-extrabold tracking-[-0.02em] md:text-5xl">Built to be believed, not to impress.</h2>
              <p className="mt-5 max-w-md text-[15.5px] leading-relaxed text-[#c3ccd6]">
                A trading tool that flatters you is worse than none. These rules are in the code, not just on this page.
              </p>
            </div>
            <dl className="grid gap-x-10 gap-y-9 sm:grid-cols-2">
              {[
                ["No invented numbers", "If a price, a funding rate or a candle is missing, you see “Unavailable”. Nothing is filled in to make a screen look complete."],
                ["Scored against you", "When a stop and a target fall inside the same candle, the signal counts as a loss. A gap through the stop exits at the worse price."],
                ["Costs included", "Every paper fill pays slippage and a taker fee on both the way in and the way out."],
                ["You make the call", "AlphaBoard is analysis and practice. It never places real orders and it is not financial advice."],
              ].map(([t, d]) => (
                <div key={t}>
                  <dt className="text-lg font-bold">{t}</dt>
                  <dd className="mt-2 text-[15px] leading-relaxed text-[#c3ccd6]">{d}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section id="access" aria-labelledby="access-title" className="mx-auto grid max-w-6xl scroll-mt-6 gap-12 px-5 py-24 md:grid-cols-[1fr_440px] md:px-8 md:py-32">
          <div>
            <h2 id="access-title" className="text-balance font-display text-4xl font-extrabold tracking-[-0.02em] md:text-5xl">Invite-only, for now.</h2>
            <p className="mt-5 max-w-lg text-[15.5px] leading-relaxed text-ink-2">
              AlphaBoard is opening to a small group of traders first. Leave your email and tell us what you trade. When there is a place, you&apos;ll receive a personal invite link.
            </p>
            <p className="mt-6 text-sm text-ink-3">Already invited? <Link href="/login" className="font-semibold text-ink underline underline-offset-2">Sign in</Link> or open the link from your invite.</p>
          </div>
          <div className="rounded-2xl border border-line bg-paper p-6 md:p-8">
            <AccessForm />
          </div>
        </section>
      </main>
    </div>
  );
}
