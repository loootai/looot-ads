import { createHash } from "node:crypto";

/** Generated stand-in for a creative in the demo. The text is the brand and headline; nothing real is drawn. */
export async function GET(_req: Request, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  const [brand = "", headline = ""] = name.replace(/\.svg$/, "").split("|");
  const h = parseInt(createHash("sha1").update(brand).digest("hex").slice(0, 6), 16);
  const hue = 130 + (h % 60);
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
  const words = headline.split(" ");
  const lines: string[] = [];
  for (const w of words) {
    const last = lines[lines.length - 1];
    if (last && (last + " " + w).length <= 22) lines[lines.length - 1] = `${last} ${w}`;
    else lines.push(w);
  }
  const text = lines.slice(0, 4).map((l, i) => `<text x="28" y="${150 + i * 34}" font-family="system-ui,sans-serif" font-size="26" font-weight="700" fill="#fff">${esc(l)}</text>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 55% 22%)"/><stop offset="1" stop-color="hsl(${hue + 25} 60% 34%)"/></linearGradient></defs><rect width="400" height="300" fill="url(#g)"/><text x="28" y="52" font-family="system-ui,sans-serif" font-size="15" letter-spacing="2" fill="#bfe9d4">${esc(brand.toUpperCase())}</text>${text}<text x="28" y="282" font-family="system-ui,sans-serif" font-size="11" fill="#9fd4bb">generated placeholder, not a real ad</text></svg>`;
  return new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=3600" } });
}
