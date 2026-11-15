"use strict";
const $ = (s, el = document) => el.querySelector(s);
const view = $("#view");
const store = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const VID_RE = /^[A-Za-z0-9_-]{11}$/;
const vidList = (k) => { const v = store.get(k, []); return Array.isArray(v) ? v.filter((x) => typeof x === "string" && VID_RE.test(x)) : []; };
let likes = vidList("likes"), dislikes = vidList("dislikes");
let seen = vidList("seen");                 // opened videos, newest last
let watchLater = vidList("later");
let useFrames = store.get("frames", true) !== false;
const seed = Math.floor(Math.random() * 2 ** 31);   // rerolled on every page load

// ---------- data ----------
let V = [], byVid = new Map(), CAT = new Map(), AREAS = [], PLAYLISTS = [], HAS_META = false, STATS = {};
let similar = null, searchText = null;
const shardCache = new Map();
const getJSON = async (p) => { const r = await fetch(p); if (!r.ok) throw new Error(`${r.status} ${p}`); return r.json(); };

async function loadData() {
  const [idx, tax, pls, stats] = await Promise.all([getJSON("/data/index.json"), getJSON("/data/taxonomy.json"),
    getJSON("/data/playlists.json"), getJSON("/data/stats.json")]);
  HAS_META = idx.has_meta; STATS = stats; AREAS = tax; PLAYLISTS = pls;
  for (const a of tax) for (const c of a.categories) CAT.set(c.id, { ...c, area: a.id, areaName: a.name });
  const F = idx.fields;
  V = idx.videos.map((row, i) => {
    const v = { i };
    F.forEach((f, j) => { v[f] = row[j]; });
    v.cats = v.cats.map((c) => idx.cats[c]);
    return v;
  });
  for (const v of V) byVid.set(v.vid, v);
  document.querySelectorAll("[data-meta]").forEach((el) => { el.hidden = !HAS_META; });
}
const loadSimilar = async () => (similar ??= await getJSON("/data/similar.json"));
const loadSearchText = async () => (searchText ??= await getJSON("/data/search.json"));
function shardOf(vid) {
  let h = 5381;
  for (const ch of vid) h = (Math.imul(h, 33) ^ ch.charCodeAt(0)) >>> 0;
  return h % 256;
}
async function detail(vid) {
  const s = shardOf(vid);
  if (!shardCache.has(s)) shardCache.set(s, getJSON(`/data/v/${s}.json`));
  return (await shardCache.get(s))[vid];
}

// ---------- small helpers ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDur = (s) => { if (!s) return ""; const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = Math.floor(s % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`; };
const fmtViews = (n) => n == null ? "" : n >= 1e9 ? `${(n / 1e9).toFixed(1).replace(/\.0$/, "")}B views`
  : n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M views` : n >= 1e3 ? `${Math.round(n / 1e3)}K views` : `${n} views`;
function ago(iso) {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso)) / 1000;
  for (const [u, n] of [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400]]) {
    const k = Math.floor(s / n); if (k >= 1) return `${k} ${u}${k > 1 ? "s" : ""} ago`;
  }
  return "today";
}
const hnLine = (v) => v.recs ? `${v.recs} HN recommender${v.recs === 1 ? "" : "s"}` : `Cited ${v.mentions}× on HN`;
const subLine = (v) => HAS_META ? [fmtViews(v.views), ago(v.pub)].filter(Boolean).join(" • ") : `${hnLine(v)} • ${v.first === v.last ? v.last : `${v.first}–${v.last}`}`;
function mulberry32(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
let toastTimer;
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("on");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("on"), 1800);
}

// ---------- local state ----------
function toggleLater(vid) {
  watchLater = watchLater.includes(vid) ? watchLater.filter((v) => v !== vid) : watchLater.concat(vid);
  store.set("later", watchLater);
  return watchLater.includes(vid);
}
function markSeen(vid) { seen = seen.filter((v) => v !== vid).concat(vid).slice(-300); store.set("seen", seen); }
function toggleLike(vid) {
  const i = likes.indexOf(vid);
  if (i >= 0) likes.splice(i, 1); else { likes.push(vid); dislikes = dislikes.filter((v) => v !== vid); }
  store.set("likes", likes); store.set("dislikes", dislikes);
  return likes.includes(vid);
}
function toggleDislike(vid) {
  const i = dislikes.indexOf(vid);
  if (i >= 0) dislikes.splice(i, 1); else { dislikes.push(vid); likes = likes.filter((v) => v !== vid); }
  store.set("likes", likes); store.set("dislikes", dislikes);
  return dislikes.includes(vid);
}

// ---------- rendering ----------
const CLOCK = '<svg viewBox="0 0 24 24"><path d="M14.97 16.95 10 13.87V7h2v5.76l4.03 2.49-1.06 1.7zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/></svg>';
const CHECK = '<svg viewBox="0 0 24 24"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
const TVICON = '<svg viewBox="0 0 24 24"><path d="M21 4H3a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h7v2H7v1h10v-1h-3v-2h7a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1zm0 13H3V5h18v12zM10 8v6l5-3-5-3z"/></svg>';
const frameSrc = (vid) => `https://i.ytimg.com/vi/${vid}/hq2.jpg`;
const thumbSrc = (vid) => useFrames ? frameSrc(vid) : `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
// hq2 (a frame from the middle) is missing for some videos: fall back to the uploader's thumbnail
document.addEventListener("error", (e) => {
  const img = e.target;
  if (img instanceof HTMLImageElement && VID_RE.test(img.dataset.vid || "") && !img.dataset.fb) {
    img.dataset.fb = 1; img.src = `https://i.ytimg.com/vi/${img.dataset.vid}/hqdefault.jpg`;
  }
}, true);
const laterBtn = (vid) => { const on = watchLater.includes(vid);
  return `<span class="later-btn${on ? " on" : ""}" role="button" tabindex="0" data-later="${vid}" title="${on ? "Saved to Watch later" : "Watch later"}">${on ? CHECK : CLOCK}</span>`; };
const thumb = (v) => `<div class="thumb"><img loading="lazy" src="${thumbSrc(v.vid)}" data-vid="${v.vid}" alt="">${laterBtn(v.vid)}${v.dur ? `<span class="dur">${fmtDur(v.dur)}</span>` : ""}</div>`;
const card = (v) => `<a class="vcard" href="/watch/${v.vid}"${v.reason ? ` title="${esc(v.reason)}"` : ""}>${thumb(v)}
  <h3 class="vt">${esc(v.title)}</h3><div class="sub">${esc(v.channel)}</div><div class="sub">${esc(subLine(v))}</div></a>`;
const row = (v, snip = "") => `<a class="srow" href="/watch/${v.vid}">${thumb(v)}<div class="mw0">
  <h3 class="vt">${esc(v.title)}</h3><div class="sub">${esc(v.channel)} · ${esc(subLine(v))}</div>${snip ? `<div class="snip">${esc(snip)}</div>` : ""}</div></a>`;
const nextRow = (v) => `<a class="next" href="/watch/${v.vid}">${thumb(v)}<div class="mw0">
  <h3 class="vt">${esc(v.title)}</h3><div class="sub">${esc(v.channel)}</div><div class="sub">${esc(subLine(v))}</div></div></a>`;
const tvPill = (label = "TV mode") => `<button class="pill tvpill" data-tv title="Fullscreen, random videos from this page (T)">${TVICON}${label}</button>`;

let pager = null;
function infinite(container, list, render = card, step = 36) {
  if (pager) pager.disconnect();
  if (!list.length) { container.outerHTML = `<div class="status">${filtering(filterParams()) ? "No videos match these filters." : "Nothing here yet."}</div>`; return; }
  let offset = 0;
  const sentinel = document.createElement("div"); sentinel.className = "sentinel";
  container.after(sentinel);
  const more = () => {
    if (offset >= list.length) { pager?.disconnect(); return; }
    container.insertAdjacentHTML("beforeend", list.slice(offset, offset + step).map(render).join(""));
    offset += step;
    if (sentinel.getBoundingClientRect().top < innerHeight + 800) requestAnimationFrame(more);
  };
  pager = new IntersectionObserver((e) => e[0].isIntersecting && more(), { rootMargin: "800px" });
  pager.observe(sentinel);
  more();
}

// ---------- filters ----------
const FILTERS = () => [
  HAS_META && ["Upload date", [["date", "year", "Past year"], ["date", "2020s", "2020s"], ["date", "2010s", "2010s"], ["date", "2000s", "2000s"]]],
  ["Type", [["type", "talk", "Talk"], ["type", "lecture", "Lecture"], ["type", "explainer", "Explainer"], ["type", "tutorial", "Tutorial"],
            ["type", "documentary", "Documentary"], ["type", "interview", "Interview"], ["type", "demo", "Demo"],
            ["type", "commentary", "Commentary"], ["type", "comedy", "Comedy"], ["type", "music", "Music"]]],
  HAS_META && ["Duration", [["dur", "short", "Under 4 minutes"], ["dur", "medium", "4–20 minutes"], ["dur", "long", "20–60 minutes"], ["dur", "xlong", "Over 1 hour"]]],
  ["Features", [HAS_META && ["gems", "1", "Hidden gems"], ["evergreen", "1", "Evergreen only"]].filter(Boolean)],
  ["Sort by", [["sort", "", "Relevance"], ["sort", "recent", "Recently recommended"], HAS_META && ["sort", "date", "Upload date"],
               HAS_META && ["sort", "old", "Oldest first"], HAS_META && ["sort", "views", "View count"],
               HAS_META && ["sort", "liked", "Like ratio"], ["sort", "hn", "Most recommended"]].filter(Boolean)],
].filter(Boolean);
const FILTER_KEYS = ["date", "type", "dur", "gems", "evergreen", "sort"];
let filtersOpen = false;
const filterParams = () => { const u = new URLSearchParams(location.search); return Object.fromEntries(FILTER_KEYS.map((k) => [k, u.get(k) || ""])); };
const withParams = (path, params) => { const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString(); return path + (qs ? `?${qs}` : ""); };
const filtering = (p) => FILTER_KEYS.some((k) => k !== "sort" && p[k]);

function applyFilters(list, p, keepOrder = false) {
  const year = new Date().getFullYear();
  let out = list.filter((v) => {
    if (p.type && v.type !== p.type) return false;
    if (p.evergreen && v.shelf !== "evergreen") return false;
    if (HAS_META) {
      const y = v.pub ? +v.pub.slice(0, 4) : 0;
      if (p.date === "year" && !(v.pub && Date.now() - new Date(v.pub) < 365 * 864e5)) return false;
      if (p.date === "2020s" && y < 2020) return false;
      if (p.date === "2010s" && (y < 2010 || y >= 2020)) return false;
      if (p.date === "2000s" && (y < 2000 || y >= 2010)) return false;
      const d = v.dur || 0;
      if (p.dur === "short" && !(d && d < 240)) return false;
      if (p.dur === "medium" && !(d >= 240 && d < 1200)) return false;
      if (p.dur === "long" && !(d >= 1200 && d < 3600)) return false;
      if (p.dur === "xlong" && !(d >= 3600)) return false;
      if (p.gems && !(v.recs >= 2 && v.views != null && v.views < 100000)) return false;
    }
    return true;
  });
  const by = (f) => out.sort((a, b) => f(b) - f(a) || b.score - a.score);
  const t = (v) => v.pub ? Date.parse(v.pub) : 0;
  if (p.sort === "recent") by((v) => v.last);
  else if (p.sort === "date") by(t);
  else if (p.sort === "old") out.sort((a, b) => (t(a) || 9e15) - (t(b) || 9e15));
  else if (p.sort === "views") by((v) => v.views || 0);
  else if (p.sort === "liked") by((v) => v.views > 1000 ? (v.likes || 0) / v.views : 0);
  else if (p.sort === "hn") by((v) => v.recs);
  else if (!keepOrder) by((v) => v.score);
  void year;
  return out;
}

function filterBar(path, p, { listing = true, playable = true, tv = true } = {}) {
  const link = (k, v) => withParams(path, { ...p, [k]: p[k] === v ? "" : v });
  const groups = FILTERS().map(([title, opts]) => [title, !listing || title !== "Sort by" ? opts
    : opts.filter(([, v]) => v !== "hn").map(([k, v, l]) => [k, v, v ? l : "Best first"])]);
  const active = groups.flatMap(([, opts]) => opts.filter(([k, v]) => v && p[k] === v)
    .map(([k, v, l]) => `<a class="chip on" href="${esc(link(k, v))}" title="Remove filter">${l}<span>×</span></a>`));
  return `<div class="filterbar">
      <button class="pill${filtersOpen ? " on" : ""}" id="filters-btn"><svg viewBox="0 0 24 24"><path d="M15 17h6v1h-6v-1zm-4 0H3v1h8v2h1v-5h-1v2zm3-9h1V3h-1v2H3v1h11v2zm4-3v1h3V5h-3zM6 14h1V9H6v2H3v1h3v2zm4-2h11v-1H10v1z"/></svg>Filters</button>
      ${active.join("")}<span class="grow"></span>${tv ? tvPill() : ""}${playable ? playAll() : ""}</div>
    <div class="filters"${filtersOpen ? "" : " hidden"}>${groups.map(([title, opts]) => `<div><h4>${title}</h4>
      ${opts.map(([k, v, l]) => `<a href="${esc(link(k, v))}" class="${(p[k] || "") === v ? "on" : ""}">${l}</a>`).join("")}</div>`).join("")}</div>`;
}
const playAll = () => `<a class="pill playall" href="https://www.youtube.com/" target="_blank" rel="noopener" title="Open the videos on this page as a playlist on YouTube"><svg viewBox="0 0 24 24"><path d="M3 5h12v2H3zm0 4h12v2H3zm0 4h8v2H3zm12 0v8l6-4z"/></svg>Play all on YouTube</a>`;
function wireFilterBar() {
  const a = $(".playall");
  if (a) a.onclick = () => {
    const ids = [...new Set([...view.querySelectorAll(".thumb img[data-vid]")].map((i) => i.dataset.vid))].slice(0, 50);
    if (!ids.length) return false;
    a.href = `https://www.youtube.com/watch_videos?video_ids=${ids.join(",")}`;
  };
  const b = $("#filters-btn");
  if (b) b.onclick = () => { filtersOpen = !filtersOpen; $(".filters").hidden = !filtersOpen; b.classList.toggle("on", filtersOpen); };
  for (const l of view.querySelectorAll(".filters a")) l.addEventListener("click", () => { filtersOpen = false; });
}

// ---------- Home feed ----------
// Weighted random order without replacement (Efraimidis–Spirakis): weight = HN score, boosted by likes,
// recency, hidden gems and a few unexplored topics; seeded per page load so scrolling and "back" keep it.
let feedCache = null;
async function buildFeed() {
  if (feedCache?.key === `${seed}|${likes}|${dislikes}`) return feedCache.list;
  const rng = mulberry32(seed);
  const seenSet = new Set(seen), dis = new Set(dislikes);
  const boost = new Map();
  const addBoost = (i, f, why) => { const b = boost.get(i); if (!b || b.f < f) boost.set(i, { f, why }); };
  if (likes.length || dislikes.length) {
    const sim = await loadSimilar();
    for (const vid of likes.slice(-30)) {
      const v = byVid.get(vid); if (!v) continue;
      for (const j of sim.corec[v.i]) addBoost(j, 6, `HN people who recommend “${v.title}” also recommend this`);
      for (const j of sim.emb[v.i].slice(0, 12)) addBoost(j, 5, `Similar to “${v.title}”, which you liked`);
    }
    for (const vid of dislikes) { const v = byVid.get(vid); if (v) for (const j of sim.emb[v.i].slice(0, 10)) addBoost(j, 0.3, ""); }
  }
  const explored = new Set([...seen, ...likes].flatMap((vid) => byVid.get(vid)?.cats || []));
  const fresh = [...CAT.keys()].filter((c) => !explored.has(c));
  const explore = new Set(fresh.sort(() => rng() - .5).slice(0, 8));
  const newest = STATS.last_year;
  const keyed = [];
  for (const v of V) {
    if (seenSet.has(v.vid) || dis.has(v.vid)) continue;
    let w = Math.pow(v.score + 1, 1.3), why = v.score >= 12 ? `An HN classic: recommended in ${v.score | 0}+ different months` : `${hnLine(v)}`;
    if (v.shelf === "news" || v.type === "news") w *= 0.05;
    if (!v.recs) w *= 0.3;
    const b = boost.get(v.i);
    if (b) { w *= b.f; if (b.why) why = b.why; }
    else if (HAS_META && v.recs >= 2 && v.views != null && v.views < 100000) { w *= 2.5; why = `Hidden gem: ${hnLine(v)}, under 100K views`; }
    else if (v.last >= newest - 1 && v.recs) { w *= 1.6; why = `Recently recommended on HN (${v.last})`; }
    else if (v.cats.some((c) => explore.has(c))) { w *= 2; why = `Something different: ${CAT.get(v.cats.find((c) => explore.has(c))).name}`; }
    keyed.push([-Math.log(rng()) / w, v, why]);
  }
  keyed.sort((a, b) => a[0] - b[0]);
  const list = keyed.map(([, v, why]) => ({ ...v, reason: why }));
  feedCache = { key: `${seed}|${likes}|${dislikes}`, list };
  return list;
}

// ---------- pages ----------
let current = { label: "All videos", list: null };   // what TV mode plays from
function setContext(label, list) { current = { label, list }; }

async function home() {
  view.innerHTML = `${filterBar("/browse", filterParams(), { playable: false })}<div class="grid" id="grid"></div>`;
  wireFilterBar();
  const list = await buildFeed();
  setContext("Home · all categories", list);
  infinite($("#grid"), list);
}

async function category(id) {
  const c = CAT.get(id);
  if (!c) return notFound();
  document.title = `${c.name} - RabbitHoleTV`;
  const p = filterParams();
  const list = applyFilters(V.filter((v) => v.cats.includes(id)), p);
  setContext(c.name, list);
  view.innerHTML = `<div class="pagehead"><a class="crumb" href="/a/${esc(c.area)}">${esc(c.areaName)}</a><h2>${esc(c.name)}</h2>
    <p class="sub">${esc(c.description)}</p></div>${filterBar(`/c/${id}`, p)}<div class="grid" id="grid"></div>`;
  wireFilterBar();
  infinite($("#grid"), list);
}

async function area(id) {
  const a = AREAS.find((x) => x.id === id);
  if (!a) return notFound();
  document.title = `${a.name} - RabbitHoleTV`;
  const p = filterParams();
  const list = applyFilters(V.filter((v) => v.cats.some((c) => CAT.get(c)?.area === id)), p);
  setContext(a.name, list);
  view.innerHTML = `<div class="pagehead"><a class="crumb" href="/categories">Categories</a><h2>${esc(a.name)}</h2></div>
    <div class="catwrap">${a.categories.map((c) => `<a class="chip" href="/c/${esc(c.id)}">${esc(c.name)}</a>`).join("")}</div>
    ${filterBar(`/a/${id}`, p)}<div class="grid" id="grid"></div>`;
  wireFilterBar();
  infinite($("#grid"), list);
}

async function browsePage() {
  const p = filterParams(), longs = p.dur === "xlong";
  document.title = `${longs ? "Longs" : "All videos"} - RabbitHoleTV`;
  const list = applyFilters(V, p);
  setContext(longs ? "Longs" : "All videos", list);
  view.innerHTML = `<div class="pagehead"><h2>${longs ? "Longs" : "All videos"}</h2>${longs ? `<p class="sub">Every video over an hour. The opposite of Shorts.</p>` : ""}</div>
    ${filterBar("/browse", p)}<div class="grid" id="grid"></div>`;
  wireFilterBar();
  infinite($("#grid"), list);
}

async function categoriesPage() {
  document.title = "Categories - RabbitHoleTV";
  setContext("All videos", null);
  view.innerHTML = `<div class="explore"><div class="pagehead"><h2>Categories</h2></div>
    <div class="quick"><a class="pill" href="/browse?sort=recent">Recently recommended</a>
      ${HAS_META ? `<a class="pill" href="/browse?dur=xlong">Longs</a><a class="pill" href="/browse?gems=1">Hidden gems</a>` : ""}
      <a class="pill" href="/browse">All videos</a></div>
    <div class="areas">${AREAS.map((a) => `<section class="areacard">
      <a class="areaname" href="/a/${esc(a.id)}">${esc(a.name)}<span class="count">${a.count}</span></a>
      <div class="cats">${a.categories.map((c) => `<a href="/c/${esc(c.id)}">${esc(c.name)}<span class="count">${c.count}</span></a>`).join("")}</div>
    </section>`).join("")}</div></div>`;
}

const plVideos = (pl) => pl.vids.map((vid) => byVid.get(vid)).filter(Boolean);
const plMinutes = (vs) => Math.round(vs.reduce((s, v) => s + (v.dur || 0), 0) / 60);
const hours = (m) => m >= 60 ? `${Math.floor(m / 60)} hr ${m % 60} min` : `${m} min`;
const plMeta = (vs) => `${vs.length} videos${HAS_META ? ` · ${hours(plMinutes(vs))}` : ""}`;
const plCard = (pl) => { const vs = plVideos(pl); return `<a class="plcard" href="/p/${esc(pl.slug)}">
  <div class="mosaic">${vs.slice(0, 4).map((v) => `<img loading="lazy" src="${thumbSrc(v.vid)}" data-vid="${v.vid}" alt="">`).join("")}
  <span class="plcount">${plMeta(vs)}</span></div><h3 class="vt">${esc(pl.title)}</h3><p class="sub">${esc(pl.pitch)}</p></a>`; };

function playlistsPage() {
  document.title = "Playlists - RabbitHoleTV";
  setContext("All videos", null);
  view.innerHTML = `<div class="explore"><div class="pagehead"><h2>Playlists</h2>
    <p class="sub">Built from what Hacker News recommends, best first.</p></div>
    ${[["start", "Start here", "Broad lists for your first visit."], ["deep", "Best of each area", "The most recommended videos in every topic area."]]
      .map(([tier, title, blurb]) => `<h3 class="sechead">${title}</h3><p class="sub">${blurb}</p>
        <div class="pgrid">${PLAYLISTS.filter((p) => p.tier === tier).map(plCard).join("")}</div>`).join("")}</div>`;
}

function playlistPage(slug) {
  const pl = PLAYLISTS.find((p) => p.slug === slug);
  if (!pl) return notFound();
  const vs = plVideos(pl);
  document.title = `${pl.title} - RabbitHoleTV`;
  setContext(pl.title, vs);
  view.innerHTML = `<div class="plpage"><div class="plhead">
    <div class="mosaic">${vs.slice(0, 4).map((v) => `<img src="${thumbSrc(v.vid)}" data-vid="${v.vid}" alt="">`).join("")}</div>
    <div><a class="crumb" href="/playlists">Playlists</a><h2>${esc(pl.title)}</h2><div class="sub">${plMeta(vs)}</div>
      <p class="intro">${esc(pl.pitch)}</p><div class="filterbar">${tvPill()}${playAll()}</div></div></div>
    <ol class="plrows">${vs.map((v, i) => `<li><span class="num">${i + 1}</span>${row(v)}</li>`).join("")}</ol></div>`;
  wireFilterBar();
}

function savedPage(title, vids, empty, extra = "") {
  const list = vids.slice().reverse().map((vid) => byVid.get(vid)).filter(Boolean);
  setContext(title, list);
  view.innerHTML = `<div class="pagehead"><h2>${title}</h2>${extra}</div>
    ${list.length ? `<div class="filterbar">${tvPill()}${playAll()}</div><div class="grid">${list.map(card).join("")}</div>` : `<div class="status">${empty}</div>`}`;
  wireFilterBar();
}
const liked = () => savedPage("Liked videos", likes, "Videos you like will show up here, and shape your Home feed.");
const later = () => savedPage("Watch later", watchLater, "Save videos with the clock button on a thumbnail or on a video's page.");
function historyPage() {
  savedPage("History", seen, "Videos you open will show up here.", seen.length ? `<p><button class="pill" id="clear-history">Clear all watch history</button></p>` : "");
  const b = $("#clear-history");
  if (b) b.onclick = () => { seen = []; store.set("seen", seen); historyPage(); };
}

// ---------- search ----------
let hay = null;
const STOP = new Set("a an the of and or to in on for with how why what is are video videos about".split(" "));
const words = (s) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}+#]+/gu, " ").split(" ").filter(Boolean);
async function searchIndex() {
  if (hay) return hay;
  const extra = await loadSearchText();
  hay = V.map((v, i) => ({
    title: " " + words(v.title).join(" ") + " ",
    chan: " " + words(v.channel).join(" ") + " ",
    tags: " " + words([v.topic, ...v.tags].join(" ")).join(" ") + " ",
    cats: " " + words(v.cats.map((c) => CAT.get(c)?.name || "").join(" ")).join(" ") + " ",
    catd: " " + words(v.cats.map((c) => CAT.get(c)?.description || "").join(" ")).join(" ") + " ",
    text: " " + words(extra[i].join(" ")).join(" ") + " ",
  }));
  return hay;
}
async function runSearch(q, p) {
  const H = await searchIndex();
  const terms = words(q).filter((t) => !STOP.has(t));
  if (!terms.length) return { results: [], weak: true };
  const phrase = " " + terms.join(" ") + " ";
  const W = { title: 4, chan: 3, tags: 2.5, cats: 1.5, catd: 0.6, text: 1 };
  const scored = [];
  V.forEach((v, i) => {
    const h = H[i]; let s = 0, hit = 0;
    for (const t of terms) {
      let best = 0;
      for (const f in W) {
        const x = h[f];
        if (x.includes(" " + t + " ")) best += W[f];
        else if (t.length > 2 && x.includes(" " + t)) best += W[f] * 0.6;
      }
      if (best) hit++;
      s += best;
    }
    if (!hit) return;
    if (terms.length > 1 && h.title.includes(phrase)) s += 6;
    else if (terms.length > 1 && (h.tags.includes(phrase) || h.text.includes(phrase))) s += 3;
    s *= (hit / terms.length) ** 2 * (1 + Math.log1p(v.score) * 0.35) * (v.shelf === "news" ? 0.7 : 1);
    scored.push([s, v, hit === terms.length]);
  });
  scored.sort((a, b) => b[0] - a[0]);
  const strong = scored.filter((x) => x[2]);
  const weak = strong.length < 3;
  const base = (weak ? scored : strong).slice(0, 200).map((x) => x[1]);
  return { results: applyFilters(base, p, true).slice(0, 80), weak };
}
async function search(q) {
  $("#q").value = q;
  document.title = `${q} - RabbitHoleTV`;
  const p = filterParams();
  view.innerHTML = `<div class="status">Searching…</div>`;
  const res = await runSearch(q, p);
  setContext(`Search: ${q}`, res.results);
  const snips = await loadSearchText();
  view.innerHTML = filterBar(`/search/${encodeURIComponent(q)}`, p, { listing: false })
    + (res.weak && !res.results.length ? `<div class="note">No videos match “${esc(q)}”.</div>`
      : res.weak ? `<div class="note">No strong matches for “${esc(q)}”. Here are the closest videos.</div>` : "")
    + `<div class="results">${res.results.map((v) => row(v, snips[v.i][0])).join("")}</div>`;
  wireFilterBar();
}

// ---------- watch ----------
let ytReady = null, watchPlayer = null;
function loadYT() {
  ytReady ??= new Promise((res) => {
    window.onYouTubeIframeAPIReady = res;
    const s = document.createElement("script"); s.src = "https://www.youtube.com/iframe_api"; document.head.append(s);
  });
  return ytReady;
}
const commentHTML = (t) => esc(t).replace(/\[VIDEO\]/g, '<span class="mk v">▶ this video</span>').replace(/\[LINK\]/g, '<span class="mk">link</span>');
const STANCE = { strong_rec: "Strongly recommends", rec: "Recommends", reference: "Cites", joke: "Joke", critical: "Critical" };

async function upNext(v, n = 20) {
  const sim = await loadSimilar();
  const dis = new Set(dislikes), out = [], used = new Set([v.i]);
  // mostly similar-by-content, with every third slot from "the same HN people also recommended"
  const emb = sim.emb[v.i], co = sim.corec[v.i], mix = [];
  for (let a = 0, b = 0; a < emb.length || b < co.length;) {
    if (a < emb.length) mix.push(emb[a++]);
    if (a < emb.length) mix.push(emb[a++]);
    if (b < co.length) mix.push(co[b++]);
  }
  for (const j of mix) {
    if (used.has(j) || dis.has(V[j].vid)) continue;
    used.add(j); out.push(V[j]);
    if (out.length === n) break;
  }
  return out;
}

async function watch(vid) {
  const v = byVid.get(vid);
  if (!v) return notFound();
  document.title = `${v.title} - RabbitHoleTV`;
  markSeen(vid);
  const primary = CAT.get(v.cats[0]);
  setContext(primary ? primary.name : "All videos", primary ? V.filter((x) => x.cats.includes(primary.id)) : null);
  current.first = v;
  view.innerHTML = `<div class="watch"><div class="primary">
      <div class="player" id="player"><button class="poster" id="poster" aria-label="Play">
        <img src="${useFrames ? frameSrc(vid) : thumbSrc(vid)}" data-vid="${vid}" alt="">
        <span class="play"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span></button></div>
      <h1>${esc(v.title)}</h1>
      <div class="owner"><div class="mw0"><b>${esc(v.channel)}</b><span class="sub" id="recline">${esc(hnLine(v))}</span></div>
        <div class="actions">
          <div class="seg">
            <button id="like" class="${likes.includes(vid) ? "on" : ""}" aria-label="Like"><svg viewBox="0 0 24 24"><path d="M18.77 11h-4.23l1.52-4.94C16.38 5.03 15.54 4 14.38 4c-.58 0-1.14.24-1.52.65L7 11H3v10h14.43c1.06 0 1.98-.67 2.19-1.61l1.34-6c.27-1.24-.78-2.39-2.19-2.39zM7 20H4v-8h3v8z"/></svg><span>Like</span></button>
            <button id="dislike" class="${dislikes.includes(vid) ? "on" : ""}" aria-label="Dislike"><svg viewBox="0 0 24 24"><path d="M17 4H6.57c-1.07 0-1.98.67-2.19 1.61l-1.34 6C2.77 12.85 3.82 14 5.23 14h4.23l-1.52 4.94C7.62 19.97 8.46 21 9.62 21c.58 0 1.14-.24 1.52-.65L17 14h4V4h-4zm-6.6 15.67c-.19.21-.48.33-.78.33-.26 0-.5-.11-.63-.3-.07-.1-.15-.26-.09-.47l1.52-4.94.4-1.29H5.23c-.41 0-.8-.17-1.03-.46-.12-.15-.25-.4-.18-.72l1.34-6c.1-.47.61-.82 1.21-.82H16v8.61l-5.6 6.06zM20 13h-3V5h3v8z"/></svg></button>
          </div>
          <button class="pill" id="save-later">${watchLater.includes(vid) ? CHECK + "Saved" : CLOCK + "Watch later"}</button>
          ${tvPill(primary ? `TV: ${primary.name}` : "TV mode")}
          <a class="pill" href="https://www.youtube.com/watch?v=${vid}" target="_blank" rel="noopener">YouTube ↗</a>
        </div></div>
      <div class="desc" id="desc"><div class="status">Loading…</div></div>
      <div class="comments" id="comments"></div>
    </div><div class="secondary" id="upnext"></div></div>`;
  $("#like").onclick = () => { const on = toggleLike(vid); $("#like").classList.toggle("on", on); $("#dislike").classList.remove("on"); };
  $("#dislike").onclick = () => { const on = toggleDislike(vid); $("#dislike").classList.toggle("on", on); $("#like").classList.remove("on"); };
  $("#save-later").onclick = () => { $("#save-later").innerHTML = toggleLater(vid) ? CHECK + "Saved" : CLOCK + "Watch later"; };
  $("#poster").onclick = () => playInline(vid);
  const [d, next] = await Promise.all([detail(vid), upNext(v)]);
  if (location.pathname !== `/watch/${vid}`) return;
  const hn = d.hn;
  $("#recline").textContent = hn.recommenders
    ? `${hn.recommenders} HN recommender${hn.recommenders === 1 ? "" : "s"} · recommended in ${hn.rec_months} month${hn.rec_months === 1 ? "" : "s"}, ${hn.first_year}–${hn.last_year}`
    : `Cited ${hn.mentions}× on HN, ${hn.first_year}–${hn.last_year}`;
  $("#desc").innerHTML = `<div class="top-line">${[fmtViews(v.views), ago(v.pub), v.type, v.shelf].filter(Boolean).map(esc).join(" · ")}</div>
    <p>${esc(d.summary)}</p><p class="why">${esc(d.why_hn)}</p>
    <div class="tags">${v.cats.map((c) => `<a class="tag cat" href="/c/${esc(c)}">${esc(CAT.get(c)?.name || c)}</a>`).join("")}
      ${v.tags.map((t) => `<a class="tag" href="/search/${esc(encodeURIComponent(t))}">#${esc(t.replace(/\s+/g, ""))}</a>`).join("")}</div>`;
  $("#comments").innerHTML = `<h2>${d.comments.length} comment${d.comments.length === 1 ? "" : "s"} from Hacker News</h2>
    ${d.comments.map((m) => `<div class="cmt"><div class="meta"><b>@${esc(m.author)}</b>${esc(m.ym.slice(0, 4))} · in “${esc(m.story)}”</div>
      <p>${commentHTML(m.text)}</p><div class="foot"><span class="stance ${esc(m.stance)}">${esc(STANCE[m.stance] || m.stance)}</span>
      <a href="https://news.ycombinator.com/item?id=${Number(m.id) || ""}" target="_blank" rel="noopener">View on HN</a></div></div>`).join("")}`;
  $("#upnext").innerHTML = next.map(nextRow).join("");
}
function playInline(vid) {
  $("#player").innerHTML = `<div id="ytwatch"></div>`;
  loadYT().then(() => {
    if (!$("#ytwatch")) return;
    watchPlayer = new YT.Player("ytwatch", { host: "https://www.youtube-nocookie.com", videoId: vid,
      playerVars: { autoplay: 1, rel: 0, playsinline: 1 }, events: { onReady: (e) => e.target.playVideo() } });
  });
}

// ---------- about / settings ----------
function about() {
  document.title = "About - RabbitHoleTV";
  setContext("All videos", null);
  const f = (n) => Number(n).toLocaleString("en-US");
  view.innerHTML = `<article class="about">
    <h1>RabbitHole<span class="accent">TV</span></h1>
    <p class="lede">The YouTube videos that Hacker News keeps telling each other to watch, plus a lean-back TV mode.</p>
    <div class="stats">
      <div class="stat"><b>${f(STATS.videos)}</b><span>videos</span></div>
      <div class="stat"><b>${f(STATS.comments)}</b><span>HN comments</span></div>
      <div class="stat"><b>${f(STATS.categories)}</b><span>topics in ${STATS.areas} areas</span></div>
      <div class="stat"><b>${STATS.first_year}–${STATS.last_year}</b><span>years of HN</span></div>
    </div>
    <h2>TV mode</h2>
    <p>Press <kbd>T</kbd> or the <b>TV</b> button and it goes fullscreen and plays one random video after another, forever,
      with no clicking. It plays from <b>whatever you're looking at</b>: on a category page it only picks videos from that
      category, on an area page from that area, on a playlist from that playlist, on a search from the results, and filters
      (type, evergreen…) are respected. On a video page it continues that video, then keeps going in its category. On Home it
      picks from everything, better-recommended videos more often. Add <code>?tv=1</code> to any URL to start TV mode on load.</p>
    <p><kbd>N</kbd> next · <kbd>P</kbd> previous · <kbd>Space</kbd> pause · <kbd>←</kbd>/<kbd>→</kbd> ±10s ·
      <kbd>1</kbd>–<kbd>9</kbd> jump to 10–90% · <kbd>M</kbd> mute · <kbd>L</kbd> like · <kbd>F</kbd> fullscreen · <kbd>Esc</kbd> exit</p>
    <h2>Everything else</h2>
    <ul>
      <li><b>Home</b> is a fresh random mix on every visit, weighted toward the videos HN recommended most, with recent favorites,
        hidden corners and topics you haven't explored yet. Once you like a few videos it mixes in similar ones and ones the same HN
        people also recommended. Hover a card to see why it's there.</li>
      <li><b>Every video page</b> shows what Hacker News actually said about it, with links back to the threads.</li>
      <li><b>Like</b>, <b>Watch later</b> and <b>History</b> live only in this browser. No accounts, no tracking.</li>
      <li>Press <kbd>?</kbd> for keyboard shortcuts.</li>
    </ul>
    <h2>Credits & data</h2>
    <p>A remake of <a href="https://hackertube.org" target="_blank" rel="noopener">HackerTube</a> by
      <a href="https://x.com/karpathy" target="_blank" rel="noopener">@karpathy</a>, built on its
      <a href="https://hackertube.org/data" target="_blank" rel="noopener">open data export</a>
      (<a href="https://opendatacommons.org/licenses/by/1-0/" target="_blank" rel="noopener">ODC-By 1.0</a>), which is derived from the
      <a href="https://huggingface.co/datasets/open-index/hacker-news" target="_blank" rel="noopener">open-index/hacker-news</a> archive.
      TV mode is modeled on <a href="https://karpathy.ai/tristan-tube/" target="_blank" rel="noopener">TristanTube</a>.
      Comments remain the work of their authors; labels and summaries were written by an LLM, so expect a few to be off.</p>
    <p class="fine">Not affiliated with YouTube, Google, Hacker News or Y Combinator. Videos play through YouTube's embedded player.</p>
  </article>`;
}
function settings() {
  document.title = "Settings - RabbitHoleTV";
  setContext("All videos", null);
  view.innerHTML = `<div class="settings"><div class="pagehead"><h2>Settings</h2></div>
    <label class="setting"><div><b>Show video frames instead of thumbnails</b>
      <p>Thumbnails are designed to grab attention. With this on, each video shows a frame from its middle instead.</p></div>
      <span class="switch"><input type="checkbox" id="frames-toggle" ${useFrames ? "checked" : ""}><span class="knob"></span></span></label>
    <label class="setting"><div><b>TV mode: skip news-only videos</b>
      <p>Leave out videos that only mattered around one event.</p></div>
      <span class="switch"><input type="checkbox" id="tvnews-toggle" ${store.get("tvSkipNews", true) ? "checked" : ""}><span class="knob"></span></span></label>
  </div>`;
  $("#frames-toggle").onchange = (e) => { useFrames = e.target.checked; store.set("frames", useFrames); };
  $("#tvnews-toggle").onchange = (e) => store.set("tvSkipNews", e.target.checked);
}
function notFound() { view.innerHTML = `<div class="status">Not found.</div>`; }

// ---------- TV mode ----------
// One persistent fullscreen player. The pool is whatever the current page shows; picks are random, weighted
// gently toward better-recommended videos, without repeats until the pool runs out.
const tv = { open: false, player: null, ready: false, hist: [], pos: -1, pool: [], played: new Set(), label: "",
             uiTimer: 0, toastTimer: 0, tick: 0, wentFull: false, auto: false };

function tvPool() {
  let list = current.list || V;
  if (store.get("tvSkipNews", true)) { const f = list.filter((v) => v.shelf !== "news"); if (f.length) list = f; }
  return list.length ? list : V;
}
function tvPick() {
  let cand = tv.pool.filter((v) => !tv.played.has(v.vid));
  if (!cand.length) { tv.played.clear(); cand = tv.pool; }
  if (cand.length > 1 && tvCurrent()) cand = cand.filter((v) => v !== tvCurrent());
  let total = 0;
  const w = cand.map((v) => (total += Math.sqrt(v.score + 1)));
  const r = Math.random() * total;
  return cand[w.findIndex((x) => x >= r)] || cand[0];
}
const tvCurrent = () => tv.hist[tv.pos];

function tvOpen({ auto = false } = {}) {
  if (tv.open || !V.length) return;
  const el = $("#tv");
  if (!auto && el.requestFullscreen) el.requestFullscreen().then(() => { tv.wentFull = true; }).catch(() => {});
  let first = null, startAt = 0;
  if (location.pathname.startsWith("/watch/") && current.first) {
    first = current.first;
    try { startAt = Math.floor(watchPlayer?.getCurrentTime?.() || 0); watchPlayer?.pauseVideo?.(); } catch {}
  }
  Object.assign(tv, { open: true, ready: false, pool: tvPool(), label: current.label, played: new Set(), hist: [], pos: -1, wentFull: false, auto });
  first ??= tvPick();
  tv.hist = [first]; tv.pos = 0; tv.played.add(first.vid);
  document.activeElement?.blur?.();
  el.classList.add("open");
  document.body.style.overflow = "hidden";
  $("#tvScope").textContent = `${tv.label} · ${tv.pool.length.toLocaleString()} video${tv.pool.length === 1 ? "" : "s"}`;
  for (let d = 1; d <= 9; d++) { const b = document.createElement("b"); b.style.left = `${d * 10}%`; $("#tvBar").append(b); }
  tvRenderInfo(); tvShowUI(6000);
  markSeen(first.vid);
  loadYT().then(() => {
    if (!tv.open) return;
    tv.player = new YT.Player("tvplayer", {
      host: "https://www.youtube-nocookie.com", videoId: first.vid,
      playerVars: { autoplay: 1, controls: 0, disablekb: 1, rel: 0, playsinline: 1, iv_load_policy: 3, fs: 0, start: startAt },
      events: {
        onReady: (e) => {
          tv.ready = true; e.target.playVideo();
          // browsers block unmuted autoplay without a click (e.g. ?tv=1): fall back to muted
          setTimeout(() => {
            if (tv.open && tv.ready && tv.player.getPlayerState() !== YT.PlayerState.PLAYING) {
              tv.player.mute(); tv.player.playVideo(); tvToast("Muted · press M for sound", 2500);
            }
          }, 1500);
        },
        onStateChange: (e) => { if (e.data === YT.PlayerState.ENDED) tvNext(); },
        onError: () => { tvToast("Can't play this one, skipping…", 1400); setTimeout(() => tv.open && tvNext(), 1500); },
      },
    });
  });
  tv.tick = setInterval(tvUpdateBar, 250);
}
function tvClose() {
  if (!tv.open) return;
  tv.open = false;
  clearInterval(tv.tick); clearTimeout(tv.uiTimer); clearTimeout(tv.toastTimer);
  try { tv.player?.destroy(); } catch {}
  tv.player = null; tv.ready = false;
  const el = $("#tv");
  el.classList.remove("open", "show-ui");
  $(".tvplayer", el).innerHTML = `<div id="tvplayer"></div>`;
  $("#tvBar").innerHTML = "<i></i>";
  document.body.style.overflow = "";
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  if (new URLSearchParams(location.search).has("tv")) {
    const u = new URL(location.href); u.searchParams.delete("tv"); history.replaceState(null, "", u.pathname + u.search);
  }
}
function tvLoad() {
  const v = tvCurrent();
  tv.played.add(v.vid); markSeen(v.vid);
  if (tv.ready) tv.player.loadVideoById(v.vid);
  tvRenderInfo(); tvShowUI(4000);
}
function tvNext() {
  if (tv.pos < tv.hist.length - 1) tv.pos++;
  else { tv.hist.push(tvPick()); tv.pos = tv.hist.length - 1; }
  tvLoad();
}
function tvPrev() { if (tv.pos > 0) { tv.pos--; tvLoad(); } else tvToast("That's the first one"); }
async function tvRenderInfo() {
  const v = tvCurrent();
  $("#tvTitle").textContent = v.title;
  const cats = v.cats.map((c) => CAT.get(c)?.name).filter(Boolean).slice(0, 2).join(", ");
  $("#tvChan").innerHTML = [esc(v.channel), esc(hnLine(v)), esc(cats), fmtViews(v.views), likes.includes(v.vid) ? "♥ Liked" : ""].filter(Boolean).join(" · ");
  $("#tvDur").textContent = fmtDur(v.dur) || "0:00";
  $("#tvCur").textContent = "0:00";
  $("#tvBar i").style.width = "0";
  $("#tv .quote")?.remove();
  const d = await detail(v.vid).catch(() => null);
  if (d?.quote?.text && tvCurrent() === v) $("#tvChan").insertAdjacentHTML("afterend", `<div class="quote">“${esc(d.quote.text)}” — HN, ${esc(d.quote.year)}</div>`);
}
function tvUpdateBar() {
  if (!tv.ready || !$("#tv").classList.contains("show-ui")) return;
  try {
    const cur = tv.player.getCurrentTime() || 0, dur = tv.player.getDuration() || tvCurrent().dur || 0;
    $("#tvCur").textContent = fmtDur(cur) || "0:00";
    if (dur) { $("#tvDur").textContent = fmtDur(dur); $("#tvBar i").style.width = Math.min(100, cur / dur * 100) + "%"; }
  } catch {}
}
function tvShowUI(ms = 3000) {
  const el = $("#tv");
  el.classList.add("show-ui"); tvUpdateBar();
  clearTimeout(tv.uiTimer); tv.uiTimer = setTimeout(() => el.classList.remove("show-ui"), ms);
}
function tvToast(msg, ms = 900) {
  const t = $("#tvToast"); t.textContent = msg; t.classList.add("on");
  clearTimeout(tv.toastTimer); tv.toastTimer = setTimeout(() => t.classList.remove("on"), ms);
}
function tvTogglePause() {
  if (!tv.ready) return;
  const playing = tv.player.getPlayerState() === YT.PlayerState.PLAYING;
  playing ? tv.player.pauseVideo() : tv.player.playVideo();
  tvToast(playing ? "❚❚" : "▶"); tvShowUI(playing ? 600000 : 2500);
}
function tvSeek(seconds, label) {
  if (!tv.ready) return;
  const dur = tv.player.getDuration() || 0;
  tv.player.seekTo(Math.max(0, Math.min(dur ? dur - 1 : seconds, seconds)), true);
  if (tv.player.getPlayerState() !== YT.PlayerState.PLAYING) tv.player.playVideo();
  tvToast(label); tvShowUI(2500);
}
function tvFullscreen() {
  const el = $("#tv");
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else el.requestFullscreen?.().then(() => { tv.wentFull = true; }).catch(() => {});
}
function tvKey(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key;
  let handled = true;
  if (/^[0-9]$/.test(k)) { const d = +k, dur = tv.ready ? tv.player.getDuration() : 0; tvSeek(dur * d / 10, d === 0 ? "⏮ Start" : `${d * 10}%`); }
  else if (k === "n" || k === "N" || k === "PageDown" || k === "MediaTrackNext") tvNext();
  else if (k === "p" || k === "P" || k === "PageUp" || k === "MediaTrackPrevious") tvPrev();
  else if (k === " " || k === "k" || k === "K" || k === "MediaPlayPause") tvTogglePause();
  else if (k === "ArrowRight") tv.ready && tvSeek(tv.player.getCurrentTime() + 10, "+10s");
  else if (k === "ArrowLeft") tv.ready && tvSeek(tv.player.getCurrentTime() - 10, "−10s");
  else if (k === "m" || k === "M") { if (tv.ready) { tv.player.isMuted() ? tv.player.unMute() : tv.player.mute(); tvToast(tv.player.isMuted() ? "Muted" : "Sound on"); } }
  else if (k === "l" || k === "L") { tvToast(toggleLike(tvCurrent().vid) ? "♥ Liked" : "Removed from Liked"); tvRenderInfo(); }
  else if (k === "f" || k === "F") tvFullscreen();
  else if (k === "Escape" || k === "t" || k === "T") tvClose();
  else { handled = false; tvShowUI(); }
  if (handled) e.preventDefault();
}
$("#tvBtn").onclick = () => tvOpen();
$("#tvExit").onclick = tvClose;
$("#tvFull").onclick = tvFullscreen;
$("#tv .tvcatch").onclick = tvTogglePause;
$("#tv").addEventListener("mousemove", () => tv.open && tvShowUI(2500));
// leaving browser fullscreen (the browser eats Esc there) keeps TV playing in the window; a second Esc exits
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement && tv.open && tv.wentFull) { tv.wentFull = false; tvToast("Fullscreen off · F fullscreen · Esc exit TV", 2500); tvShowUI(2500); }
});

// ---------- router ----------
function navigate(path) {
  if (path !== location.pathname + location.search) history.pushState(null, "", path);
  route();
}
async function route() {
  if (location.hash.startsWith("#/")) history.replaceState(null, "", location.hash.slice(1));
  const path = location.pathname;
  const [, page, ...rest] = path.split("/");
  const arg = decodeURIComponent(rest.join("/"));
  document.title = "RabbitHoleTV";
  document.body.classList.remove("drawer");
  selected = -1;
  const here = path + location.search.replace(/[?&]tv=1/, "");
  for (const a of document.querySelectorAll(".side a")) a.classList.toggle("on", a.getAttribute("href") === here);
  if (page !== "search") $("#q").value = "";
  if (pager) { pager.disconnect(); pager = null; }
  current = { label: "All videos", list: null };
  try {
    if (!page) await home();
    else if (page === "c") await category(arg);
    else if (page === "a") await area(arg);
    else if (page === "categories") categoriesPage();
    else if (page === "playlists") playlistsPage();
    else if (page === "p") playlistPage(arg);
    else if (page === "browse") await browsePage();
    else if (page === "watch") await watch(arg);
    else if (page === "search") await search(arg);
    else if (page === "liked") liked();
    else if (page === "history") historyPage();
    else if (page === "later") later();
    else if (page === "about") about();
    else if (page === "settings") settings();
    else notFound();
  } catch (e) { console.error(e); view.innerHTML = `<div class="status">Something went wrong (${esc(e.message)}).</div>`; }
  window.scrollTo(0, 0);
  if (new URLSearchParams(location.search).get("tv") === "1" && !tv.open) tvOpen({ auto: true });
}
addEventListener("popstate", () => { if (tv.open) tvClose(); route(); });
document.addEventListener("click", (e) => {
  const tvb = e.target instanceof Element && e.target.closest("[data-tv]");
  if (tvb) { e.preventDefault(); tvOpen(); return; }
  const a = e.target instanceof Element && e.target.closest("a[href^='/']:not([href^='//'])");
  if (!a || a.target || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  navigate(a.getAttribute("href"));
});
$("#search").addEventListener("submit", (e) => {
  e.preventDefault(); const q = $("#q").value.trim(); $("#q").blur();
  navigate(q ? withParams(`/search/${encodeURIComponent(q)}`, filterParams()) : "/");
});
$("#menu").onclick = () => {
  if (matchMedia("(max-width: 800px)").matches) document.body.classList.toggle("drawer");
  else { document.body.classList.toggle("collapsed"); store.set("collapsed", document.body.classList.contains("collapsed")); }
};
$("#scrim").onclick = () => document.body.classList.remove("drawer");
function onLaterButton(e) {
  const b = e.target instanceof Element && e.target.closest("[data-later]");
  if (!b || (e.type === "keydown" && e.key !== "Enter" && e.key !== " ")) return;
  e.preventDefault(); e.stopPropagation();
  const vid = b.dataset.later, on = toggleLater(vid);
  b.outerHTML = laterBtn(vid);
  toast(on ? "Saved to Watch later" : "Removed from Watch later");
  if (!on && location.pathname === "/later") later();
}
document.addEventListener("click", onLaterButton, true);
document.addEventListener("keydown", onLaterButton, true);
$("#theme").onclick = () => {
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  const cur = document.documentElement.dataset.theme || (dark ? "dark" : "light");
  const t = cur === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = t; store.set("theme", t);
};
if (store.get("collapsed", false)) document.body.classList.add("collapsed");

// ---------- keyboard ----------
let selected = -1;
const listItems = () => [...view.querySelectorAll(".vcard, .srow, .next")];
const vidOf = (el) => el?.getAttribute("href")?.split("/").pop();
function select(i) {
  const list = listItems(); if (!list.length) return;
  selected = Math.max(0, Math.min(i, list.length - 1));
  list.forEach((el, j) => el.classList.toggle("kbd", j === selected));
  list[selected].scrollIntoView({ block: "nearest" });
}
const SHORTCUTS = [["T", "TV mode: random videos from this page"], ["/", "Search"], ["j / k", "Next / previous video"],
  ["Enter", "Open the selected video"], ["l", "Like the selected or current video"], ["w", "Watch later"],
  ["p", "Play (on a video page)"], ["h", "Home"], ["?", "Show these shortcuts"], ["Esc", "Close"]];
function toggleHelp(force) {
  const h = $("#help"), show = force ?? !h.classList.contains("on");
  h.innerHTML = `<div class="help-card" role="dialog" aria-label="Keyboard shortcuts"><h3>Keyboard shortcuts</h3>
    <table>${SHORTCUTS.map(([k, d]) => `<tr><td>${k.split(" / ").map((x) => `<kbd>${esc(x)}</kbd>`).join(" / ")}</td><td>${esc(d)}</td></tr>`).join("")}</table></div>`;
  h.classList.toggle("on", show);
}
$("#help").onclick = (e) => { if (e.target.id === "help") toggleHelp(false); };
document.addEventListener("keydown", (e) => {
  if (tv.open) { tvKey(e); return; }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const el = document.activeElement;
  const typing = el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
  if (e.key === "Escape") { if (typing) el.blur(); toggleHelp(false); document.body.classList.remove("drawer"); return; }
  if (typing) return;
  const sel = listItems()[selected];
  const watching = location.pathname.startsWith("/watch/") ? location.pathname.split("/")[2] : null;
  const target = vidOf(sel) || watching;
  const key = e.code === "Slash" && e.shiftKey ? "?" : e.key;
  switch (key) {
    case "t": case "T": e.preventDefault(); tvOpen(); break;
    case "/": e.preventDefault(); $("#q").focus(); $("#q").select(); break;
    case "j": select(selected + 1); break;
    case "k": select(selected - 1); break;
    case "Enter": if (sel) { e.preventDefault(); navigate(sel.getAttribute("href")); } break;
    case "l": if (target) { const on = toggleLike(target); toast(on ? "Added to Liked" : "Removed from Liked");
      if (watching === target) { $("#like")?.classList.toggle("on", on); $("#dislike")?.classList.remove("on"); } } break;
    case "w": if (target) { const on = toggleLater(target); toast(on ? "Saved to Watch later" : "Removed from Watch later");
      document.querySelectorAll(`[data-later="${target}"]`).forEach((b) => { b.outerHTML = laterBtn(target); }); } break;
    case "p": $("#poster")?.click(); break;
    case "h": navigate("/"); break;
    case "?": toggleHelp(); break;
    default: return;
  }
});

loadData().then(route).catch((e) => { view.innerHTML = `<div class="status">Couldn't load the data (${esc(e.message)}).</div>`; });
