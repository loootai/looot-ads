import { createHash } from "node:crypto";
import type { Ad, AdFormat, AdStatus, Platform } from "./types";

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

const LIST_KEYS = ["ads", "results", "data", "items", "ads_data", "advertisements", "creatives", "ad_list", "searchResults", "response", "materials", "ad_creatives"];

/**
 * Finds the list of ads in a provider response. The providers do not share one shape, so this looks at the
 * body itself, then at the usual wrapper keys, up to three levels deep. Returns [] when nothing looks like a list of ads.
 */
export function findAdArray(result: unknown, depth = 0): Obj[] {
  if (Array.isArray(result)) return result.filter(isObj);
  if (!isObj(result) || depth > 3) return [];
  for (const k of LIST_KEYS) {
    const v = result[k];
    if (Array.isArray(v) && v.some(isObj)) return v.filter(isObj);
  }
  for (const k of LIST_KEYS) {
    if (isObj(result[k])) {
      const inner = findAdArray(result[k], depth + 1);
      if (inner.length > 0) return inner;
    }
  }
  return [];
}

/** First non-empty string (or {text} object) found under any alias, in the ad itself and in its usual sub-objects. */
function pickStr(ad: Obj, keys: string[]): string | undefined {
  for (const scope of scopes(ad)) {
    for (const k of keys) {
      const v = scope[k];
      if (typeof v === "string" && v.trim()) return v.trim();
      if (isObj(v) && typeof v.text === "string" && v.text.trim()) return v.text.trim();
      if (typeof v === "number") return String(v);
    }
  }
  return undefined;
}

function scopes(ad: Obj): Obj[] {
  const out: Obj[] = [ad];
  for (const k of ["snapshot", "creative", "content", "details", "ad", "advertiser", "video_info"]) if (isObj(ad[k])) out.push(ad[k] as Obj);
  return out;
}

const isHttp = (v: unknown): v is string => typeof v === "string" && /^https?:\/\//i.test(v.trim());

/** An http(s) link from a string, or from the first link inside an object such as {"720p": "https://..."}. */
const httpUrl = (v: unknown): string | undefined => {
  if (isHttp(v)) return v.trim();
  if (isObj(v)) return Object.values(v).find(isHttp)?.trim();
  return undefined;
};

/** Who runs the ad: a page or brand name as text, or the name inside an advertiser object. */
function pickAdvertiser(ad: Obj): string | undefined {
  for (const scope of scopes(ad)) {
    for (const k of ["page_name", "advertiser_name", "brand_name", "advertiser", "paid_for_by", "page", "byline"]) {
      const v = scope[k];
      if (typeof v === "string" && v.trim()) return v.trim();
      if (isObj(v) && typeof v.name === "string" && v.name.trim()) return v.name.trim();
    }
  }
  return undefined;
}

function pickUrl(ad: Obj, keys: string[]): string | undefined {
  for (const scope of scopes(ad)) {
    for (const k of keys) {
      const u = httpUrl(scope[k]);
      if (u) return u;
    }
  }
  return undefined;
}

const IMAGE_KEYS = ["thumbnail_url", "thumbnail", "thumb", "preview_url", "preview_image", "video_preview_image_url", "cover", "cover_url", "poster", "image_url", "original_image_url", "resized_image_url", "image", "picture", "media_url"];
const VIDEO_KEYS = ["video_url", "video_hd_url", "video_sd_url", "video", "media_video_url"];

/** The thumbnail link. Looks at the usual keys, then at the first image or video card. */
function pickThumb(ad: Obj): string | undefined {
  const direct = pickUrl(ad, IMAGE_KEYS);
  if (direct && !/\.(mp4|mov|webm)(\?|$)/i.test(direct)) return direct;
  for (const scope of scopes(ad)) {
    for (const list of ["images", "videos", "cards", "carousel", "media"]) {
      const arr = scope[list];
      if (Array.isArray(arr)) for (const item of arr) if (isObj(item)) { const u = pickUrl(item, list === "media" || list === "images" ? [...IMAGE_KEYS, "url"] : IMAGE_KEYS); if (u) return u; }
    }
  }
  return undefined;
}

/** The video link: the usual keys, then the first video card. */
function pickMedia(ad: Obj): string | undefined {
  const direct = pickUrl(ad, VIDEO_KEYS);
  if (direct) return direct;
  for (const scope of scopes(ad)) {
    const arr = scope.videos;
    if (Array.isArray(arr)) for (const item of arr) if (isObj(item)) { const u = pickUrl(item, VIDEO_KEYS); if (u) return u; }
  }
  return undefined;
}

function hasList(ad: Obj, names: string[]): boolean {
  return scopes(ad).some((s) => names.some((n) => Array.isArray(s[n]) && (s[n] as unknown[]).length > 0));
}

/** Date value (ISO text, "2026-09-01", unix seconds or milliseconds) to an ISO day. undefined when it is not a date. */
export function toDay(v: unknown): string | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  let ms: number;
  if (typeof v === "number") ms = v < 1e11 ? v * 1000 : v;
  else if (typeof v === "string") {
    if (/^\d{9,13}$/.test(v)) ms = Number(v) < 1e11 ? Number(v) * 1000 : Number(v);
    else ms = Date.parse(v);
  } else return undefined;
  if (!Number.isFinite(ms)) return undefined;
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  if (y < 2005 || y > 2100) return undefined;
  return d.toISOString().slice(0, 10);
}

function pickDay(ad: Obj, keys: string[]): string | undefined {
  for (const scope of scopes(ad)) for (const k of keys) { const d = toDay(scope[k]); if (d) return d; }
  return undefined;
}

const START_KEYS = ["start_date", "startDate", "start_date_string", "ad_delivery_start_time", "first_shown", "firstShown", "first_shown_date", "first_shown_at", "first_seen", "firstSeen", "date_start", "created_at", "start"];
const END_KEYS = ["end_date", "endDate", "end_date_string", "ad_delivery_stop_time", "last_shown", "lastShown", "last_shown_date", "last_shown_at", "last_seen", "lastSeen", "date_end", "end"];

function pickFormat(ad: Obj, hasVideo: boolean, hasImage: boolean): AdFormat {
  const t = (pickStr(ad, ["display_format", "format", "creative_type", "ad_format", "media_type", "type"]) ?? "").toLowerCase();
  if (/carousel|dco|multi|cards/.test(t) || hasList(ad, ["cards", "carousel"])) return "carousel";
  if (/video|reel/.test(t)) return "video";
  if (/image|photo|picture|single_image|static/.test(t)) return "image";
  if (/text/.test(t)) return "text";
  if (hasVideo) return "video";
  if (hasImage) return "image";
  return "unknown";
}

function pickStatus(ad: Obj, lastSeen: string | undefined, today: string): AdStatus {
  for (const scope of scopes(ad)) {
    const a = scope.is_active ?? scope.isActive ?? scope.active;
    if (typeof a === "boolean") return a ? "active" : "inactive";
  }
  const s = (pickStr(ad, ["status", "ad_status", "active_status"]) ?? "").toLowerCase();
  if (/^(active|running|live)/.test(s)) return "active";
  if (/inactive|ended|stopped|paused/.test(s)) return "inactive";
  if (lastSeen && lastSeen < today) return "inactive";
  return "unknown";
}

function daysBetween(a: string, b: string): number {
  return Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000));
}

const LIBRARY_HOSTS = /facebook\.com\/ads\/library|reddit\.com\/ads\/library|(?:x|twitter)\.com\/[^/]+\/status\/|adstransparency\.google|linkedin\.com\/ad-library|library\.tiktok\.com|ads\.tiktok\.com\/business\/creativecenter/i;

/** Maps the ads in one provider response to Ad rows. Every field is optional on the provider side; a missing one stays undefined. */
export function parseAds(result: unknown, ctx: { competitorId: string; platform: Platform; jobId: string; today: string }): Ad[] {
  const out: Ad[] = [];
  const seen = new Set<string>();
  for (const raw of findAdArray(result)) {
    const headline = pickStr(raw, ["title", "headline", "ad_title", "name", "link_title"]);
    const body = pickStr(raw, ["body", "ad_text", "commentary", "primary_text", "message", "text", "full_text", "tweet_text", "description", "ad_creative_body", "caption"]);
    const cta = pickStr(raw, ["cta_text", "cta", "call_to_action", "button_text", "cta_type"]);
    const thumbnailUrl = pickThumb(raw);
    const mediaUrl = pickMedia(raw);
    const firstSeen = pickDay(raw, START_KEYS);
    const lastSeenRaw = pickDay(raw, END_KEYS);
    const status = pickStatus(raw, lastSeenRaw, ctx.today);
    const lastSeen = lastSeenRaw ?? (status === "active" ? ctx.today : undefined);
    const runningDays = firstSeen && lastSeen ? daysBetween(firstSeen, lastSeen) : undefined;
    let landingUrl = pickUrl(raw, ["link_url", "landing_page", "landing_page_url", "destination_url", "destination", "website", "cta_url", "click_url", "final_url", "link"]);
    let libraryUrl = pickUrl(raw, ["ad_library_url", "library_url", "ad_url", "ad_link", "details_url", "url"]);
    if (libraryUrl && !LIBRARY_HOSTS.test(libraryUrl)) libraryUrl = undefined;
    if (landingUrl && LIBRARY_HOSTS.test(landingUrl)) {
      libraryUrl ??= landingUrl;
      landingUrl = undefined;
    }
    if (!headline && !body && !thumbnailUrl && !mediaUrl && !libraryUrl) continue;
    const providerId = pickStr(raw, ["ad_archive_id", "ad_id", "adId", "creative_id", "archive_id", "id", "material_id"]);
    const id = providerId ?? createHash("sha1").update(`${headline}|${body}|${thumbnailUrl}`).digest("hex").slice(0, 12);
    const key = `${ctx.platform}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id,
      competitorId: ctx.competitorId,
      platform: ctx.platform,
      advertiser: pickAdvertiser(raw),
      headline,
      body,
      cta,
      format: pickFormat(raw, Boolean(mediaUrl) || hasList(raw, ["videos"]), Boolean(thumbnailUrl)),
      status,
      firstSeen,
      lastSeen,
      runningDays,
      thumbnailUrl,
      mediaUrl,
      landingUrl,
      libraryUrl,
      jobId: ctx.jobId,
    });
  }
  return out;
}
