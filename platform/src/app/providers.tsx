"use client";

import { SessionProvider, signOut, useSession } from "next-auth/react";
import { useEffect } from "react";
import type { Session } from "next-auth";

function SessionGuard() {
  const { data: session, status } = useSession();
  useEffect(() => {
    if (status === "unauthenticated" || (status === "authenticated" && !session?.principal)) {
      void signOut({ callbackUrl: "/login" });
    }
  }, [status, session?.principal]);
  return null;
}

export default function Providers({ children, session }: { children: React.ReactNode; session: Session }) {
  return <SessionProvider session={session} refetchInterval={30} refetchOnWindowFocus refetchWhenOffline={false}><SessionGuard />{children}</SessionProvider>;
}
