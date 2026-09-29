import { NextResponse } from "next/server";
import { userIdRoute } from "@/lib/http/userRoute";
import { readJson } from "@/lib/http/errors";
import { JournalPatchInput } from "@/lib/db/inputs";
import { deleteJournalEntry, updateJournalEntry } from "@/lib/db/journal";

export const PATCH = userIdRoute(async (req, user, id) =>
  NextResponse.json({ entry: await updateJournalEntry(user.id, id, JournalPatchInput.parse(await readJson(req, 2_200_000))) }));

export const DELETE = userIdRoute(async (_req, user, id) => {
  await deleteJournalEntry(user.id, id);
  return new NextResponse(null, { status: 204 });
});
