import type { Metadata } from "next";
import Link from "next/link";
import { applicationsRepo } from "@/lib/db";
import { listPendingStories } from "@/lib/pipeline/stories";
import "./globals.css";

export const metadata: Metadata = { title: "Job Search Assistant" };
export const dynamic = "force-dynamic";

function counts() {
  try {
    return {
      review: applicationsRepo.byStatus("prefilled", "needs_manual").length,
      stories: listPendingStories().length,
    };
  } catch {
    return { review: 0, stories: 0 };
  }
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const c = counts();
  return (
    <html lang="en">
      <body>
        <nav>
          <span className="brand">Job Search Assistant</span>
          <Link href="/">Jobs</Link>
          <Link href="/review">
            Review{c.review > 0 && <span className="badge">{c.review}</span>}
          </Link>
          <Link href="/stories">
            Stories{c.stories > 0 && <span className="badge">{c.stories}</span>}
          </Link>
          <Link href="/tracker">Tracker</Link>
          <Link href="/settings">Settings</Link>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
