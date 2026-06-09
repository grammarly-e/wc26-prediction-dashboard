import Link from "next/link";

const LINKS = [
  { href: "/", label: "Matches" },
  { href: "/standings", label: "Standings" },
  { href: "/scorers", label: "Top Scorers" },
  { href: "/predictions", label: "Predict Scores" },
  { href: "/leaderboard", label: "Leaderboard" },
];

export default function Nav() {
  return (
    <header className="border-b border-neutral-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-bold">
          <span className="rounded bg-pitch px-2 py-1 text-sm text-gold">WC26</span>
          <span>Prediction Dashboard</span>
        </Link>
        <nav className="flex gap-4 text-sm font-medium text-neutral-600">
          {LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="transition hover:text-pitch">
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
