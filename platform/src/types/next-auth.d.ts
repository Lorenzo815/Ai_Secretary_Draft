import "next-auth";
import type { Principal } from "@/lib/access/contracts";

declare module "next-auth" {
  interface Session {
    principal: Principal | null;
    user: {
      id: string;
      email: string;
      name: string;
    };
  }

  interface User {
    id: string;
    email: string;
    name: string;
    accessFingerprint: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    accessFingerprint?: string;
    principal?: Principal | null;
  }
}
