import { requireUser } from "@/lib/auth";
import { Sidebar } from "@/components/shell/sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="min-h-screen">
      <Sidebar name={user.name} designation={user.designation} isSuperAdmin={user.role === "super_admin"} />
      <main className="lg:pl-64">
        <div className="mx-auto w-full max-w-[1240px] px-4 py-8 sm:px-8 lg:py-10">{children}</div>
      </main>
    </div>
  );
}
