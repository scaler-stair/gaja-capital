import Link from "next/link";
import { GajaLogo } from "@/components/brand";
import { button } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-paper px-6 text-center">
      <GajaLogo />
      <div>
        <h1 className="font-serif text-2xl font-medium text-ink">That page is not here</h1>
        <p className="mt-2 text-sm text-ink-2">The report or page may have been removed, or the link is incomplete.</p>
      </div>
      <Link href="/" className={button.primary}>
        Back to the overview
      </Link>
    </main>
  );
}
