import Link from "next/link";
import { Home, Search } from "lucide-react";

const CARD_MAIN = "rounded-3xl bg-[#B8D4F5] p-6 shadow-soft";

const BTN_PRIMARY =
  "btn-elevated flex w-full items-center justify-center gap-2 rounded-2xl bg-[#4F5FE8] px-5 py-4 text-base font-bold text-white transition-transform active:scale-[0.98]";

export default function GlobalNotFound() {
  return (
    <html lang="en">
      <body className="bg-[#7BA8F0] text-[#1A1F36]">
        <main className="mx-auto flex min-h-screen w-full max-w-md items-center justify-center px-4 py-6">
          <section className={CARD_MAIN + " w-full"}>
            <div className="flex flex-col items-center text-center">
              <span className="flex h-20 w-20 items-center justify-center rounded-full bg-white shadow-soft">
                <Search className="h-10 w-10 text-[#4F5FE8]" />
              </span>

              <p className="mt-5 text-5xl font-bold tracking-tight text-[#4F5FE8]">
                404
              </p>

              <h1 className="mt-3 text-xl font-bold text-[#1A1F36]">
                Page not found
              </h1>

              <p className="mt-2 max-w-xs text-sm font-medium leading-7 text-[#1A1F36]/70">
                The page you are looking for does not exist or has been moved.
              </p>

              <Link href="/en" className={BTN_PRIMARY + " mt-6"}>
                <Home className="h-5 w-5" />
                Back to home
              </Link>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
