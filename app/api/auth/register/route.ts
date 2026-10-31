import { NextResponse } from "next/server";
import { z } from "zod";
import { route } from "@/lib/http/route";
import { readJson, tooManyRequests } from "@/lib/http/errors";
import { clientIp, limiters } from "@/lib/http/rateLimit";
import { registerWithInvite } from "@/lib/auth/register";

const registerSchema = z.object({
  token: z.string().min(20).max(200),
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(80),
  email: z.string().email("Invalid email format").transform((s) => s.trim().toLowerCase()),
  password: z.string().min(10, "Password must be at least 10 characters").max(200),
});

/** Invite-only registration. The invite token is single-use and may be bound to an email. */
export const POST = route(async (req) => {
  const rl = limiters.auth.check(clientIp(req));
  if (!rl.allowed) throw tooManyRequests(rl.retryAfterMs);

  const body = await readJson(req, 10_000);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", code: "VALIDATION", errors: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const { token, name, email, password } = parsed.data;

  const user = await registerWithInvite({ token, name, email, password }, clientIp(req));

  return NextResponse.json({ message: "Account created", user }, { status: 201 });
});
