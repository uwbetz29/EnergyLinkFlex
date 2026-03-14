import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { getDb } from "@/lib/db";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const sql = getDb();
        const rows = await sql`
          SELECT id, email, display_name, avatar_url, password_hash, system_role
          FROM user_profiles
          WHERE email = ${credentials.email as string}
        `;

        const user = rows[0];
        if (!user?.password_hash) return null;

        const valid = await bcrypt.compare(
          credentials.password as string,
          user.password_hash as string
        );
        if (!valid) return null;

        return {
          id: user.id as string,
          email: user.email as string,
          name: user.display_name as string,
          image: user.avatar_url as string | null,
        };
      },
    }),
  ],
  callbacks: {
    authorized({ auth: session, request: { nextUrl } }) {
      const isLoggedIn = !!session?.user;
      const isPublic = ["/login", "/auth/reset-password", "/auth/update-password"].some(
        (p) => nextUrl.pathname.startsWith(p)
      );
      if (isPublic) return true;
      if (!isLoggedIn) return false; // Redirects to signIn page
      return true;
    },
    async signIn({ user, account }) {
      if (account?.provider === "google" && user.email) {
        const sql = getDb();
        // Upsert profile for Google users
        await sql`
          INSERT INTO user_profiles (id, email, display_name, avatar_url, provider)
          VALUES (${user.id!}, ${user.email}, ${user.name || user.email.split("@")[0]}, ${user.image || null}, 'google')
          ON CONFLICT (email) DO UPDATE SET
            display_name = COALESCE(EXCLUDED.display_name, user_profiles.display_name),
            avatar_url = COALESCE(EXCLUDED.avatar_url, user_profiles.avatar_url),
            provider = 'google',
            updated_at = now()
        `;
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      // Look up the DB id for Google users (whose NextAuth id != our DB id)
      if (token.email && !token.dbId) {
        const sql = getDb();
        const rows = await sql`
          SELECT id, system_role FROM user_profiles WHERE email = ${token.email}
        `;
        if (rows[0]) {
          token.dbId = rows[0].id as string;
          token.role = rows[0].system_role as string;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token.dbId) {
        session.user.id = token.dbId as string;
      } else if (token.id) {
        session.user.id = token.id as string;
      }
      (session.user as unknown as Record<string, unknown>).role = token.role || "member";
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
});
