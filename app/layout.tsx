import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans, Newsreader } from "next/font/google";
import { BRAND } from "@/lib/brand";
import "./globals.css";

const plex = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex",
  display: "swap",
});

/** Report and page titles: the board-paper voice. Everything else is IBM Plex Sans. */
const newsreader = Newsreader({
  subsets: ["latin"],
  variable: "--font-newsreader",
  display: "swap",
  axes: ["opsz"],
});

export const metadata: Metadata = {
  title: { default: `${BRAND.product} | ${BRAND.name}`, template: `%s | ${BRAND.name}` },
  description: BRAND.productLine,
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#171f2d",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={`${plex.variable} ${newsreader.variable}`}>
      <body>{children}</body>
    </html>
  );
}
