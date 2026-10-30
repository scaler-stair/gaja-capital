import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { BRAND } from "@/lib/brand";
import { GajaLogo, GajaMark } from "@/components/brand";
import { LoginForm } from "@/components/login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  let signedIn = false;
  try {
    signedIn = !!(await getCurrentUser());
  } catch {
    // Database not reachable yet; the form still renders and reports the problem on submit.
  }
  if (signedIn) redirect("/");

  return (
    <main className="grid min-h-screen grid-rows-[auto_1fr] lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:grid-rows-none">
      <section className="relative flex min-h-[15rem] flex-col overflow-hidden bg-navy px-6 pb-8 pt-7 sm:px-12 lg:min-h-screen lg:pb-14 lg:pt-12">
        <GajaLogo tone="dark" />
        <div className="relative z-10 mt-10 max-w-md lg:mt-auto lg:mb-[46vh]">
          <h1 className="font-serif text-[2.4rem] font-medium leading-[1.1] text-white sm:text-[3rem]">{BRAND.product}</h1>
          <p className="mt-4 text-base leading-relaxed text-white/70">{BRAND.productLine}</p>
        </div>
        {/* The mark at the scale of a building: five pillars rising from the foot of the panel. */}
        <GajaMark className="pointer-events-none absolute bottom-0 left-6 hidden h-[40vh] w-auto translate-y-[18%] text-gaja sm:left-12 lg:block" />
        <p className="relative z-10 mt-8 text-xs text-white/45 lg:hidden">{BRAND.legalName}</p>
      </section>

      <section className="flex flex-col justify-center bg-paper px-6 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <h2 className="font-serif text-[1.75rem] font-medium text-ink">Sign in</h2>
          <p className="mt-1.5 text-sm text-ink-2">Use the email address and password your administrator set up for you.</p>
          <LoginForm />
          <p className="mt-10 border-t border-rule pt-5 text-xs leading-relaxed text-muted">
            For authorised users of {BRAND.legalName}. Every sign-in is recorded. Forgotten your password? Ask the
            administrator to reset it.
          </p>
        </div>
      </section>
    </main>
  );
}
