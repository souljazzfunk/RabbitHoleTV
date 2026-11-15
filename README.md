# RabbitHoleTV

A static remake of [HackerTube](https://hackertube.org) by [@karpathy](https://x.com/karpathy) — the YouTube videos
Hacker News keeps recommending — with a lean-back **TV mode** modeled on [TristanTube](https://karpathy.ai/tristan-tube/).

## TV mode

Press `T` (or any **TV** button) and the page goes fullscreen and plays random videos one after another, forever.
It plays from **whatever you're currently looking at**:

| You're on            | TV mode picks from                                    |
|----------------------|-------------------------------------------------------|
| a category (`/c/…`)  | that category (with any active filters)               |
| an area (`/a/…`)     | that area                                             |
| a playlist           | that playlist                                         |
| search results       | the results                                           |
| a video page         | continues that video, then its first category         |
| Home / anything else | all videos                                            |

Picks are random (gently weighted toward better-recommended videos) with no repeats until the pool is exhausted.
Keys: `N` next · `P` previous · `Space` pause · `←/→` ±10s · `1–9` jump to 10–90% · `M` mute · `L` like ·
`F` fullscreen on/off (leaving fullscreen keeps TV playing in the window) · `Esc`/`T` exit. Append `?tv=1` to any URL to start TV mode on load (starts muted, since browsers block
unmuted autoplay without a click).

## How it works

No backend. `scripts/build_data.py` downloads HackerTube's [open data export](https://hackertube.org/data) and
precomputes static JSON in `public/data/`:

- `index.json` — compact rows for all videos (list/filter/feed/TV)
- `taxonomy.json`, `playlists.json`, `stats.json`
- `search.json` — summaries for client-side search
- `similar.json` — top-20 embedding neighbours + co-recommended videos ("Up next")
- `v/<shard>.json` — summaries + HN comments, 256 shards loaded on demand

`public/` is the whole site (plain HTML/CSS/JS). App routes like `/c/<id>` need an SPA fallback to `index.html`
(on Cloudflare Workers this is `not_found_handling: "single-page-application"` in `wrangler.jsonc`).

Security headers (strict CSP with no inline scripts/styles/handlers — only YouTube's IFrame API, embeds and
`i.ytimg.com` thumbnails are allowed — plus nosniff, frame-ancestors/X-Frame-Options, HSTS, COOP) live in
`public/_headers`. Data files keep the default revalidate-every-time caching on purpose: `index.json`, `search.json`,
`similar.json` and the shards refer to each other by row position, so they must never mix across deploys. `npx wrangler dev` serves the site locally with them applied.

Deploy: connect the repo in Cloudflare (Workers & Pages), leave the build command empty and use `npx wrangler deploy`.

```sh
python3 scripts/build_data.py     # needs numpy; re-downloads the export if raw/ is missing
python3 scripts/serve.py 8000     # local server with SPA fallback
```

Optional: put YouTube Data API results in `raw/youtube_meta.jsonl` (`{"vid":…, "item": <videos.list item>}` per line)
to enable durations, view counts, upload dates and the related filters.

## Credits & license

Data: [HackerTube export](https://hackertube.org/data), [ODC-By 1.0](https://opendatacommons.org/licenses/by/1-0/),
derived from [open-index/hacker-news](https://huggingface.co/datasets/open-index/hacker-news). HN comments remain the
work of their authors. Not affiliated with YouTube, Google, Hacker News or Y Combinator.
