import { buildReport } from "@/lib/runner";
import { DEMO_TODAY } from "@/lib/clock";
import type { Ad, AdFormat, Competitor, Platform, Report, SourceRun } from "@/lib/types";

/** Invented brands. None of them exists. The domains use the reserved .example suffix. */
export const DEMO_COMPETITORS: Competitor[] = [
  { id: "brightloop-example", name: "Brightloop", domain: "brightloop.example" },
  { id: "pelicanpay-example", name: "Pelican Pay", domain: "pelicanpay.example" },
  { id: "quillbase-example", name: "Quillbase", domain: "quillbase.example" },
];

type Row = [platform: Platform, format: AdFormat, headline: string, body: string, cta: string, startedDaysAgo: number, lastDaysAgo: number | null, path: string];

const COPY: Record<string, Row[]> = {
  "brightloop-example": [
    ["meta", "video", "Invoices that chase themselves", "Brightloop sends the reminder, logs the reply and marks it paid. Set up in 5 minutes, no code. Try free for 14 days.", "Start free", 142, null, "/lp/reminders"],
    ["meta", "image", "Stop losing Fridays to invoicing", "Tired of copying numbers between sheets? 4,000 small teams use Brightloop to get paid 9 days faster.", "Learn more", 96, null, "/lp/time"],
    ["meta", "image", "30% off your first year", "Limited time: switch from spreadsheets and save 30% off the annual plan. Cancel anytime.", "Get offer", 12, null, "/lp/switch"],
    ["linkedin", "image", "Cash flow, without the chasing", "Finance leads at 4,000 companies trust Brightloop to cut days sales outstanding. Book a demo and see your own numbers.", "Book a demo", 71, null, "/lp/finance"],
    ["linkedin", "text", "Your AR process is a spreadsheet. It does not have to be.", "AI-powered reminders and automation for accounts receivable. SOC 2 compliant.", "Request demo", 40, 6, "/lp/ar"],
    ["google", "text", "Invoice software for small teams", "Send, track and collect. Free trial, no credit card.", "Try free", 188, null, "/pricing"],
    ["tiktok", "video", "POV: the invoice paid itself", "Watch a client pay in 11 seconds. Easy, fast, built for freelancers.", "Shop now", 24, 3, "/lp/freelance"],
  ],
  "pelicanpay-example": [
    ["meta", "video", "Cheaper card fees, same checkout", "Pelican Pay costs less than the big processors. Save up to $4,200 a year on a $20k month. Money-back guarantee.", "Get a quote", 210, null, "/rates"],
    ["meta", "carousel", "Three ways Pelican Pay pays for itself", "Lower fees. Same-day payouts. Chargeback help included. Join 1,800 shops.", "Learn more", 58, null, "/why"],
    ["meta", "image", "Free shipping labels with every plan", "Sell online? Print labels at checkout and save. Free trial for 30 days.", "Sign up", 33, 9, "/shipping"],
    ["google", "text", "Payment processing from 1.9%", "Compare rates. Switch in a day. No contract, cancel anytime.", "Get rates", 305, null, "/rates"],
    ["google", "text", "Chargebacks cost you twice", "Pelican Pay disputes them for you. Risk free for 60 days.", "See how", 120, null, "/chargebacks"],
    ["linkedin", "image", "Finance teams: one fee, no surprises", "Flat 1.9% and a 99.99% uptime record. Request a demo for your volume.", "Request demo", 88, 20, "/enterprise"],
    ["tiktok", "video", "Day in the life of a shop owner", "Same-day payouts, no more waiting until Tuesday.", "Learn more", 15, null, "/payouts"],
  ],
  "quillbase-example": [
    ["meta", "image", "Write the docs once", "Quillbase turns support tickets into help articles with AI. Save 10 hours a week. Start free.", "Start free", 63, null, "/lp/docs"],
    ["meta", "video", "Your help center is out of date", "Sick of answers nobody trusts? See how Quillbase keeps every article fresh.", "Watch", 19, null, "/lp/fresh"],
    ["linkedin", "image", "Support leaders: deflect 35% of tickets", "Customers at 600 SaaS companies cut tickets with a self-serve help center. Book a demo.", "Book a demo", 150, null, "/lp/support"],
    ["linkedin", "text", "Free audit of your help center", "We read 50 of your articles and send back what is stale. Free audit, no strings.", "Get audit", 26, null, "/audit"],
    ["google", "text", "Help center software", "AI-powered knowledge base. Try free, no credit card.", "Try free", 240, null, "/"],
    ["tiktok", "video", "Support agents, meet your robot intern", "AI drafts the article, you hit publish. Easy.", "Learn more", 8, null, "/lp/agents"],
  ],
};

function addDays(day: string, delta: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10);
}

/** Demo ads for the invented brands. Thumbnails point at the generated placeholder route, never at a real creative. */
export function demoAds(): Ad[] {
  const ads: Ad[] = [];
  for (const c of DEMO_COMPETITORS) {
    COPY[c.id].forEach(([platform, format, headline, body, cta, started, last, path], i) => {
      const firstSeen = addDays(DEMO_TODAY, -started);
      const lastSeen = last === null ? DEMO_TODAY : addDays(DEMO_TODAY, -last);
      ads.push({
        id: `${c.id.split("-")[0]}-${platform}-${i + 1}`,
        competitorId: c.id,
        platform,
        headline,
        body,
        cta,
        format,
        status: last === null ? "active" : "inactive",
        firstSeen,
        lastSeen,
        runningDays: started - (last ?? 0),
        thumbnailUrl: `/placeholder/${encodeURIComponent(`${c.name}|${headline}`)}.svg`,
        landingUrl: `https://${c.domain}${path}`,
        libraryUrl: undefined,
        jobId: platform === "meta" ? "ads.meta.search" : platform === "google" ? "ads.google.advertiser.ads" : platform === "linkedin" ? "ads.linkedin.search" : "tiktok.ad-library.search",
      });
    });
  }
  return ads;
}

/** The demo report: invented brands, invented ads, a fixed date, and the runs that would have produced them. */
export function demoReport(): Report {
  const ads = demoAds();
  const runs: SourceRun[] = [];
  for (const c of DEMO_COMPETITORS) {
    for (const p of ["meta", "google", "linkedin", "tiktok"] as Platform[]) {
      const n = ads.filter((a) => a.competitorId === c.id && a.platform === p).length;
      const endpointId = p === "tiktok" ? "scrapecreators-tiktok-ad-library-search" : `adyntel-${p === "meta" ? "facebook" : p}`;
      runs.push({ competitorId: c.id, platform: p, jobId: ads.find((a) => a.platform === p)?.jobId ?? "", endpointId, state: "completed", costMicros: p === "tiktok" ? 1880 : 6420, adCount: n });
    }
  }
  return buildReport({ competitors: DEMO_COMPETITORS, ads, runs, spendMicros: runs.reduce((n, r) => n + r.costMicros, 0), capMicros: 500_000, mode: "demo", now: new Date(`${DEMO_TODAY}T09:00:00Z`) });
}
