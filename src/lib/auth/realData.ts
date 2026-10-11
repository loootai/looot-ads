import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Env } from "./policy";

/** true when a real looot token is set or a saved pull exists. Server only. */
export function hasRealData(env: Env = process.env): boolean {
  if (env.LOOOT_TOKEN && env.LOOOT_TOKEN.trim() !== "") return true;
  return existsSync(join(resolve(/* turbopackIgnore: true */ env.LOOOT_ADS_DATA_DIR || ".looot-data"), "latest.json"));
}
