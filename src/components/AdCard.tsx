import { ExternalLink } from "lucide-react";
import { shortDay } from "@/lib/clock";
import type { Ad } from "@/lib/types";

const PLATFORM_LABEL = { meta: "Meta", google: "Google", linkedin: "LinkedIn", tiktok: "TikTok" } as const;

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** One ad: thumbnail link, copy, platform, first seen, running time, landing page. */
export function AdCard({ ad, competitor }: { ad: Ad; competitor: string }) {
  return (
    <article className="flex flex-col overflow-hidden rounded-panel border border-line bg-panel">
      <div className="relative aspect-[4/3] bg-hover">
        {ad.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={ad.thumbnailUrl} alt={ad.headline ? `Ad: ${ad.headline}` : "Ad thumbnail"} loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover" />
        ) : (
          <div className="grid size-full place-items-center px-6 text-center text-12 text-faint">{ad.format === "text" ? "Text ad" : "The library returned no thumbnail"}</div>
        )}
        <span className="absolute left-2 top-2 rounded-control bg-panel/90 px-1.5 py-0.5 text-11 font-medium">{PLATFORM_LABEL[ad.platform]}</span>
        <span className={`absolute right-2 top-2 rounded-control px-1.5 py-0.5 text-11 font-medium ${ad.status === "active" ? "bg-brand text-brand-ink" : "bg-panel/90 text-mute"}`}>{ad.status === "unknown" ? "status unknown" : ad.status}</span>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-center justify-between text-12 text-mute">
          <span className="font-medium text-ink">{competitor}</span>
          <span className="num">{ad.format}</span>
        </div>
        {ad.headline && <h3 className="text-14 font-semibold leading-snug">{ad.headline}</h3>}
        {ad.body && <p className="line-clamp-4 text-13 text-mute">{ad.body}</p>}
        {ad.cta && <span className="w-fit rounded-control border border-line px-2 py-0.5 text-12">{ad.cta}</span>}
        <dl className="mt-auto grid grid-cols-2 gap-x-3 gap-y-1 border-t border-line pt-2 text-12">
          <dt className="text-faint">First seen</dt>
          <dd className="num text-right">{ad.firstSeen ? shortDay(ad.firstSeen) : "unknown"}</dd>
          <dt className="text-faint">Running</dt>
          <dd className="num text-right">{typeof ad.runningDays === "number" ? `${ad.runningDays} days` : "unknown"}</dd>
          <dt className="text-faint">Landing page</dt>
          <dd className="truncate text-right">{ad.landingUrl ? <a href={ad.landingUrl} target="_blank" rel="noreferrer noopener" className="text-link hover:underline">{host(ad.landingUrl)}</a> : "none returned"}</dd>
        </dl>
        {ad.libraryUrl && (
          <a href={ad.libraryUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-12 text-link hover:underline">
            View in the ad library <ExternalLink size={12} />
          </a>
        )}
      </div>
    </article>
  );
}
