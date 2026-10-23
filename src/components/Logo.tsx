import Link from "next/link";
import { SITE } from "@/lib/site";

/**
 * The mark: a prism. One beam goes in, the spectrum comes out: a sale split into where every
 * cent goes. Built on a 32 grid; solid in one color it still reads at 16 px (favicon), and the
 * three exit rays are the only place the spectrum appears in the brand.
 */
export function Mark({ size = 28, mono = false }: { size?: number; mono?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden focusable="false">
      <path d="M12.5 6.2 22.4 24 2.6 24Z" fill="currentColor" stroke="currentColor" strokeWidth="3.2" strokeLinejoin="round" />
      <path d="M5.9 18 17.2 14.5" stroke="var(--card)" strokeWidth="1.7" strokeLinecap="round" />
      {!mono && (
        <>
          <path d="M17.2 14.5 29.6 10.4" stroke="var(--keep)" strokeWidth="1.7" strokeLinecap="round" />
          <path d="M17.2 14.5 29.6 15" stroke="var(--payment)" strokeWidth="1.7" strokeLinecap="round" />
          <path d="M17.2 14.5 29.6 19.6" stroke="var(--platform)" strokeWidth="1.7" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="inline-flex min-h-[44px] items-center gap-2 rounded-full pl-2 pr-3 text-ink" aria-label={`${SITE.name} home`}>
      <Mark />
      {!compact && <span className="text-[1.08rem] font-[640] tracking-[-0.02em]">{SITE.name}</span>}
    </Link>
  );
}
