import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";

export default function NotFoundPage() {
  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader />
      <main className="mx-auto max-w-lg px-4 py-16">
        <div className="rounded-md border border-slate-200 bg-white p-6">
          <h1 className="text-base font-semibold text-slate-900">
            Page Not Found
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            The page you requested does not exist in GDArena.
          </p>
          <div className="mt-4 flex flex-wrap gap-2.5">
            <Link
              href="/"
              className="rounded bg-blue-800 px-4 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-blue-900"
            >
              Back to Home
            </Link>
            <Link
              href="/join"
              className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Join a Room
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}

