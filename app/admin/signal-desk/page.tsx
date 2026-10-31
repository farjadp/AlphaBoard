import { env } from "@/lib/env";
import { requireAdmin } from "@/lib/auth/dal";
import SignalDesk from "@/components/admin/signals/SignalDesk";

export const dynamic = "force-dynamic";
export const metadata = { title: "Signal Desk" };

export default async function SignalDeskPage() {
  await requireAdmin();
  const channel = env().SIGNAL_CHANNEL_USERNAME ?? null;
  const channelOn = !!(env().SIGNAL_BOT_TOKEN && env().SIGNAL_CHANNEL_ID);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">Signal Desk</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-2">
          Write a trade once. It goes to your Telegram channel and to the SignalCopier expert in MetaTrader 5, which opens one position per target with the stop and targets set at the broker.
        </p>
      </div>
      <SignalDesk channelUsername={channel} channelOn={channelOn} />
    </div>
  );
}
