"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const LINKS = [
  { href: "/", label: "Matches" },
  { href: "/standings", label: "Standings" },
  { href: "/scorers", label: "Top Scorers" },
  { href: "/predictions", label: "Predict Scores" },
  { href: "/leaderboard", label: "Leaderboard" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}

export default function Nav() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="border-b border-neutral-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-bold" onClick={() => setMenuOpen(false)}>
          <span className="rounded bg-pitch px-2 py-1 text-sm text-gold">WC26</span>
          <span className="hidden sm:inline">Prediction Dashboard</span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden gap-1 text-sm font-medium text-neutral-600 sm:flex">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`rounded-lg px-3 py-1.5 transition ${
                isActive(pathname, link.href)
                  ? "bg-pitch text-gold"
                  : "hover:bg-neutral-100 hover:text-pitch"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Mobile hamburger */}
        <button
          className="flex flex-col gap-1.5 p-1 sm:hidden"
          aria-label="Toggle menu"
          onClick={() => setMenuOpen((o) => !o)}
        >
          <span className={`block h-0.5 w-5 bg-neutral-600 transition-all ${menuOpen ? "translate-y-2 rotate-45" : ""}`} />
          <span className={`block h-0.5 w-5 bg-neutral-600 transition-all ${menuOpen ? "opacity-0" : ""}`} />
          <span className={`block h-0.5 w-5 bg-neutral-600 transition-all ${menuOpen ? "-translate-y-2 -rotate-45" : ""}`} />
        </button>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <nav className="border-t border-neutral-100 px-4 py-2 sm:hidden">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMenuOpen(false)}
              className={`block rounded-lg px-3 py-2 text-sm font-medium transition ${
                isActive(pathname, link.href)
                  ? "bg-pitch text-gold"
                  : "text-neutral-600 hover:bg-neutral-50 hover:text-pitch"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
