import type { Metadata } from "next";

export const metadata: Metadata = { title: "Owner sign-in", robots: { index: false, follow: false } };

export default async function AdminLogin({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const sp = await searchParams;
  const next = sp.next?.startsWith("/admin") ? sp.next : "/admin";
  return (
    <div className="mx-auto max-w-sm px-3 py-24">
      <form method="post" action="/api/admin/login" className="float p-7">
        <h1 className="display text-[2rem] text-ink">Back office</h1>
        <p className="mt-2 text-[0.92rem] text-ink-3">For the site owner only.</p>
        <input type="hidden" name="next" value={next} />
        <label htmlFor="pw" className="mt-6 block text-[0.86rem] font-[560] text-ink-2">
          Password
        </label>
        <div className="field mt-1.5">
          <input id="pw" name="password" type="password" autoComplete="current-password" required className="!text-[1rem]" />
        </div>
        {sp.error && <p className="mt-3 text-[0.88rem] text-bad">That password didn’t match.</p>}
        <button type="submit" className="btn btn-ink mt-5 w-full">
          Sign in
        </button>
      </form>
    </div>
  );
}
