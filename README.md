<p align="center"><img src="assets/hero.png" alt="looot-ads" width="100%"></p>

# looot-ads

[![License](https://img.shields.io/github/license/loootai/looot-ads)](LICENSE) [![Release](https://img.shields.io/github/v/release/loootai/looot-ads)](https://github.com/loootai/looot-ads/releases) [![Docs](https://img.shields.io/badge/docs-docs.looot.ai-12A06A)](https://docs.looot.ai)

An open-source alternative to Foreplay, the competitor ad library and swipe-file tool. Foreplay starts at $49 a month billed annually ($59 monthly), read on its public pricing page on 2026-10-10. This repo pulls the same kind of data on demand through one looot key and charges per call. A pull of five competitors across four platforms is about $0.11 at list prices.

Name competitors by domain or by name. looot-ads reads their ads from the Meta, Google Ads Transparency, LinkedIn and TikTok ad libraries and shows a board of creatives with the copy, first seen date, running time, platform and landing page. For each competitor it adds a summary of the angles and offers in their copy.

![Board, light theme](docs/screenshots/board-light.png)

![One competitor, dark theme](docs/screenshots/competitor-dark.png)

The demo data is invented. The brands (Brightloop, Pelican Pay, Quillbase) do not exist, their domains end in `.example`, and every thumbnail is a generated placeholder labelled as one.

## Three ways to run it

**Demo, no account and no token.**

```bash
npm install --ignore-scripts
npm run demo        # web UI at http://localhost:3220 with invented brands
```

**Headless CLI.** One command in, JSON, CSV and markdown out.

```bash
export LOOOT_TOKEN=...                       # https://looot.ai/settings
npm run ads -- --competitors "acme.com,Globex" --dry-run     # prints the price, makes no call
npm run ads -- --file competitors.example.csv --max-spend 0.25 --out out
```

Options: `--platforms meta,google,linkedin,tiktok`, `--max-spend <usd>` (default 1.00), `--fresh <tag>` to pull again, `--demo` to write the demo report. It writes `ads.json`, `ads.csv` and `brief.md`. Exit code 0 is done, 1 means a source failed or is pending, 2 is bad usage.

**Web UI on the same engine.** `npm run dev`, open `/new`, paste competitors, press "Show the price", then "Run for $0.11". The run button works only on a quote you have seen. If the live price rose above what you confirmed, the server refuses with a 409 and asks you to quote again. Supabase and sign-in are not used. The last pull is saved to `.looot-data/latest.json` on your machine.

![New pull page](docs/screenshots/new-light.png)

## What it costs

Prices are the per-call list prices in the public looot catalog on 2026-10-10. The CLI reads live prices before running and uses these only for `--dry-run` or when the catalog cannot be read.

| Platform | Needs | looot job | Endpoint | Price per call |
| --- | --- | --- | --- | --- |
| Meta | domain | `ads.meta.search` | `adyntel-facebook` | $0.00642 |
| Meta | name | `ads.meta.search` | `scrapecreators-facebook-adlibrary-company-ads-get` | $0.00188 |
| Google | domain | `ads.google.advertiser.ads` | `adyntel-google` | $0.00642 |
| LinkedIn | domain | `ads.linkedin.search` | `adyntel-linkedin` | $0.00642 |
| LinkedIn | name | `ads.linkedin.search` | `scrapecreators-linkedin-ads-search` | $0.00188 |
| TikTok | name | `tiktok.ad-library.search` | `scrapecreators-tiktok-ad-library-search` | $0.00188 |

A competitor with a domain on all four platforms costs $0.0211. Five competitors cost $0.1057. This is the real output of `npm run ads -- --file competitors.example.csv --dry-run`:

```text
20 calls, $0.1057 at list prices dated 2026-10-10. Spend cap $1.00.
```

Other ad-library endpoints exist in the catalog (SearchApi for Meta, LinkedIn, TikTok and Google, HarvestAPI and Anysite for LinkedIn, Anysite and TikHub for TikTok). Swap one in by editing `src/lib/sources.ts`. Each endpoint is pinned with no provider fallback, so the quoted price is the price.

## Money rules

- The price of every call is shown before the call. The CLI prints the plan first. The web UI shows a table and a total.
- A per-run spend cap is enforced before each call. A call that would pass the cap is not made and is marked "blocked".
- Each call has a stable idempotency key made from the endpoint and the input. Running the same input again replays the stored run and is not charged twice. `--fresh <tag>` changes the key when you want a new pull.
- A run still going when waiting stops is "pending", never "failed". It counts against the cap at its quoted price until it settles.
- A failed run costs nothing, and the report says why.

## How the summary is made

Angles and offers come from keyword and pattern rules in `config/angles.json`, not from a model. An ad counts toward "Risk reversal" if its headline or body contains a word like "guarantee" or "cancel anytime". Edit the file to fit your market. The summary also lists the longest-running ads, the median running time, the most used calls to action and the landing pages the ads point to. Running time is the days between the library's start date and its end date, or today for an ad still active.

## What it does not do

- It does not store creatives. It keeps the thumbnail and video links the provider returns, plus short text. The board loads thumbnails from the provider's link. Links can expire.
- It makes one call per competitor and platform, which returns the first page the provider gives. It does not page through every ad of a large advertiser.
- Foreplay also offers a discovery library of ads from brands you did not name, creative analytics on your own ad account and AI briefs. None of that is here. looot has no source for those.
- Google needs a domain. A name alone skips Google and says so in the report.

## What is not tested

No paid looot run was made while building this. The code that turns a provider response into ads is built from the endpoint descriptions in the catalog, from the field names those providers document, and from fixtures written to match. It reads many alias names for each field and skips what it cannot read, but the first real pull may show a field it misses. If a provider returns ads that look empty, open `out/ads.json`, send the raw shape in an issue, and add the alias in `src/lib/normalize.ts`. The unit tests mock HTTP.

## Develop

```bash
npm test            # vitest, mocked HTTP
npm run typecheck
npm run lint
npm run build
npm run leak-scan   # run before every push; git config core.hooksPath .githooks turns it on
```

Stack: TypeScript, Next.js App Router, Tailwind. Versions are pinned exactly and install scripts are off (`.npmrc`).

## Install for agents

Read `llms.txt`, then use the Claude Code skill in `skills/looot-ads/SKILL.md`. To add it to a project:

```bash
mkdir -p .claude/skills && cp -r skills/looot-ads .claude/skills/
```

The skill runs `--dry-run` first, shows the total, and runs only after you agree.

## Licence

MIT, copyright looot. Foreplay is a trademark of its owner. This project is not affiliated with it and uses none of its code, text or images.

## Related

Other open-source projects built on [looot](https://looot.ai):

- [looot-intent](https://github.com/loootai/looot-intent): account intent and buying-stage scoring (6sense)
- [looot-score](https://github.com/loootai/looot-score): lead and ICP fit scoring (MadKudu)
- [looot-reveal](https://github.com/loootai/looot-reveal): which companies visit your site (RB2B, Clearbit Reveal)
- [looot-techstack](https://github.com/loootai/looot-techstack): website technologies from several providers (BuiltWith, Wappalyzer)
- [looot-signals](https://github.com/loootai/looot-signals): hiring, funding and news triggers (TheirStack, Harmonic)
- [looot-lookalike](https://github.com/loootai/looot-lookalike): lookalike company search (Ocean.io)
- [looot-reviews](https://github.com/loootai/looot-reviews): review themes and weak spots (ReviewTrackers)
- [looot-battlecards](https://github.com/loootai/looot-battlecards): competitor battlecards (Klue, Crayon)
- [looot-mentions](https://github.com/loootai/looot-mentions): brand and keyword listening (Brand24)
- [looot-crm](https://github.com/loootai/looot-crm): a small CRM with buying signals built in
- [looot-seo](https://github.com/loootai/looot-seo): self-hosted SEO workspace
- [looot-monitor](https://github.com/loootai/looot-monitor): brand and competitor monitoring with alerts
