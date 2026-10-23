import { ImageResponse } from "next/og";
import { ALL } from "@/fees/all";
import { SITE } from "@/lib/site";

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return [{ slug: "default" }, ...ALL.map((d) => ({ slug: d.slug }))];
}

/** 1200×630 share image: one floating card in an empty field, like the site itself. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const def = ALL.find((d) => d.slug === slug);
  const title = def ? `${def.name} Fee Calculator` : "Know what you keep before you sell";
  const line = def ? def.blurb : `Fee calculators for ${ALL.length}+ platforms, checked against official pages`;
  const checked = def ? `Rates checked ${new Date(`${def.verifiedAt}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : SITE.tagline;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#F2F3F0" }}>
        <div
          style={{
            width: 1040,
            height: 470,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            background: "#FFFFFF",
            borderRadius: 44,
            padding: "56px 64px",
            boxShadow: "0 40px 80px -40px rgba(15,20,18,0.25)",
            border: "1px solid rgba(15,20,18,0.07)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <svg width="52" height="52" viewBox="0 0 32 32">
              <path d="M12.5 6.2 22.4 24 2.6 24Z" fill="#0F1412" stroke="#0F1412" strokeWidth="3.2" strokeLinejoin="round" />
              <path d="M5.9 18 17.2 14.5" stroke="#FFFFFF" strokeWidth="1.7" strokeLinecap="round" />
              <path d="M17.2 14.5 29.6 10.4" stroke="#0D8A5D" strokeWidth="1.7" strokeLinecap="round" />
              <path d="M17.2 14.5 29.6 15" stroke="#E8A13A" strokeWidth="1.7" strokeLinecap="round" />
              <path d="M17.2 14.5 29.6 19.6" stroke="#EC5A3C" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
            <div style={{ fontSize: 34, fontWeight: 700, color: "#0F1412", letterSpacing: -1 }}>{SITE.name}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 76, lineHeight: 1.05, color: "#0F1412", letterSpacing: -2.5, fontWeight: 600 }}>{title}</div>
            <div style={{ fontSize: 32, marginTop: 18, color: "#66706B" }}>{line}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ display: "flex", height: 14, width: 420, borderRadius: 99, overflow: "hidden", gap: 4 }}>
              <div style={{ flexGrow: 74, background: "#0D8A5D", borderRadius: 99 }} />
              <div style={{ flexGrow: 14, background: "#EC5A3C", borderRadius: 99 }} />
              <div style={{ flexGrow: 9, background: "#E8A13A", borderRadius: 99 }} />
              <div style={{ flexGrow: 4, background: "#7A62FF", borderRadius: 99 }} />
            </div>
            <div style={{ fontSize: 24, color: "#66706B", marginLeft: 12 }}>{checked}</div>
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
