import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { demoReport } from "@/demo/seed";
import { IS_DEMO } from "./clock";
import type { Report } from "./types";

const dir = () => process.env.LOOOT_ADS_DATA_DIR ?? join(process.cwd(), ".looot-data");

/** The report the board shows: the demo report in demo mode, else the last live pull saved on disk, else null. */
export function loadReport(): Report | null {
  if (IS_DEMO) return demoReport();
  const file = join(dir(), "latest.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Report;
  } catch {
    return null;
  }
}

/** Saves a live report as the latest one. Local file only; nothing leaves the machine. */
export function saveReport(report: Report): void {
  mkdirSync(dir(), { recursive: true });
  writeFileSync(join(dir(), "latest.json"), JSON.stringify(report));
}
