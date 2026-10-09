import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { demoReport } from "@/demo/seed";
import { today } from "@/lib/clock";
import { LoootError, loootFromEnv, type LoootRunner } from "@/lib/looot";
import { usdPrecise } from "@/lib/money";
import { adsToCsv, renderPlan, reportToMarkdown } from "@/lib/output";
import { ENDPOINT_IDS, FALLBACK_PRICES, PRICES_AS_OF, fetchPrices, type PriceResult } from "@/lib/prices";
import { buildPlan, runPlan } from "@/lib/runner";
import { parseCapUsd } from "@/lib/spend";
import { parseCompetitorList } from "@/lib/sources";
import { PLATFORMS, type Platform } from "@/lib/types";

export const HELP = `Usage: npm run ads -- --competitors "acme.com,Globex" [options]
       npm run ads -- --file competitors.csv [options]

  --competitors <list>  Domains or names, comma separated. A domain unlocks Google and the cheaper-per-platform lookups.
  --file <path>         One competitor per line, or a CSV with a name and a domain column.
  --platforms <list>    meta,google,linkedin,tiktok. Default: all four.
  --max-spend <usd>     Hard cap for the run in dollars. Default: 1.00
  --out <dir>           Where ads.json, ads.csv and brief.md go. Default: out
  --dry-run             Print the calls and the list-price total. Make no looot call.
  --fresh <tag>         Pull again even if the same input ran before. Charged again.
  --demo                Write the demo report (invented brands). No token, no call.

Needs LOOOT_TOKEN in the environment, except with --dry-run or --demo.`;

export interface CliDeps {
  log: (s: string) => void;
  err: (s: string) => void;
  env: Record<string, string | undefined>;
  looot?: LoootRunner;
  prices?: () => Promise<PriceResult>;
  readFile?: (path: string) => string;
}

/** Runs the CLI. Returns the exit code: 0 done, 1 some sources failed or are pending, 2 bad usage. */
export async function main(argv: string[], deps: CliDeps): Promise<number> {
  let args;
  try {
    args = parseArgs({
      args: argv,
      options: {
        competitors: { type: "string" },
        file: { type: "string" },
        platforms: { type: "string" },
        "max-spend": { type: "string", default: "1.00" },
        out: { type: "string", default: "out" },
        "dry-run": { type: "boolean", default: false },
        fresh: { type: "string" },
        demo: { type: "boolean", default: false },
        help: { type: "boolean", default: false },
      },
    }).values;
  } catch (e) {
    deps.err(`${(e as Error).message}\n\n${HELP}`);
    return 2;
  }
  if (args.help) {
    deps.log(HELP);
    return 0;
  }

  if (args.demo) {
    const report = demoReport();
    writeOutputs(args.out as string, report, deps);
    deps.log(`Demo report written to ${args.out}. ${report.ads.length} invented ads, no looot call.`);
    return 0;
  }

  const raw = args.file ? (deps.readFile ?? ((p: string) => readFileSync(p, "utf8")))(args.file) : (args.competitors ?? "");
  const competitors = parseCompetitorList(args.file ? raw : raw.replace(/,/g, "\n"));
  if (competitors.length === 0) {
    deps.err(`Give at least one competitor with --competitors or --file.\n\n${HELP}`);
    return 2;
  }

  const platforms = (args.platforms ? args.platforms.split(",").map((s) => s.trim().toLowerCase()) : PLATFORMS) as Platform[];
  const bad = platforms.filter((p) => !PLATFORMS.includes(p));
  if (bad.length > 0) {
    deps.err(`Unknown platform: ${bad.join(", ")}. Use ${PLATFORMS.join(", ")}.`);
    return 2;
  }

  let cap: number;
  try {
    cap = parseCapUsd(args["max-spend"] as string);
  } catch (e) {
    deps.err((e as Error).message);
    return 2;
  }

  if (args["dry-run"]) {
    const plan = buildPlan(competitors, platforms, FALLBACK_PRICES, cap);
    deps.log(renderPlan(plan, competitors, `list prices dated ${PRICES_AS_OF}`));
    deps.log("\nDry run: no looot call was made and nothing was written.");
    return 0;
  }

  let looot = deps.looot;
  if (!looot) {
    try {
      looot = loootFromEnv(deps.env);
    } catch (e) {
      if (e instanceof LoootError) {
        deps.err("LOOOT_TOKEN is not set. Create an agent token at https://looot.ai/settings, or use --dry-run or --demo.");
        return 2;
      }
      throw e;
    }
  }
  const priced = await (deps.prices ?? (() => fetchPrices(ENDPOINT_IDS)))();
  const plan = buildPlan(competitors, platforms, priced.prices, cap);
  deps.log(renderPlan(plan, competitors, priced.source === "catalog" ? "live catalog prices" : `list prices dated ${PRICES_AS_OF}`));
  if (priced.unread.length > 0) deps.log(`\nThe live price of ${priced.unread.join(", ")} could not be read. Those calls will not run.`);
  deps.log(`\nRunning ${plan.lines.length} calls, at most ${usdPrecise(Math.min(plan.totalMicros, cap))}.\n`);

  const report = await runPlan({
    competitors,
    plan,
    looot,
    unpriced: priced.unread,
    today: today(),
    freshTag: args.fresh,
    onProgress: (r) => deps.log(`  ${r.competitorId} ${r.platform}: ${r.state}, ${r.adCount} ads, ${usdPrecise(r.costMicros)}${r.message ? `. ${r.message}` : ""}`),
  });
  writeOutputs(args.out as string, report, deps);
  const pending = report.runs.filter((r) => r.state === "pending").length;
  const failed = report.runs.filter((r) => r.state === "failed" || r.state === "blocked").length;
  deps.log(`\n${report.ads.length} ads from ${report.competitors.length} competitors. Spent ${usdPrecise(report.spendMicros)} of ${usdPrecise(report.capMicros)}. Written to ${args.out}.`);
  if (pending > 0) deps.log(`${pending} source(s) are pending, not failed. Run the same command again to read them.`);
  return failed > 0 || pending > 0 ? 1 : 0;
}

function writeOutputs(dir: string, report: ReturnType<typeof demoReport>, deps: CliDeps): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "ads.json"), `${JSON.stringify(report, null, 1)}\n`);
  writeFileSync(join(dir, "ads.csv"), adsToCsv(report));
  writeFileSync(join(dir, "brief.md"), reportToMarkdown(report));
  deps.log(`Wrote ${join(dir, "ads.json")}, ads.csv and brief.md.`);
}
