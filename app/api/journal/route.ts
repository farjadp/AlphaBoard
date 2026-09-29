import { NextResponse } from "next/server";
import { userRoute } from "@/lib/http/userRoute";
import { readJson } from "@/lib/http/errors";
import { JournalCreateInput } from "@/lib/db/inputs";
import { clearJournal, createJournalEntry, listJournal } from "@/lib/db/journal";

export const dynamic = "force-dynamic";

export const GET = userRoute(async (_req, user) => NextResponse.json({ entries: await listJournal(user.id) }));

export const POST = userRoute(async (req, user) =>
  NextResponse.json({ entry: await createJournalEntry(user.id, JournalCreateInput.parse(await readJson(req, 16_000))) }, { status: 201 }));

export const DELETE = userRoute(async (_req, user) => {
  await clearJournal(user.id);
  return new NextResponse(null, { status: 204 });
});
