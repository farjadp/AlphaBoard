import { revokeInvite } from "@/lib/auth/inviteStore";
import { audit } from "@/lib/auth/audit";
import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/http/userRoute";

/** Revoke an unused invite. */
export const DELETE = adminRoute(async (_req, admin, { params }) => {
  const { id } = await params;
  const revoked = await revokeInvite(id);
  if (revoked) await audit(admin.id, "admin.invite_revoked", { target: id });
  return NextResponse.json({ revoked });
});
