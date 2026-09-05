import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import Sidebar from "./_components/sidebar";
import Providers from "../providers";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login?callbackUrl=%2Fdashboard");

  return (
    <Providers>
      <div className="app-canvas flex h-screen overflow-hidden">
        <Sidebar />
        <main className="h-screen min-w-0 flex-1 overflow-y-auto pt-14">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
            {children}
          </div>
        </main>
      </div>
    </Providers>
  );
}
