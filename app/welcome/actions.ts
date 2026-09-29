"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { unstable_update } from "@/auth";
import { requireUser } from "@/lib/auth/dal";
import { acceptDisclaimer } from "@/lib/legal/accept";
import { safeNext } from "@/lib/legal/gate";

export async function acceptDisclaimerAction(_prev: string | undefined, formData: FormData): Promise<string | undefined> {
  const user = await requireUser();
  if (formData.get("understood") !== "on") return "Please tick the box to confirm you have read and understood the disclaimer.";
  const h = await headers();
  await acceptDisclaimer(user.id, h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined);
  // Re-issue the session cookie; the jwt callback re-reads the acceptance from the database.
  await unstable_update({});
  redirect(safeNext(String(formData.get("next") ?? "")));
}
