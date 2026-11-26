import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";

export default function NotFoundPage() {
  return (
    <div className="min-h-screen bg-page">
      <AppHeader />
      <main className="app-container py-10 sm:py-14">
        <div className="ui-card max-w-lg p-6">
          <h1 className="text-base font-semibold text-ink">Page Not Found</h1>
          <p className="mt-1.5 text-sm text-ink-muted">
            The page you requested does not exist in GDArena.
          </p>
          <div className="mt-5 flex flex-wrap gap-2.5">
            <Link href="/" className="ui-btn-primary">
              Back to Home
            </Link>
            <Link href="/join" className="ui-btn-secondary">
              Join a Room
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
