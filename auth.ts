import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { authConfig } from "./auth.config";
import { prisma } from "./lib/prisma";

const credentialsSchema = z.object({
  email: z.string().email().transform((s) => s.trim().toLowerCase()),
  password: z.string().min(8).max(200),
});

export const { handlers, auth, signIn, signOut, unstable_update } = NextAuth({
  ...authConfig,
  session: { strategy: "jwt", maxAge: 7 * 24 * 3600 },
  callbacks: {
    ...authConfig.callbacks,
    // Node-only extension of the edge-safe callback: on a session update, re-read the disclaimer from
    // the DB. Client-supplied update data is ignored, so the claim cannot be set from the browser.
    async jwt(params) {
      const token = await authConfig.callbacks.jwt(params);
      if (params.trigger === "update" && token.sub) {
        const u = await prisma.user.findUnique({ where: { id: token.sub }, select: { disclaimerAcceptedAt: true } });
        token.disclaimer = !!u?.disclaimerAcceptedAt;
      }
      return token;
    },
  },
  providers: [
    Credentials({
      async authorize(credentials) {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        const user = await prisma.user.findUnique({ where: { email } });
        // Constant-ish time: still run bcrypt against a dummy hash when the user is missing.
        const hash = user?.passwordHash ?? "$2a$12$CwTycUXWue0Thq9StjUM0uJ8Z0v1Zk1WQKZbz0eYJmQ6pR1yJ9pQO";
        const ok = await bcrypt.compare(password, hash);
        if (!user || !ok) return null;

        return { id: user.id, name: user.name, email: user.email, role: user.role, disclaimer: !!user.disclaimerAcceptedAt };
      },
    }),
  ],
});
