"use client";

import { useEffect } from "react";
import { useResource } from "@/lib/client/resource";
import { DeviceCard } from "./DeviceCard";
import { SignalForm } from "./SignalForm";
import { SignalList } from "./SignalList";
import { devicesRes, signalsRes } from "./resources";

const SIGNALS_MS = 5_000;
const DEVICES_MS = 15_000;

export default function SignalDesk({ channelUsername, channelOn }: { channelUsername: string | null; channelOn: boolean }) {
  const devices = useResource(devicesRes);
  const signals = useResource(signalsRes);

  useEffect(() => {
    const a = setInterval(() => void signalsRes.load(true), SIGNALS_MS);
    const b = setInterval(() => void devicesRes.load(true), DEVICES_MS);
    return () => { clearInterval(a); clearInterval(b); };
  }, []);

  // The server checks a signal against the owner's most recently seen terminal; the form uses the same one.
  const terminal = [...devices.data].sort((x, y) => (y.lastSeenAt ?? "").localeCompare(x.lastSeenAt ?? ""))[0] ?? null;

  return (
    <div className="space-y-8">
      <div className="grid items-start gap-6 lg:grid-cols-[3fr_2fr]">
        <SignalForm terminal={terminal} channelOn={channelOn} />
        <DeviceCard devices={devices.data} error={devices.error} />
      </div>
      <SignalList signals={signals.data} error={signals.error} loaded={signals.loaded} channelUsername={channelUsername} />
    </div>
  );
}
