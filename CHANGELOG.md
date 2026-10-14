# Changelog

Built from the GitHub release notes. Each version links to its release page.

## Unreleased

- Fix: the sign-in form could not be used in a browser. Chrome sends `Origin: null` for a same-origin form post under `Referrer-Policy: no-referrer`, and the same-origin check refused it with 403. The check now falls back to `Sec-Fetch-Site` for `null`.

## 0.1.6 (2026-10-11)

Spend limits, version 2. Before this, a pull was limited only by the cap per pull, an in-memory rate limit and the token balance. Nothing limited spend across pulls, two requests started together could both pass the cap, and an X ads call changed its key every day because its date window ended on today.

What changed
- Period budget: a daily and a monthly amount (UTC), $10 and $50 by default, saved in `budget.json` in `LOOOT_ADS_DATA_DIR`. The signed-in owner changes it on the new Costs page (`PUT /api/budget`). A run request cannot raise it, and one that carries a budget field is refused with 400. The spend cap per pull still comes only from the server (`ADS_SPEND_CAP_USD`); a cap in a request is ignored.
- Reserve then settle: each paid call reserves its list price under a lock file before it is made, and is refused if used plus reserved plus the price would pass either budget. The reservation becomes the real cost when the call ends and goes back if looot refused the call. A call still running keeps its reservation and is never counted as $0. The next pull looks up pending calls with `GET /v1/runs/{id}` and settles them. A reservation that cannot be looked up is released after 24 hours.
- Stored results: a finished call is stored under its stable key for 40 days, so the same request is answered with no call and no charge. The up-front budget check ignores calls that have a stored answer.
- Stable keys: the X ads call ended its date window on today, so its input and key changed every day. The window now ends on the first day of the current 7-day period. A new period is a new request with its own stable key. `--fresh <tag>` is still the explicit way to pull again.
- The sidebar spend panel and the Costs page show used, reserved and remaining for today and this month. The CLI refuses a pull above what is left of the budget unless `--partial` is passed.
- README: the Spending and Securing a deployment sections describe the new limits. The token balance is still the final limit.

For upgraders
- No migration. This repo has no database. `budget.json` is a new file, created in `LOOOT_ADS_DATA_DIR` (default `.looot-data`) on first use. Run one instance on a persistent disk, since the file is not shared between hosts.
- `/api/budget` and `/costs` are new admin routes. The route map and its tests include them.
- The first X ads pull after upgrading may be charged once more, because its key changed from the daily form to the period form.

## 0.1.5 (2026-10-11)

Ad discovery by keyword, three new sources, and a fix for a catalog change.

What changed
- Discovery by keyword. `--keywords "crm software"` (or a `kw:` line, or "Discover by keyword" in the web UI) searches Meta, LinkedIn, TikTok, Reddit and the TikTok Creative Center top ads, and shows ads from brands you did not name, with the advertiser on each card. One keyword on five platforms is $0.01064 at list prices.
- Reddit Ad Library (`searchapi-io-reddit-ad-library`, $0.004 per call, job `search.reddit-ad-library`) and TikTok top ads (`tikhub-api-tiktok-ads-search-ads`, $0.001 per call, job `api.tiktok.ads.search-ads`), both by keyword.
- X Ads Repository (`anysite-api-twitter-ads-search`, job `api.twitter.ads.search`) for a named competitor with a handle (`acme.com @acme`). Priced per result at $0.00036. The call asks for 20 results, so the quote is $0.0072.
- The Adyntel endpoints the earlier versions used are gone from the public catalog, so a live-priced pull would have refused every Meta, Google and LinkedIn call for a domain. Meta and LinkedIn now search by company name. Google uses `searchapi-io-google-ads-transparency-center` ($0.004) by domain.
- A competitor with a domain on four platforms now costs $0.00964 (was listed as $0.0211). Five competitors cost $0.0482 (was $0.1057).
- No new routes. The route map is unchanged and its tests stay green.

For upgraders
- Meta and LinkedIn now look up by company name. Give a name, not only a domain, when the domain stem is not the brand name.
- The `--platforms` default is unchanged for competitors. The new platforms are `reddit`, `x` and `tiktoktop`.
- The response parsers for the new sources are built from endpoint descriptions and are unverified, like the original four. See Status in the README.

[Release page](https://github.com/loootai/looot-ads/releases/tag/v0.1.5)

## 0.1.4 (2026-10-11)

Security fix. Versions 0.1.3 and older had no admin authentication. Anyone who could reach a running web UI could read the saved pull and start paid looot runs on your token, with a spend cap they chose. If you run one of those versions on a host others can reach, upgrade to v0.1.4 and set ADS_ADMIN_PASSWORD (12 characters or more).

What changed
- Every page and route is public on purpose or admin. Admin routes are closed until a password is set, and /login explains what to set.
- Signed httpOnly session cookie, lockout after repeated wrong passwords, CSRF token plus same-origin check on every state-changing request.
- The spend cap is set by the server (ADS_SPEND_CAP_USD, default 1.00), not by the request. A paid run needs a quote token the server signed for your session and that pull. 6 paid runs per session per hour.
- Security headers, and no-store on admin responses.

For upgraders
- The web UI now needs ADS_ADMIN_PASSWORD, or it shows a setup page. The CLI is unchanged.
- The Spend cap field is gone from the page. Set ADS_SPEND_CAP_USD instead.
- npm run demo refuses to start next to a LOOOT_TOKEN or a saved pull (.looot-data/latest.json) unless a password is set.

See Securing a deployment in the README.

[Release page](https://github.com/loootai/looot-ads/releases/tag/v0.1.4)

## 0.1.3 (2026-10-10)

Sidebar: nested-item support in the shared shell, placeholder label no longer under the platform pill

[Release page](https://github.com/loootai/looot-ads/releases/tag/v0.1.3)

## 0.1.2 (2026-10-10)

Sidebar layout.

[Release page](https://github.com/loootai/looot-ads/releases/tag/v0.1.2)

## 0.1.1 (2026-10-10)

Dependency security bump. next and eslint-config-next 16.3.7 to 16.3.8, which fixes six Next.js advisories (GHSA-3w37-wq28-93x7, GHSA-4jqv-mc3x-m676, GHSA-39w2-rjm5-chcv, GHSA-f87g-xv8r-7p7x, GHSA-mcj8-r9mp-w47p, GHSA-cjq9-62q9-8jv4). No code changes. v0.1.0 is unchanged.

[Release page](https://github.com/loootai/looot-ads/releases/tag/v0.1.1)

## 0.1.0 (2026-10-09)

First release. Competitor ad board over the Meta, Google, LinkedIn and TikTok ad libraries through looot. Demo mode with invented brands, a headless CLI with --dry-run and a spend cap, and a web UI on the same engine. No paid looot run was made; response parsing is built from catalog descriptions and fixtures.

[Release page](https://github.com/loootai/looot-ads/releases/tag/v0.1.0)
