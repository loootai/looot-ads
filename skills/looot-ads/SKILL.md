---
name: looot-ads
description: Pull a competitor's live ads from the Meta, Google, LinkedIn and TikTok ad libraries and summarise their angles and offers. Use when asked to spy on, track or compare competitor ads, or to build a swipe file from named competitors. Prices every call before it runs.
---

# looot-ads

Runs the `looot-ads` CLI in this repo. Needs `LOOOT_TOKEN` for a real pull; `--dry-run` and `--demo` need nothing.

## Steps

1. Collect competitors. A domain (`acme.com`) unlocks Google and the Adyntel lookups. A bare name works for Meta, LinkedIn and TikTok only.
2. Price it first, always:
   `npm run ads -- --competitors "acme.com,globex.io" --platforms meta,google,linkedin,tiktok --dry-run`
   Show the person the total. About $0.021 per competitor with a domain on all four platforms at list prices dated 2026-10-10.
3. Run it only after they agree, with a cap at or just above the quoted total:
   `npm run ads -- --competitors "acme.com,globex.io" --max-spend 0.25 --out out`
4. Read `out/brief.md` for the angles and offers per competitor, `out/ads.csv` for the rows, `out/ads.json` for everything.
5. Report what came back and what did not. Each source row in `brief.md` says completed, failed, pending, skipped or blocked, and why.

## Rules

- Exit code 1 and the word "pending" mean a run is still going. Run the same command again. The stored run is replayed and not charged twice. Never describe a pending run as failed.
- Use `--fresh <tag>` only when the person wants a new pull of an input that already ran. It is charged again.
- Never raise `--max-spend` unprompted.
- Keep links and short text only. Do not download the creatives.
- The angle and offer counts come from keyword rules in `config/angles.json`. Say so; they are counts of words, not a read of intent.
