import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import LoginForm from "./login-form";
import { allows, pagePolicy } from "@/lib/access/policy";

type LoginPageProps = {
  searchParams: Promise<{
    callbackUrl?: string | string[];
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const callbackUrl = getSafeCallbackUrl(params.callbackUrl);
  const session = await getServerSession(authOptions);

  if (session?.principal) {
    redirect(allows(session.principal, pagePolicy(callbackUrl)) ? callbackUrl : "/dashboard/settings");
  }

  return <LoginForm callbackUrl={callbackUrl} />;
}

function getSafeCallbackUrl(value: string | string[] | undefined) {
  const callbackUrl = Array.isArray(value) ? value[0] : value;
  return callbackUrl?.startsWith("/dashboard") && !callbackUrl.includes("\\")
    ? callbackUrl
    : "/dashboard";
}
