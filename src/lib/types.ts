export type Platform = "meta" | "google" | "linkedin" | "tiktok" | "reddit" | "x" | "tiktoktop";
export const PLATFORMS: Platform[] = ["meta", "google", "linkedin", "tiktok", "reddit", "x", "tiktoktop"];

/** Names shown in the UI, the plan and the reports. */
export const PLATFORM_LABEL: Record<Platform, string> = {
  meta: "Meta",
  google: "Google",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  reddit: "Reddit",
  x: "X",
  tiktoktop: "TikTok top ads",
};

export interface Competitor {
  /** Stable slug, made from the domain or the name. A keyword gets the prefix "kw-". */
  id: string;
  name: string;
  domain?: string;
  /** X handle without the @. Needed only for the X ads repository. */
  handle?: string;
  /** true when this row is a topic to discover ads for, not a named brand. `name` holds the keyword. */
  keyword?: boolean;
}

export type AdFormat = "image" | "video" | "carousel" | "text" | "unknown";
export type AdStatus = "active" | "inactive" | "unknown";

/** One ad as the ad library returned it. Only links and short text are kept, never the creative file. */
export interface Ad {
  id: string;
  competitorId: string;
  platform: Platform;
  /** Who runs the ad, when the library says. The only brand name a keyword search gives. */
  advertiser?: string;
  headline?: string;
  body?: string;
  cta?: string;
  format: AdFormat;
  status: AdStatus;
  /** ISO day, when the library gave a start date. */
  firstSeen?: string;
  lastSeen?: string;
  /** Days between first seen and last seen (or today, for an active ad). */
  runningDays?: number;
  /** Link to a thumbnail on the provider's CDN. Not downloaded. */
  thumbnailUrl?: string;
  mediaUrl?: string;
  landingUrl?: string;
  /** Link to the ad in the public ad library, when the provider returns one. */
  libraryUrl?: string;
  jobId: string;
}

export type RunState = "completed" | "failed" | "pending" | "skipped" | "blocked" | "planned";

/** What happened for one (competitor, platform) pair. */
export interface SourceRun {
  competitorId: string;
  platform: Platform;
  jobId: string;
  endpointId: string;
  state: RunState;
  runId?: string;
  costMicros: number;
  adCount: number;
  message?: string;
}

export interface Count {
  label: string;
  count: number;
  example?: string;
}

export interface CompetitorSummary {
  competitorId: string;
  adCount: number;
  activeCount: number;
  byPlatform: Partial<Record<Platform, number>>;
  byFormat: Partial<Record<AdFormat, number>>;
  medianRunningDays: number | null;
  longestRunning: { adId: string; days: number; headline?: string }[];
  newestAdIds: string[];
  angles: Count[];
  offers: Count[];
  ctas: Count[];
  landingPages: Count[];
}

export interface Report {
  version: 1;
  createdAt: string;
  mode: "demo" | "live";
  competitors: Competitor[];
  ads: Ad[];
  runs: SourceRun[];
  spendMicros: number;
  capMicros: number;
  summaries: CompetitorSummary[];
}
