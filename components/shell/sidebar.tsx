"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  FileText,
  KeyRound,
  Layers,
  LayoutGrid,
  ListChecks,
  LogOut,
  Menu,
  MessageSquareText,
  Users,
  X,
} from "lucide-react";
import { GajaLogo } from "@/components/brand";
import { BRAND } from "@/lib/brand";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutGrid },
  { href: "/reports", label: "Board reports", icon: FileText },
  { href: "/observations", label: "Observations", icon: ListChecks },
  { href: "/compile", label: "Compare and compile", icon: Layers },
  { href: "/assistant", label: "AI assistant", icon: MessageSquareText },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({ name, designation, isSuperAdmin }: { name: string; designation: string | null; isSuperAdmin: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const items = isSuperAdmin ? [...NAV, { href: "/admin", label: "Users and access", icon: Users }] : NAV;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const nav = (
    <nav className="flex flex-1 flex-col gap-0.5 px-3" aria-label="Main">
      {items.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            onClick={() => setOpen(false)}
            aria-current={active ? "page" : undefined}
            className={`relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-[0.9rem] transition-colors ${
              active ? "bg-white/[0.08] font-medium text-white" : "text-white/65 hover:bg-white/[0.05] hover:text-white"
            }`}
          >
            {active && <span className="absolute inset-y-2 left-0 w-[3px] rounded-r bg-gaja" aria-hidden />}
            <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );

  const footer = (
    <div className="border-t border-white/10 px-3 py-4">
      <div className="px-3 pb-3">
        <div className="truncate text-sm font-medium text-white">{name}</div>
        <div className="truncate text-xs text-white/55">{designation || (isSuperAdmin ? "Super admin" : "Member")}</div>
      </div>
      <Link
        href="/account"
        onClick={() => setOpen(false)}
        className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
          isActive(pathname, "/account") ? "bg-white/[0.08] text-white" : "text-white/65 hover:bg-white/[0.05] hover:text-white"
        }`}
      >
        <KeyRound className="h-4 w-4" aria-hidden />
        Password
      </Link>
      <button
        type="button"
        onClick={signOut}
        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-white/65 transition-colors hover:bg-white/[0.05] hover:text-white"
      >
        <LogOut className="h-4 w-4" aria-hidden />
        Sign out
      </button>
    </div>
  );

  const brand = (
    <div className="px-6 pb-7 pt-7">
      <Link href="/" onClick={() => setOpen(false)} className="block">
        <GajaLogo tone="dark" />
      </Link>
      <div className="mt-3 text-[0.8rem] tracking-wide text-white/50">{BRAND.product}</div>
    </div>
  );

  return (
    <>
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-navy lg:flex">
        {brand}
        {nav}
        {footer}
      </aside>

      <div className="no-print sticky top-0 z-30 flex h-14 items-center justify-between bg-navy px-4 lg:hidden">
        <Link href="/">
          <GajaLogo tone="dark" />
        </Link>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md p-2 text-white/80 hover:bg-white/10"
          aria-label="Open menu"
          aria-expanded={open}
        >
          <Menu className="h-5 w-5" />
        </button>
      </div>

      {open && (
        <div className="no-print fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-navy/50" onClick={() => setOpen(false)} aria-hidden />
          <aside className="slide-in absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-navy">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute right-3 top-3 rounded-md p-2 text-white/70 hover:bg-white/10"
              aria-label="Close menu"
            >
              <X className="h-5 w-5" />
            </button>
            {brand}
            {nav}
            {footer}
          </aside>
        </div>
      )}
    </>
  );
}
