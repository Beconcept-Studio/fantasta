import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      /** Id interno della riga `users`, non l'id Google. */
      id?: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    /** Id interno della riga `users`. È l'unico stato applicativo nel token. */
    uid?: string;
    /** Nome dal profilo Google, solo per precompilare l'onboarding. */
    suggestedName?: string | null;
  }
}
