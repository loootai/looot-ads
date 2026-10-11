import { buildReport } from "@/lib/runner";
import { DEMO_TODAY } from "@/lib/clock";
import { FALLBACK_PRICES } from "@/lib/prices";
import { SOURCE_DEFS, defaultPlatforms, isPlanned, planCall } from "@/lib/sources";
import type { Ad, AdFormat, Competitor, Platform, Report, SourceRun } from "@/lib/types";

/** Invented brands. None of them exists. The domains use the reserved .example suffix. */
export const DEMO_COMPETITORS: Competitor[] = [
  { id: "brightloop-example", name: "Brightloop", domain: "brightloop.example" },
  { id: "pelicanpay-example", name: "Pelican Pay", domain: "pelicanpay.example", handle: "pelicanpay_example" },
  { id: "quillbase-example", name: "Quillbase", domain: "quillbase.example" },
  { id: "kw-invoice-automation", name: "invoice automation", keyword: true },
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
    ["x", "image", "Chargebacks, handled", "We dispute them for you and you keep the sale. Risk free for 60 days.", "Learn more", 35, 5, "/chargebacks"],
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

/** Ads found by a keyword, from brands the person never named. The advertisers are invented too. */
type KeywordRow = [platform: Platform, format: AdFormat, advertiser: string, domain: string, headline: string, body: string, cta: string, startedDaysAgo: number, lastDaysAgo: number | null];

const KEYWORD_COPY: Record<string, KeywordRow[]> = {
  "kw-invoice-automation": [
    ["meta", "image", "Ledgerly", "ledgerly.example", "Send the invoice, skip the chase", "Ledgerly reminds late payers for you. Free for 14 days, cancel anytime.", "Start free", 77, null],
    ["meta", "video", "Tallybird", "tallybird.example", "Invoices in 20 seconds", "Create, send and track in one screen. Join 2,500 freelancers.", "Learn more", 31, null],
    ["linkedin", "image", "Ledgerly", "ledgerly.example", "Cut days sales outstanding by 9 days", "Finance teams use Ledgerly to automate collections. Book a demo.", "Book a demo", 54, null],
    ["tiktok", "video", "Tallybird", "tallybird.example", "How I get paid while I sleep", "Automatic reminders, zero awkward emails. Easy to set up.", "Shop now", 12, 2],
    ["reddit", "image", "Penwise", "penwise.example", "Still invoicing from a spreadsheet?", "Penwise turns a timesheet into a paid invoice. Try free, no card.", "Learn more", 19, null],
    ["reddit", "text", "Ledgerly", "ledgerly.example", "A cheaper way to chase late payments", "Save 30% on your first year. Cancel anytime.", "Get offer", 9, null],
    ["tiktoktop", "video", "Penwise", "penwise.example", "POV: the client pays the same day", "Watch an invoice go from draft to paid in a minute.", "Learn more", 25, 1],
  ],
};

function addDays(day: string, delta: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10);
}

/** Demo ads for the invented brands. Thumbnails point at the generated placeholder route, never at a real creative. */
export function demoAds(): Ad[] {
  const ads: Ad[] = [];
  for (const c of DEMO_COMPETITORS.filter((x) => !x.keyword)) {
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
        jobId: ((call) => (isPlanned(call) ? call.jobId : ""))(planCall(c, platform, SOURCE_DEFS, DEMO_TODAY)),
      });
    });
  }
  for (const c of DEMO_COMPETITORS.filter((x) => x.keyword)) {
    KEYWORD_COPY[c.id].forEach(([platform, format, advertiser, domain, headline, body, cta, started, last], i) => {
      const call = planCall(c, platform, SOURCE_DEFS, DEMO_TODAY);
      ads.push({
        id: `${c.id}-${platform}-${i + 1}`,
        competitorId: c.id,
        platform,
        advertiser,
        headline,
        body,
        cta,
        format,
        status: last === null ? "active" : "inactive",
        firstSeen: addDays(DEMO_TODAY, -started),
        lastSeen: last === null ? DEMO_TODAY : addDays(DEMO_TODAY, -last),
        runningDays: started - (last ?? 0),
        thumbnailUrl: `/placeholder/${encodeURIComponent(`${advertiser}|${headline}`)}.svg`,
        landingUrl: `https://${domain}/`,
        jobId: isPlanned(call) ? call.jobId : "",
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
    for (const p of defaultPlatforms(c)) {
      const call = planCall(c, p, SOURCE_DEFS, DEMO_TODAY);
      if (!isPlanned(call)) continue;
      const n = ads.filter((a) => a.competitorId === c.id && a.platform === p).length;
      runs.push({ competitorId: c.id, platform: p, jobId: call.jobId, endpointId: call.endpointId, state: "completed", costMicros: FALLBACK_PRICES[call.endpointId] ?? 0, adCount: n });
    }
  }
  return buildReport({ competitors: DEMO_COMPETITORS, ads, runs, spendMicros: runs.reduce((n, r) => n + r.costMicros, 0), capMicros: 500_000, mode: "demo", now: new Date(`${DEMO_TODAY}T09:00:00Z`) });
}
