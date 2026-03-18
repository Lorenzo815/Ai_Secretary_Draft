import Sidebar from "./_components/sidebar";
import Providers from "../providers";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Providers>
      <div className="flex min-h-screen bg-soft-ivory">
        <Sidebar />
        <main className="flex-1 overflow-y-auto pt-14">
          <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
            {children}
          </div>
        </main>
      </div>
    </Providers>
  );
}
