#!/usr/bin/env python3
"""Turn the HackerTube data export (raw/) into the static files the site loads (public/data/).

Usage: python3 scripts/build_data.py
Downloads raw/ from hackertube.org if it is missing. If raw/youtube_meta.jsonl exists
(see scripts/fetch_youtube_meta.py) durations, views, likes and publish dates are merged in
and deleted/private videos are dropped.
"""
import io, json, os, shutil, urllib.request, zipfile
from collections import defaultdict

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "raw")
OUT = os.path.join(ROOT, "public", "data")
ZIP_URL = "https://hackertube.org/download/hackertube-data.zip"
SHARDS = 256
NEIGHBORS = 20


def shard_of(vid):
    h = 5381
    for ch in vid:
        h = ((h * 33) ^ ord(ch)) & 0xFFFFFFFF
    return h % SHARDS


def ensure_raw():
    if os.path.exists(os.path.join(RAW, "videos.jsonl")):
        return
    print("downloading", ZIP_URL)
    data = urllib.request.urlopen(ZIP_URL).read()
    os.makedirs(RAW, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        for name in z.namelist():
            if name.endswith("/"):
                continue
            with open(os.path.join(RAW, os.path.basename(name)), "wb") as f:
                f.write(z.read(name))


def jsonl(name):
    with open(os.path.join(RAW, name), encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def iso_seconds(d):
    import re
    m = re.fullmatch(r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", d or "")
    if not m:
        return None
    dd, h, mi, s = (int(x or 0) for x in m.groups())
    return dd * 86400 + h * 3600 + mi * 60 + s


def load_meta():
    path = os.path.join(RAW, "youtube_meta.jsonl")
    if not os.path.exists(path):
        return None
    meta = {}
    for row in jsonl("youtube_meta.jsonl"):
        it = row.get("item")
        if not it or (it.get("status") or {}).get("privacyStatus") == "private":
            meta[row["vid"]] = None
            continue
        st = it.get("statistics") or {}
        meta[row["vid"]] = {
            "dur": iso_seconds((it.get("contentDetails") or {}).get("duration")),
            "views": int(st["viewCount"]) if "viewCount" in st else None,
            "likes": int(st["likeCount"]) if "likeCount" in st else None,
            "pub": (it.get("snippet") or {}).get("publishedAt"),
            "embeddable": (it.get("status") or {}).get("embeddable", True),
        }
    return meta


def write(name, obj):
    path = os.path.join(OUT, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))


def build_playlists(videos, areas, has_meta):
    """Rule-based playlists: the all-time canon, a few cross-cutting lists, and the best of every area."""
    good = [v for v in videos if v["shelf_life"] != "news" and v["hn"]["recommenders"] > 0]
    newest = max(v["hn"]["last_year"] for v in videos)
    lists = []

    def add(slug, title, pitch, tier, picks, n=12):
        seen_titles, out = set(), []
        for v in picks:
            key = "".join(ch for ch in v["title"].lower() if ch.isalnum())[:40]
            if key in seen_titles:
                continue
            seen_titles.add(key)
            out.append(v["vid"])
            if len(out) == n:
                break
        if len(out) >= 4:
            lists.append({"slug": slug, "title": title, "pitch": pitch, "tier": tier, "vids": out})

    best = sorted(good, key=lambda v: -v["score"])
    add("hn-canon", "The HN canon",
        "The videos Hacker News has pointed people to most often, thread after thread and year after year.",
        "start", [v for v in best if v["shelf_life"] == "evergreen"], 15)
    add("talks-every-programmer-should-watch", "Talks every programmer should watch",
        "The conference talks HN tells every developer to watch, whatever language they write.", "start",
        [v for v in best if v["content_type"] in ("talk", "lecture")
         and any(c["area"] in ("software", "systems-security") for c in v["categories"])], 15)
    add("lectures-and-courses", "Lectures & courses",
        "Whole lectures and course material that HN keeps recommending for actually learning a subject.", "start",
        [v for v in best if v["content_type"] in ("lecture", "course", "tutorial")])
    add("documentaries", "Documentaries HN loves",
        "Documentaries that come up again and again in HN threads, from computing history to science.", "start",
        [v for v in best if v["content_type"] == "documentary"])
    add("recently-loved", "Recently loved",
        f"Videos HN has been recommending in {newest - 1}–{newest}, best first.", "start",
        [v for v in best if v["hn"]["last_year"] >= newest - 1])
    add("just-for-fun", "Just for fun",
        "Comedy, satire and music that HN shares when it needs a break.", "start",
        [v for v in best if v["content_type"] in ("comedy", "music")])
    for a in areas:
        add(f"best-of-{a['id']}", a["name"],
            f"The most recommended videos in {a['name']}, ranked by how many separate months HN pointed people to them.",
            "deep", [v for v in best if v["categories"] and v["categories"][0]["area"] == a["id"]])
    return lists


def main():
    ensure_raw()
    videos = jsonl("videos.jsonl")
    meta = load_meta()
    if meta is not None:
        videos = [v for v in videos if meta.get(v["vid"], {}) is not None]
    vids = [v["vid"] for v in videos]
    idx = {vid: i for i, vid in enumerate(vids)}

    tax = json.load(open(os.path.join(RAW, "taxonomy.json"), encoding="utf-8"))
    cat_ids = [c["id"] for a in tax["areas"] for c in a["categories"]]
    cat_idx = {c: i for i, c in enumerate(cat_ids)}
    counts = defaultdict(int)
    area_counts = defaultdict(int)
    for v in videos:
        for c in v["categories"]:
            counts[c["id"]] += 1
        for a in {c["area"] for c in v["categories"]}:
            area_counts[a] += 1
    areas = []
    for a in tax["areas"]:
        cats = sorted(({"id": c["id"], "name": c["name"], "description": c["description"], "count": counts[c["id"]]}
                       for c in a["categories"]), key=lambda c: -c["count"])
        areas.append({"id": a["id"], "name": a["name"], "count": area_counts[a["id"]], "categories": cats})
    areas.sort(key=lambda a: a["name"])

    # index.json: one compact row per video, everything lists, feeds and TV mode need
    fields = ["vid", "title", "channel", "cats", "type", "shelf", "score", "recs", "mentions", "first", "last",
              "topic", "tags", "dur", "views", "likes", "pub"]
    rows = []
    for v in videos:
        m = (meta or {}).get(v["vid"]) or {}
        rows.append([v["vid"], v["title"], v["channel"], [cat_idx[c["id"]] for c in v["categories"] if c["id"] in cat_idx],
                     v["content_type"], v["shelf_life"], v["score"], v["hn"]["recommenders"], v["hn"]["mentions"],
                     v["hn"]["first_year"], v["hn"]["last_year"], v["primary_topic"], v["tags"],
                     m.get("dur"), m.get("views"), m.get("likes"), (m.get("pub") or "")[:10] or None])
    write("index.json", {"generated": tax.get("version"), "has_meta": meta is not None, "fields": fields,
                         "cats": cat_ids, "videos": rows})
    write("taxonomy.json", areas)
    # search.json: extra text for search, loaded on first search
    write("search.json", [[v["summary"], v["why_hn"]] for v in videos])

    # similar.json: per video, up to 20 "up next" picks: co-recommended first, then nearest embeddings
    emb = np.load(os.path.join(RAW, "embeddings.npy")).astype(np.float32)
    emb_ids = json.load(open(os.path.join(RAW, "embedding_ids.json")))
    erow = {v: i for i, v in enumerate(emb_ids)}
    keep = [erow[v] for v in vids]
    E = emb[keep]
    related = {r["vid"]: [x["vid"] for x in r["related"]] for r in jsonl("related.jsonl")}
    similar, corec = [], []
    for start in range(0, len(vids), 512):
        sims = E[start:start + 512] @ E.T
        for j, row in enumerate(sims):
            i = start + j
            row[i] = -1
            top = np.argpartition(-row, NEIGHBORS)[:NEIGHBORS]
            similar.append([int(t) for t in top[np.argsort(-row[top])]])
    for vid in vids:
        corec.append([idx[r] for r in related.get(vid, []) if r in idx][:NEIGHBORS])
    write("similar.json", {"emb": similar, "corec": corec})

    # v/<shard>.json: full card + HN comments for the watch page
    mentions = defaultdict(list)
    for m in jsonl("mentions.jsonl"):
        if m["vid"] in idx:
            mentions[m["vid"]].append({"id": m["hn_comment_id"], "author": m["author"], "ym": m["month"],
                                       "story": m["story_title"], "stance": m["stance"], "text": m["text"]})
    order = {"strong_rec": 0, "rec": 1, "reference": 2, "joke": 3, "critical": 4}
    shards = defaultdict(dict)
    for v in videos:
        cs = sorted(mentions[v["vid"]], key=lambda m: (order.get(m["stance"], 9), m["ym"]))
        shards[shard_of(v["vid"])][v["vid"]] = {
            "summary": v["summary"], "why_hn": v["why_hn"], "level": v["level"], "quote": v.get("quote"),
            "hn": v["hn"], "comments": cs}
    shutil.rmtree(os.path.join(OUT, "v"), ignore_errors=True)
    for s, obj in shards.items():
        write(f"v/{s}.json", obj)

    write("playlists.json", build_playlists(videos, areas, meta is not None))

    write("stats.json", {"videos": len(videos), "comments": sum(len(x) for x in mentions.values()),
                         "categories": len(cat_ids), "areas": len(areas),
                         "first_year": min(v["hn"]["first_year"] for v in videos),
                         "last_year": max(v["hn"]["last_year"] for v in videos)})
    print(f"built {len(videos)} videos, {len(cat_ids)} categories, meta={'yes' if meta else 'no'}")


if __name__ == "__main__":
    main()
