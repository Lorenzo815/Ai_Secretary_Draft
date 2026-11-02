import { Sidebar } from "@/components/sidebar";
import { requireOwner } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const email = await requireOwner();
  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <Sidebar owner={email} />
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-8 lg:py-8">{children}</main>
    </div>
  );
}
