# Changelog

Built from the GitHub release notes. Each version links to its release page.

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
