/* Shop editor: edits data/cards.json + config.js in the GitHub repo directly (Git Data API), one commit per Publish.
   The token is only kept in this browser's localStorage. Nothing secret is in this file. */
(() => {
  "use strict";
  const OWNER = "a050121", REPO = "card-shop";
  const qs = new URLSearchParams(location.search);
  const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname); // test overrides only allowed on the local preview
  const API = (LOCAL && qs.get("api")) || "https://api.github.com";
  const RAW = (LOCAL && qs.get("raw")) || "https://raw.githubusercontent.com";
  const BRANCH = (LOCAL && qs.get("branch")) || "main";
  const LS = (k) => `cs_${k}_${BRANCH}`;
  const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) => "$" + (Math.round(n * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  const r2 = (n) => Math.round(n * 100) / 100;
  const todayStr = new Date().toLocaleDateString("en-CA");
  let TOKEN = localStorage.getItem("cs_token") || "";

  // ---------- state ----------
  let base = null;            // {sha, cards[], cfg{}}
  let BY = new Map();         // id -> current card (base + pending)
  let P = emptyPending();     // pending changes
  function emptyPending() { return { edits: {}, added: {}, imgs: {}, cfg: {} }; }
  function savePending() {
    try { localStorage.setItem(LS("pending"), JSON.stringify(P)); }
    catch (e) { // images too big for localStorage: keep text edits at least
      try { localStorage.setItem(LS("pending"), JSON.stringify({ ...P, imgs: {} })); toast("Photos are kept until you close this tab. Publish soon.", true); } catch (_) {}
    }
    renderCount();
  }
  function loadPending() { try { const p = JSON.parse(localStorage.getItem(LS("pending")) || "null"); if (p && p.edits) P = { ...emptyPending(), ...p }; } catch (_) {} }
  const pendN = () => { const ids = new Set([...Object.keys(P.edits), ...Object.keys(P.added), ...Object.keys(P.imgs)]); return ids.size + (("featured_card_id" in P.cfg) ? 1 : 0) + (P.cfg.specials && !ids.size ? 1 : 0); };
  const isPend = (id) => !!(P.edits[id] || P.added[id] || P.imgs[id]);

  const cfg = () => ({ ...base.cfg, ...("featured_card_id" in P.cfg ? { featured_card_id: P.cfg.featured_card_id } : {}), specials: P.cfg.specials || base.cfg.specials || [] });
  const LAY = () => base.cfg.layaway || {};
  function tierOf(n) { const m = /\/\s*(\d+)\s*$/.exec((n || "").replace(/\s/g, "")); if (!m) return ""; const d = +m[1]; return d === 1 ? "1/1" : [5, 10, 25, 50, 99].includes(d) ? "/" + d : "other"; }
  function derive(c) {
    c.k = tierOf(c.n);
    const L = LAY();
    c.l = +!!(L.enabled && (c.$ >= +(L.min_price ?? 1e9) || (L.include_one_of_one && c.k === "1/1") || (L.include_featured && c.f)));
    return c;
  }
  function rebuild() {
    BY = new Map();
    for (const c0 of base.cards) BY.set(c0.i, { ...c0 });
    for (const [id, c] of Object.entries(P.added)) BY.set(+id, { ...c });
    for (const [id, e] of Object.entries(P.edits)) { const c = BY.get(+id); if (c) { Object.assign(c, e); for (const k in e) if (e[k] === null) delete c[k]; derive(c); } }
    for (const [id, im] of Object.entries(P.imgs)) { const c = BY.get(+id); if (c) c.im = im.ver; }
    // section index of each sale card = the specials section that lists it
    const gs = cfg().specials;
    for (const c of BY.values()) if (c.sp != null) { const k = gs.findIndex((g) => (g.ids || []).includes(c.i)); if (k >= 0) c.sx = k; }
  }
  const thumb = (c) => P.imgs[c.i]?.t || (c.im ? (base.imSha?.[c.i] ? `${RAW}/${OWNER}/${REPO}/${base.sha}/img/u/${c.i}-${c.im}-t.jpg` : `../img/u/${c.i}-${c.im}-t.jpg`) : `../img/t/${c.i}.webp`);
  const large = (c) => P.imgs[c.i]?.l || (c.im ? (base.imSha?.[c.i] ? `${RAW}/${OWNER}/${REPO}/${base.sha}/img/u/${c.i}-${c.im}-l.jpg` : `../img/u/${c.i}-${c.im}-l.jpg`) : `../img/l/${c.i}.webp`);

  const rawImg = (c, z) => `${RAW}/${OWNER}/${REPO}/${base.sha}/img/u/${c.i}-${c.im}-${z}.jpg`;
  // a just-uploaded photo isn't on the website for a minute or two: fall back to the repo copy
  document.addEventListener("error", (e) => { const i = e.target; if (i.tagName === "IMG" && i.dataset.raw && i.src !== i.dataset.raw) i.src = i.dataset.raw; }, true);

  // ---------- GitHub ----------
  async function gh(path, opt = {}) {
    const r = await fetch(API + path, { ...opt, headers: { Accept: "application/vnd.github+json", Authorization: "Bearer " + TOKEN, "X-GitHub-Api-Version": "2022-11-28", ...(opt.body ? { "Content-Type": "application/json" } : {}) }, cache: "no-store" });
    if (!r.ok) { const t = await r.text().catch(() => ""); const e = new Error(`GitHub ${r.status}: ${(t.match(/"message":\s*"([^"]+)"/) || [])[1] || t.slice(0, 120)}`); e.status = r.status; throw e; }
    return r.status === 204 ? null : r.json();
  }
  const R = `/repos/${OWNER}/${REPO}`;
  async function headSha() { return (await gh(`${R}/git/ref/heads/${BRANCH}`)).object.sha; }
  async function raw(sha, path) { const r = await fetch(`${RAW}/${OWNER}/${REPO}/${sha}/${path}`, { cache: "no-store" }); if (!r.ok) throw new Error(`Could not read ${path} (${r.status})`); return r.text(); }
  const parseCfg = (t) => JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
  async function loadBase(sha) {
    const [cj, cf] = await Promise.all([raw(sha, "data/cards.json"), raw(sha, "config.js")]);
    const cards = JSON.parse(cj), cfgv = parseCfg(cf);
    // cards whose uploaded image may not be on the website yet are read straight from the repo at this commit
    const lastPub = JSON.parse(localStorage.getItem(LS("lastpub")) || "{}");
    const imSha = {}; for (const [id, t] of Object.entries(lastPub.ids || {})) if (Date.now() - t < 15 * 60e3) imSha[id] = 1;
    return { sha, cards, cfg: cfgv, imSha };
  }

  // ---------- UI: list ----------
  const st = { q: "", f: "", g: "", shown: 60 };
  function matches(c) {
    if (st.g && c.g !== st.g) return false;
    if (st.f === "edited" && !isPend(c.i)) return false;
    if (st.f === "feat" && !c.f) return false;
    if (st.f === "sale" && c.sp == null) return false;
    if (st.f === "rs" && !c.rs) return false;
    if (st.f === "x" && !c.x) return false;
    if (st.f === "new" && c.i < 900000) return false;
    if (st.f !== "x" && st.f !== "" && c.x && st.f !== "edited") return false;
    if (!st.q) return true;
    const h = (c._h ||= [c.p, c.t, c.s, c.n, c.r, c.g, "#" + c.i, c.a ? "auto" : ""].join(" ").toLowerCase());
    return st.q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => (w[0] === "#" ? "#" + c.i === w : h.includes(w)));
  }
  function render() {
    const all = [...BY.values()].map((c) => { delete c._h; return c; });
    let v = all.filter(matches);
    const q = st.q.trim();
    v.sort((a, b) => (isPend(b.i) - isPend(a.i)) || (b.f - a.f) || (b.$ - a.$) || a.i - b.i);
    if (/^#?\d+$/.test(q)) { const id = +q.replace("#", ""); v.sort((a, b) => (b.i === id) - (a.i === id)); }
    $("#resInfo").textContent = `${v.length.toLocaleString()} card${v.length === 1 ? "" : "s"}` + (st.q || st.f || st.g ? " match" : "") + ` · ${all.filter((c) => !c.x).length.toLocaleString()} listed, ${all.filter((c) => c.x).length} sold`;
    $("#list").innerHTML = v.slice(0, st.shown).map((c) => `<button class="it${isPend(c.i) ? " pend" : ""}" data-id="${c.i}"><img loading="lazy" src="${esc(thumb(c))}" alt=""${c.im && !P.imgs[c.i] ? ` data-raw="${esc(rawImg(c, "t"))}"` : ""}><span class="mid"><div class="nm">${esc(c.p || "(no name)")}</div><div class="sub">#${c.i} · ${esc([c.t, c.s, c.n, c.g].filter(Boolean).join(" · "))}</div><div class="tags">${tagsOf(c)}</div></span><span class="pr">${c.sp != null ? `<s>${money(c.$)}</s>${money(c.sp)}` : money(c.$)}</span></button>`).join("") || `<p class="muted">No cards found.</p>`;
    $("#more").hidden = v.length <= st.shown;
  }
  function tagsOf(c) {
    const t = [];
    if (isPend(c.i)) t.push('<span class="tag g">Unpublished</span>');
    if (c.x) t.push('<span class="tag r">Sold</span>');
    if (c.rs) t.push('<span class="tag b">Reserved</span>');
    if (+cfg().featured_card_id === c.i) t.push('<span class="tag g">Spotlight</span>');
    if (c.f) t.push('<span class="tag g">Featured</span>');
    if (c.sp != null) t.push('<span class="tag o">Sale</span>');
    if (c.a) t.push('<span class="tag">Auto</span>');
    return t.join("");
  }
  function renderCount() { const n = pendN(); $("#pendCnt").textContent = n; $("#pubBtn").disabled = !n; }
  let tt; function toast(m, bad) { const t = $("#toast"); t.textContent = m; t.className = "toast" + (bad ? " bad" : ""); t.hidden = false; clearTimeout(tt); tt = setTimeout(() => (t.hidden = true), bad ? 6000 : 3000); }

  // ---------- edit sheet ----------
  let cur = null, curNew = false, curImg = null, curStat = "avail";
  const SPORTS = () => base.cfg.sports?.list?.length ? base.cfg.sports.list : [{ key: "NFL", label: "NFL" }];
  function fillSx(sel) {
    const gs = cfg().specials;
    $("#fSx").innerHTML = gs.map((g, k) => `<option value="${k}">${esc(g.title || "Specials")}${g.badge ? " · " + esc(g.badge) : ""}</option>`).join("") + '<option value="new">+ New section…</option>';
    $("#fSx").value = sel != null && gs[sel] ? String(sel) : gs.length ? "0" : "new";
  }
  function openSheet(c, isNew) {
    cur = c; curNew = isNew; curImg = null;
    $("#shTitle").textContent = isNew ? "Add a card" : `Edit card #${c.i}`;
    $("#fG").innerHTML = SPORTS().map((s) => `<option value="${esc(s.key)}">${esc(s.label || s.key)}</option>`).join("");
    $("#fP").value = c.p || ""; $("#fT").value = c.t || ""; $("#fS").value = c.s || ""; $("#fN").value = c.n || ""; $("#fR").value = c.r || "";
    $("#fG").value = c.g || base.cfg.sports?.default_sport || "NFL";
    $("#fPrice").value = c.$ ?? ""; $("#fA").checked = !!c.a; $("#fW").checked = !!c.w; $("#fF").checked = !!c.f;
    $("#fSpot").checked = +cfg().featured_card_id === c.i && !isNew;
    curStat = c.x ? "x" : c.rs ? "rs" : "avail"; segSet();
    $("#fSale").checked = c.sp != null; $("#saleBox").hidden = c.sp == null; $("#fSp").value = c.sp ?? ""; fillSx(c.sx);
    showImg(isNew && !P.imgs[c.i] ? "" : large(c), c.im && !P.imgs[c.i] && !isNew ? rawImg(c, "l") : "");
    $("#shFileLbl").textContent = isNew && !P.imgs[c.i] ? "Add photo" : "Replace photo";
    $("#shImgNote").textContent = "";
    $("#shRevert").hidden = isNew || !isPend(c.i);
    $("#shMeta").textContent = isNew ? "A new card gets the next free id when saved." : `Card id #${c.i}${c.k ? " · serial tier " + c.k : ""}${c.l ? " · payment plan eligible" : ""}`;
    $("#shErr").hidden = true;
    $("#sheet").hidden = false; document.body.style.overflow = "hidden"; $("#sheet .sh-body").scrollTop = 0;
    setTimeout(() => (isNew ? $("#fP") : $("#fPrice")).focus({ preventScroll: true }), 50);
  }
  function showImg(src, rawSrc) { $("#shImg").hidden = !src; $("#shImgEmpty").hidden = !!src; if (rawSrc) $("#shImg").dataset.raw = rawSrc; else delete $("#shImg").dataset.raw; if (src) $("#shImg").src = src; }
  function segSet() { $$("#fStat button").forEach((b) => b.classList.toggle("on", b.dataset.v === curStat)); }
  function closeSheet(id) { $(id).hidden = true; if ($$(".sheet").every((s) => s.hidden)) document.body.style.overflow = ""; }
  function shErr(m) { $("#shErr").textContent = m; $("#shErr").hidden = false; }
  const num = (v) => (v === "" || v == null ? NaN : +String(v).replace(/[$,\s]/g, ""));

  function saveSheet() {
    const price = num($("#fPrice").value);
    if (!(price >= 0)) return shErr("Enter a price.");
    const p = $("#fP").value.trim();
    if (!p) return shErr("Enter the player or card name.");
    const next = { p, t: $("#fT").value.trim(), s: $("#fS").value.trim(), n: $("#fN").value.trim(), r: $("#fR").value.trim(), g: $("#fG").value,
      $: r2(price), a: +$("#fA").checked, w: +$("#fW").checked, f: +$("#fF").checked, rs: +(curStat === "rs"), x: curStat === "x" ? 1 : null };
    // sale
    let specials = cfg().specials.map((g) => ({ ...g, ids: [...(g.ids || [])] }));
    let changedSpecials = false;
    const oldSx = cur.sp != null ? cur.sx : null;
    if ($("#fSale").checked) {
      const sp = num($("#fSp").value);
      if (!(sp > 0) || sp >= price) return shErr("Sale price must be more than $0 and less than the normal price.");
      let sx = $("#fSx").value;
      if (sx === "new") {
        const title = prompt("Name for the new specials section (shown on the shop):", "Specials");
        if (!title) return;
        specials.push({ title: title.trim(), badge: "SALE", ends: "", note: "", ids: [] }); sx = specials.length - 1; changedSpecials = true;
      }
      sx = +sx; const g = specials[sx];
      Object.assign(next, { sp: r2(sp), sb: g.badge || "SALE", se: g.ends || "", sx });
      if (oldSx !== sx || !g.ids.includes(cur.i || -1)) changedSpecials = true;
    } else Object.assign(next, { sp: null, sb: null, se: null, sx: null }), changedSpecials = oldSx != null;
    if (curNew && !P.imgs[cur.i] && !curImg) return shErr("Add a photo of the card.");
    let id = cur.i;
    if (curNew) {
      id = Math.max(899999, ...[...BY.keys()]) + 1;
      if (curImg) { P.imgs[id] = curImg; curImg = null; }
      const c = derive({ i: id, p: "", t: "", s: "", a: 0, w: 0, n: "", k: "", r: "", g: "NFL", $: 0, f: 0, o: id, l: 0, rs: 0, ...next, im: P.imgs[id].ver });
      for (const k in c) if (c[k] === null) delete c[k];
      P.added[id] = c;
    } else {
      const b = base.cards.find((x) => x.i === id) || P.added[id];
      const e = {};
      for (const [k, v] of Object.entries(next)) { const bv = b[k] ?? null; if (String(bv ?? "") !== String(v ?? "") || (bv === null) !== (v === null)) e[k] = v; }
      if (P.added[id]) { Object.assign(P.added[id], next); for (const k in P.added[id]) if (P.added[id][k] === null) delete P.added[id][k]; derive(P.added[id]); }
      else if (Object.keys(e).length) P.edits[id] = e; else delete P.edits[id];
      if (curImg) { P.imgs[id] = { ...curImg, old: b.im || null }; curImg = null; }
    }
    // keep specials section membership in sync
    if (changedSpecials || P.cfg.specials) {
      specials.forEach((g) => (g.ids = g.ids.filter((x) => x !== id)));
      if (next.sx != null) specials[next.sx].ids.push(id);
      P.cfg.specials = specials;
    }
    // spotlight
    const spot = $("#fSpot").checked, curSpot = +cfg().featured_card_id === id;
    if (spot && !curSpot) P.cfg.featured_card_id = id;
    else if (!spot && curSpot && !curNew) P.cfg.featured_card_id = null;
    if ("featured_card_id" in P.cfg && P.cfg.featured_card_id === base.cfg.featured_card_id) delete P.cfg.featured_card_id;
    rebuild(); savePending(); closeSheet("#sheet"); render();
    toast(curNew ? `Added #${id}. Press Publish when you're done.` : `Saved #${id}. Press Publish when you're done.`);
  }
  function revertCard() {
    const id = cur.i; delete P.edits[id]; delete P.imgs[id]; delete P.added[id];
    rebuild(); savePending(); closeSheet("#sheet"); render(); toast(`Undid changes to #${id}`);
  }

  // ---------- photo: crop + resize (client side, JPEG) ----------
  let srcImg = null, box = null, nat = null;
  async function pickFile(f) {
    if (!f) return;
    if (!/^image\//.test(f.type) && !/\.(jpe?g|png|webp|heic|heif|gif)$/i.test(f.name)) return toast("That isn't an image file.", true);
    const url = URL.createObjectURL(f);
    const im = new Image(); im.decoding = "async";
    try { await new Promise((ok, bad) => { im.onload = ok; im.onerror = bad; im.src = url; }); }
    catch (_) { return toast("Couldn't open that photo. Try a JPG or PNG (or a screenshot).", true); }
    srcImg = im; nat = { w: im.naturalWidth, h: im.naturalHeight };
    $("#cropImg").src = url; $("#crop").hidden = false;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    setBox(autoBox());
  }
  const AR = 194 / 270;
  function stageSize() { const r = $("#cropImg").getBoundingClientRect(); return { w: r.width, h: r.height }; }
  function autoBox() { // centered card-shaped box, as big as fits
    const s = stageSize(); if (!$("#cropLock").checked) return { x: 0, y: 0, w: s.w, h: s.h };
    let w = s.w, h = w / AR; if (h > s.h) { h = s.h; w = h * AR; }
    return { x: (s.w - w) / 2, y: (s.h - h) / 2, w, h };
  }
  function setBox(b) {
    const s = stageSize();
    b.w = Math.max(30, Math.min(b.w, s.w)); b.h = Math.max(30, Math.min(b.h, s.h));
    b.x = Math.max(0, Math.min(b.x, s.w - b.w)); b.y = Math.max(0, Math.min(b.y, s.h - b.h));
    box = b; Object.assign($("#cropBox").style, { left: b.x + "px", top: b.y + "px", width: b.w + "px", height: b.h + "px" });
  }
  (() => {
    let drag = null;
    const down = (mode) => (e) => { e.preventDefault(); e.stopPropagation(); drag = { mode, x: e.clientX, y: e.clientY, b: { ...box } }; e.target.setPointerCapture?.(e.pointerId); };
    $("#cropBox").addEventListener("pointerdown", down("move"));
    $("#cropH").addEventListener("pointerdown", down("size"));
    $("#cropTL").addEventListener("pointerdown", down("tl"));
    const move = (e) => {
      if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y, b = { ...drag.b };
      if (drag.mode === "move") { b.x += dx; b.y += dy; }
      else if (drag.mode === "tl") { // top-left corner: keep the bottom-right corner fixed
        const rx = drag.b.x + drag.b.w, ry = drag.b.y + drag.b.h;
        b.x = Math.max(0, Math.min(rx - 30, drag.b.x + dx)); b.w = rx - b.x;
        if ($("#cropLock").checked) { b.h = b.w / AR; if (ry - b.h < 0) { b.h = ry; b.w = b.h * AR; b.x = rx - b.w; } }
        else b.h = ry - Math.max(0, Math.min(ry - 30, drag.b.y + dy));
        b.y = ry - b.h;
      }
      else { b.w = drag.b.w + dx; b.h = $("#cropLock").checked ? b.w / AR : drag.b.h + dy; const s = stageSize(); if (b.x + b.w > s.w) { b.w = s.w - b.x; if ($("#cropLock").checked) b.h = b.w / AR; } if (b.y + b.h > s.h) { b.h = s.h - b.y; if ($("#cropLock").checked) b.w = b.h * AR; } }
      setBox(b);
    };
    addEventListener("pointermove", move); addEventListener("pointerup", () => (drag = null)); addEventListener("pointercancel", () => (drag = null));
  })();
  function encode(sx, sy, sw, sh, maxW, maxH, q) {
    const k = Math.min(1, maxW / sw, maxH / sh), w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const g = cv.getContext("2d"); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
    g.fillStyle = "#000"; g.fillRect(0, 0, w, h); g.drawImage(srcImg, sx, sy, sw, sh, 0, 0, w, h);
    return { url: cv.toDataURL("image/jpeg", q), w, h };
  }
  function useCrop() {
    const s = stageSize(), fx = nat.w / s.w, fy = nat.h / s.h;
    const sx = box.x * fx, sy = box.y * fy, sw = box.w * fx, sh = box.h * fy;
    const L = encode(sx, sy, sw, sh, 720, 1000, 0.86), T = encode(sx, sy, sw, sh, 300, 420, 0.8);
    curImg = { ver: Date.now().toString(36), t: T.url, l: L.url, w: L.w, h: L.h };
    showImg(L.url); $("#shFileLbl").textContent = "Replace photo";
    $("#shImgNote").textContent = `New photo ${L.w}×${L.h}${L.w < 300 ? " (small source, may look soft)" : ""}. Saved when you press Save.`;
    closeSheet("#crop"); $("#sheet").hidden = false; document.body.style.overflow = "hidden"; $("#sheet .sh-body").scrollTop = 0;
  }

  // ---------- specials sections ----------
  function renderSpecs() {
    const gs = cfg().specials;
    $("#spBody").innerHTML = (gs.length ? gs.map((g, k) => `<div class="spr" data-k="${k}">
      <label class="fld"><span>Section title</span><input data-k="${k}" data-p="title" value="${esc(g.title)}"></label>
      <div class="row2"><label class="fld"><span>Badge on cards</span><input data-k="${k}" data-p="badge" value="${esc(g.badge || "")}" maxlength="14"></label>
      <label class="fld"><span>Last day (optional)</span><input type="date" data-k="${k}" data-p="ends" value="${esc(g.ends || "")}"></label></div>
      <label class="fld"><span>Note (optional)</span><input data-k="${k}" data-p="note" value="${esc(g.note || "")}"></label>
      <div class="muted small">${(g.ids || []).length} card(s) on sale in this section. <button class="linkbtn" data-del="${k}">Delete section (ends those sales)</button></div></div>`).join("")
      : '<p class="muted">No specials sections yet. Put a card on sale (edit card → On sale), or add a section here.</p>');
  }
  function specEdit(fn) {
    const gs = cfg().specials.map((g) => ({ ...g, ids: [...(g.ids || [])] })); fn(gs);
    // remap card sale fields to section indices
    P.cfg.specials = gs;
    const touched = new Set(gs.flatMap((g) => g.ids));
    for (const c of BY.values()) if (c.sp != null && !touched.has(c.i)) setCard(c.i, { sp: null, sb: null, se: null, sx: null });
    gs.forEach((g, k) => g.ids.forEach((id) => setCard(id, { sb: g.badge || "SALE", se: g.ends || "", sx: k })));
    rebuild(); savePending(); render();
  }
  function setCard(id, fields) {
    const b = base.cards.find((x) => x.i === id);
    if (P.added[id]) { Object.assign(P.added[id], fields); for (const k in P.added[id]) if (P.added[id][k] === null) delete P.added[id][k]; return; }
    const e = { ...(P.edits[id] || {}) };
    for (const [k, v] of Object.entries(fields)) { if (String(b?.[k] ?? "") === String(v ?? "") && (b?.[k] == null) === (v == null)) delete e[k]; else e[k] = v; }
    if (Object.keys(e).length) P.edits[id] = e; else delete P.edits[id];
  }

  // ---------- publish ----------
  function summary() {
    const L = [];
    for (const [id, c] of Object.entries(P.added)) L.push(`Add #${id} ${c.p} · ${money(c.$)}`);
    for (const [id, e] of Object.entries(P.edits)) {
      const c = BY.get(+id), b = base.cards.find((x) => x.i === +id) || {}; const parts = [];
      if ("$" in e) parts.push(`price ${money(b.$)} → ${money(e.$)}`);
      if ("x" in e) parts.push(e.x ? "mark SOLD" : "back for sale");
      if ("rs" in e) parts.push(e.rs ? "reserved" : "not reserved");
      if ("f" in e) parts.push(e.f ? "featured" : "not featured");
      if ("sp" in e) parts.push(e.sp == null ? "sale off" : `sale ${money(e.sp)}`);
      const meta = ["p", "t", "s", "n", "r", "g", "a", "w"].filter((k) => k in e); if (meta.length) parts.push("details");
      if (P.imgs[id]) parts.push("new photo");
      if (parts.length) L.push(`#${id} ${c?.p || ""}: ${parts.join(", ")}`);
    }
    for (const id of Object.keys(P.imgs)) if (!P.edits[id] && !P.added[id]) L.push(`#${id} ${BY.get(+id)?.p || ""}: new photo`);
    if ("featured_card_id" in P.cfg) L.push(P.cfg.featured_card_id ? `Spotlight card → #${P.cfg.featured_card_id} ${BY.get(+P.cfg.featured_card_id)?.p || ""}` : "Spotlight: automatic");
    if (P.cfg.specials) L.push(`Specials sections updated (${P.cfg.specials.length})`);
    return L;
  }
  async function publish() {
    $("#pbGo").disabled = true; const status = (m) => ($("#pbStatus").textContent = m);
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        status("Checking for other changes…");
        const head = await headSha();
        if (head !== base.sha) { status("Merging with the latest version…"); base = await loadBase(head); rebuild(); }
        const commit = await gh(`${R}/git/commits/${head}`);
        const tree = [];
        status("Uploading photos…");
        for (const [id, im] of Object.entries(P.imgs)) {
          for (const z of ["t", "l"]) {
            const b = await gh(`${R}/git/blobs`, { method: "POST", body: JSON.stringify({ content: im[z].split(",")[1], encoding: "base64" }) });
            tree.push({ path: `img/u/${id}-${im.ver}-${z}.jpg`, mode: "100644", type: "blob", sha: b.sha });
          }
          const old = base.cards.find((x) => x.i === +id)?.im;
          if (old && old !== im.ver) for (const z of ["t", "l"]) tree.push({ path: `img/u/${id}-${old}-${z}.jpg`, mode: "100644", type: "blob", sha: null });
        }
        status("Saving card data…");
        const ids = new Set(base.cards.map((c) => c.i));
        const cards = [...base.cards.map((c) => strip(BY.get(c.i))), ...[...BY.values()].filter((c) => !ids.has(c.i)).map(strip)];
        const c2 = cfg();
        c2.specials = (c2.specials || []).map((g) => ({ ...g, ids: (g.ids || []).filter((id) => BY.get(id)?.sp != null) })).filter((g) => g.ids.length);
        // section indices may shift after dropping empty sections
        cards.forEach((c) => { if (c.sp != null) { const k = c2.specials.findIndex((g) => g.ids.includes(c.i)); if (k < 0) { delete c.sp; delete c.sb; delete c.se; delete c.sx; } else c.sx = k; } });
        const d = new Date(); c2.build = `${d.toLocaleDateString("en-CA")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
        const cb = await gh(`${R}/git/blobs`, { method: "POST", body: JSON.stringify({ content: JSON.stringify(cards), encoding: "utf-8" }) });
        const fb = await gh(`${R}/git/blobs`, { method: "POST", body: JSON.stringify({ content: "window.SHOP_CONFIG = " + JSON.stringify(c2, null, 1) + ";\n", encoding: "utf-8" }) });
        tree.push({ path: "data/cards.json", mode: "100644", type: "blob", sha: cb.sha }, { path: "config.js", mode: "100644", type: "blob", sha: fb.sha });
        const t = await gh(`${R}/git/trees`, { method: "POST", body: JSON.stringify({ base_tree: commit.tree.sha, tree }) });
        const L = summary();
        const msg = `Editor: ${L.length} change${L.length === 1 ? "" : "s"}\n\n` + L.map((x) => "- " + x).join("\n");
        const nc = await gh(`${R}/git/commits`, { method: "POST", body: JSON.stringify({ message: msg, tree: t.sha, parents: [head] }) });
        status("Publishing…");
        try { await gh(`${R}/git/refs/heads/${BRANCH}`, { method: "PATCH", body: JSON.stringify({ sha: nc.sha, force: false }) }); }
        catch (e) { if (e.status === 422 || e.status === 409) continue; throw e; } // someone published in between: retry on top
        const imgIds = Object.keys(P.imgs).map(Number);
        const lp = JSON.parse(localStorage.getItem(LS("lastpub")) || "{}"), lpIds = {};
        for (const [id, t] of Object.entries(lp.ids && !Array.isArray(lp.ids) ? lp.ids : {})) if (Date.now() - t < 15 * 60e3) lpIds[id] = t;
        imgIds.forEach((id) => (lpIds[id] = Date.now()));
        localStorage.setItem(LS("lastpub"), JSON.stringify({ ids: lpIds, sha: nc.sha }));
        P = emptyPending(); savePending();
        base = await loadBase(nc.sha); rebuild(); render();
        closeSheet("#pub"); toast("Published! The shop updates in about 1–2 minutes.");
        return;
      }
      throw new Error("The shop kept changing while publishing. Try again.");
    } catch (e) {
      status(""); toast(e.status === 401 || e.status === 403 || e.status === 404 ? "GitHub refused: the token may be expired or missing Contents: Read and write on card-shop. Sign out and paste a new one." : "Publish failed: " + e.message, true);
    } finally { $("#pbGo").disabled = false; }
  }
  function strip(c) { const o = {}; for (const [k, v] of Object.entries(c)) if (k[0] !== "_" && v !== null && v !== undefined) o[k] = v; return o; }

  // ---------- boot ----------
  async function signIn(tok) {
    TOKEN = tok.trim();
    const repo = await gh(R);
    if (repo.permissions && repo.permissions.push === false) throw new Error("This token can't write to card-shop.");
    let who = OWNER; try { who = (await gh("/user")).login || who; } catch (_) {}
    localStorage.setItem("cs_token", TOKEN);
    return who;
  }
  async function start() {
    $("#loading").hidden = false; $("#signin").hidden = true; $("#app").hidden = true;
    try {
      const who = await signIn(TOKEN);
      $("#who").textContent = `Signed in · ${who}${BRANCH !== "main" ? " · branch " + BRANCH : ""}`;
      base = await loadBase(await headSha());
      loadPending(); rebuild(); renderCount();
      const opts = (k) => [...new Set(base.cards.map((c) => c[k]).filter(Boolean))].sort().map((v) => `<option value="${esc(v)}">`).join("");
      $("#teams").innerHTML = opts("t"); $("#sets").innerHTML = opts("s"); $("#rars").innerHTML = opts("r");
      $("#sportF").innerHTML = '<option value="">All sports</option>' + SPORTS().map((s) => `<option value="${esc(s.key)}">${esc(s.label || s.key)}</option>`).join("");
      $("#loading").hidden = true; $("#app").hidden = false; render();
    } catch (e) {
      $("#loading").hidden = true; $("#signin").hidden = false;
      if (TOKEN) { $("#tokErr").textContent = e.status === 401 ? "That token didn't work (expired or mistyped). Paste a new one." : e.status === 404 || e.status === 403 ? "That token can't see a050121/card-shop. Make sure you picked that repository and Contents: Read and write." : "Couldn't connect: " + e.message; $("#tokErr").hidden = false; }
      localStorage.removeItem("cs_token"); TOKEN = "";
    }
  }

  // ---------- events ----------
  $("#tokSave").onclick = () => { const v = $("#tokIn").value.trim(); if (!v) return; TOKEN = v; $("#tokErr").hidden = true; start(); };
  $("#tokIn").addEventListener("keydown", (e) => e.key === "Enter" && $("#tokSave").click());
  $("#signout").onclick = () => { if (pendN() && !confirm("You have unpublished changes on this device. Sign out anyway? (They stay saved here.)")) return; localStorage.removeItem("cs_token"); location.reload(); };
  let qt; $("#q").addEventListener("input", (e) => { clearTimeout(qt); qt = setTimeout(() => { st.q = e.target.value.trim(); st.shown = 60; render(); }, 150); });
  $("#chips").addEventListener("click", (e) => { const b = e.target.closest("[data-f]"); if (!b) return; $$("#chips [data-f]").forEach((x) => x.classList.toggle("on", x === b)); st.f = b.dataset.f; st.shown = 60; render(); });
  $("#sportF").onchange = (e) => { st.g = e.target.value; render(); };
  $("#more").onclick = () => { st.shown += 120; render(); };
  $("#list").addEventListener("click", (e) => { const b = e.target.closest("[data-id]"); if (b) openSheet(BY.get(+b.dataset.id), false); });
  $("#addBtn").onclick = () => openSheet({ i: 0, g: st.g || base.cfg.sports?.default_sport || "NFL", $: "" }, true);
  $("#shClose").onclick = $("#shCancel").onclick = () => { curImg = null; closeSheet("#sheet"); };
  $("#shSave").onclick = saveSheet; $("#shRevert").onclick = revertCard;
  $("#fStat").onclick = (e) => { const b = e.target.closest("button"); if (b) { curStat = b.dataset.v; segSet(); } };
  $("#fSale").onchange = () => { $("#saleBox").hidden = !$("#fSale").checked; if ($("#fSale").checked && !$("#fSp").value) { const p = num($("#fPrice").value); if (p > 0) $("#fSp").value = r2(p * 0.8); } };
  $("#shFile").onchange = (e) => { const f = e.target.files[0]; e.target.value = ""; $("#sheet").hidden = true; pickFile(f).then(() => { if ($("#crop").hidden) $("#sheet").hidden = false; }); };
  $("#cropOk").onclick = useCrop;
  $("#cropClose").onclick = () => { closeSheet("#crop"); $("#sheet").hidden = false; document.body.style.overflow = "hidden"; };
  $("#cropFull").onclick = () => { $("#cropLock").checked = false; const s = stageSize(); setBox({ x: 0, y: 0, w: s.w, h: s.h }); };
  $("#cropLock").onchange = () => setBox(autoBox());
  $("#specBtn").onclick = () => { renderSpecs(); $("#specs").hidden = false; document.body.style.overflow = "hidden"; };
  $("#spBody").addEventListener("change", (e) => { const i = e.target.closest("input[data-k]"); if (i) specEdit((gs) => (gs[+i.dataset.k][i.dataset.p] = i.value.trim())); });
  $("#spBody").addEventListener("click", (e) => { const d = e.target.closest("[data-del]"); if (d && confirm("Delete this section and end its sales?")) { specEdit((gs) => gs.splice(+d.dataset.del, 1)); renderSpecs(); } });
  $("#spAdd").onclick = () => { const t = prompt("Section title (shown on the shop):", "Specials"); if (t) { specEdit((gs) => gs.push({ title: t.trim(), badge: "SALE", ends: "", note: "", ids: [] })); renderSpecs(); } };
  $("#spClose").onclick = $("#spDone").onclick = () => closeSheet("#specs");
  $("#pubBtn").onclick = () => { $("#pbList").innerHTML = summary().map((x) => `<li>${esc(x)}</li>`).join(""); $("#pbStatus").textContent = ""; $("#pub").hidden = false; document.body.style.overflow = "hidden"; };
  $("#pbClose").onclick = () => closeSheet("#pub");
  $("#pbGo").onclick = publish;
  $("#pbDiscard").onclick = () => { if (confirm("Throw away all unpublished changes?")) { P = emptyPending(); savePending(); rebuild(); render(); closeSheet("#pub"); } };
  addEventListener("keydown", (e) => { if (e.key === "Escape") { for (const id of ["#crop", "#pub", "#specs", "#sheet"]) if (!$(id).hidden) { $(id + " .x").click(); break; } } });
  addEventListener("beforeunload", (e) => { if (pendN() && Object.keys(P.imgs).length) { e.preventDefault(); e.returnValue = ""; } });

  if (TOKEN) start(); else { $("#loading").hidden = true; $("#signin").hidden = false; }
})();
