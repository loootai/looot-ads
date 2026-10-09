import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";
import { IS_DEMO } from "@/lib/clock";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "looot-ads", template: "%s · looot-ads" },
  description: "Open-source competitor ad board. Meta, Google, LinkedIn and TikTok ad libraries through looot, with the price shown before every run.",
  icons: { icon: "/brand/looot-mark.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7F8F5" },
    { media: "(prefers-color-scheme: dark)", color: "#0A1512" },
  ],
};

// Sets the theme class before the first paint. ?theme=dark or ?theme=light overrides the saved choice for one view.
const themeScript = `(function(){try{var q=new URLSearchParams(location.search).get("theme");var t=q||localStorage.getItem("theme")||"system";var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh bg-page text-ink">
        <header className="sticky top-0 z-10 border-b border-line bg-page/90 backdrop-blur">
          <div className="mx-auto flex h-12 max-w-[1320px] items-center gap-5 px-4">
            <Link href="/" className="flex items-center gap-2 font-semibold">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/looot-mark.svg" alt="" width={20} height={20} className="dark:hidden" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/looot-mark-white.svg" alt="" width={20} height={20} className="hidden dark:block" />
              <span className="text-14">looot-ads</span>
            </Link>
            <nav className="flex items-center gap-4 text-13 text-mute">
              <Link href="/" className="hover:text-ink">Board</Link>
              <Link href="/new" className="hover:text-ink">New pull</Link>
            </nav>
            <div className="ml-auto flex items-center gap-3">
              {IS_DEMO && <span className="rounded-control bg-amber-soft px-2 py-0.5 text-12 font-medium text-amber">Demo data, invented brands</span>}
              <ThemeToggle />
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-[1320px] px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
