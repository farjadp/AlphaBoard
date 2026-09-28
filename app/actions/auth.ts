"use server";

import { headers } from "next/headers";
import { AuthError } from "next-auth";
import { signIn, signOut } from "@/auth";
import { limiters } from "@/lib/http/rateLimit";

export async function authenticate(_prev: string | undefined, formData: FormData): Promise<string | undefined> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "unknown";
  const rl = limiters.auth.check(ip);
  if (!rl.allowed) return `Too many attempts. Try again in ${Math.ceil(rl.retryAfterMs / 60_000)} min.`;

  try {
    await signIn("credentials", {
      email: String(formData.get("email") ?? "").trim().toLowerCase(),
      password: String(formData.get("password") ?? ""),
      redirectTo: "/market",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return error.type === "CredentialsSignin" ? "Invalid email or password." : "Sign-in failed. Please try again.";
    }
    throw error; // NEXT_REDIRECT must propagate
  }
}

/** Ends the session. The client follows up with a full page load so no cached user data survives. */
export async function signOutAction(): Promise<void> {
  await signOut({ redirect: false });
}
