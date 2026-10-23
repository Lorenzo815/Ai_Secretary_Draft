import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { findUserByEmail } from "@/lib/users";
import { loadIdentity, resolveToken, sessionFingerprint } from "@/lib/access/session";
import { sessionCookie } from "@/lib/access/cookies";

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET,
  useSecureCookies: sessionCookie().options.secure,
  cookies: { sessionToken: sessionCookie() },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const user = await findUserByEmail(credentials.email);
        if (!user) {
          // Use constant-time compare even when user not found to prevent timing attacks
          await compare(credentials.password, "$2a$12$invalidhashpaddingtoresist");
          return null;
        }

        const identity = await loadIdentity(user._id.toHexString());
        const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
        if (!identity || !secret || identity.user.email !== user.email) return null;
        const isValid = await compare(credentials.password, identity.user.passwordHash);
        if (!isValid) {
          return null;
        }

        return {
          id: user._id.toString(),
          email: identity.user.email,
          name: identity.user.name,
          accessFingerprint: sessionFingerprint(identity.user, secret),
        };
      },
    }),
  ],

  session: {
    strategy: "jwt",
    maxAge: 24 * 60 * 60, // 24 hours
  },

  pages: {
    signIn: "/login",
  },

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.accessFingerprint = user.accessFingerprint;
      }
      const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
      const principal = secret ? await resolveToken(token, secret) : null;
      token.principal = principal;
      return token;
    },
    async session({ session, token }) {
      session.principal = token.principal ?? null;
      session.user.id = token.principal?.id ?? "";
      session.user.email = token.principal?.email ?? "";
      session.user.name = token.principal?.name ?? "";
      return session;
    },
  },
};
