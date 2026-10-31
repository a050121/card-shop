(() => {
  "use strict";
  const C = window.SHOP_CONFIG || {};
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) => "$" + (Math.round(n * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  const money2 = (n) => "$" + (Math.round(n * 100) / 100).toFixed(2);
  const PAGE = 48;
  const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const FINE = matchMedia("(hover: hover) and (pointer: fine)").matches;

  const LAY = C.layaway || {};
  const r2 = (n) => Math.round(n * 100) / 100;
  const fmtDate = (d) => d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const addDays = (n) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return d; };
  function planSchedule(amount, weeks, type) {
    const down = r2(amount * (LAY.down_pct || 20) / 100), rest = r2(amount - down);
    const rows = [{ label: `Down payment (${LAY.down_pct}%${LAY.down_refundable ? "" : ", non-refundable"})`, date: "Today", amt: down, now: true }];
    if (type === "lump") rows.push({ label: "Remaining balance (lump sum)", date: "By " + fmtDate(addDays(7 * weeks)), amt: rest });
    else {
      const each = Math.floor((rest / weeks) * 100) / 100;
      for (let k = 1; k <= weeks; k++) rows.push({ label: `Weekly payment ${k} of ${weeks}`, date: fmtDate(addDays(7 * k)), amt: k === weeks ? r2(rest - each * (weeks - 1)) : each });
    }
    return { down, rest, rows };
  }
  const planTypes = () => [LAY.allow_weekly !== false && ["weekly", "Equal weekly payments"], LAY.allow_lump_sum !== false && ["lump", "Lump sum by end of plan"]].filter(Boolean);
  const weekOpts = () => (LAY.weeks_options || [1, 2, 3, 4, 5, 6]).map((w) => `<option value="${w}"${w === (LAY.default_weeks || 4) ? " selected" : ""}>${w} week${w > 1 ? "s" : ""}</option>`).join("");
  const maxWeeks = () => Math.max(...(LAY.weeks_options || [6]));
  function schedTable(sc, extraNow) {
    return `<table class="sched"><thead><tr><th scope="col">Payment</th><th scope="col">Due</th><th scope="col">Amount</th></tr></thead><tbody>${extraNow ? `<tr class="now"><td>Other cards (paid in full)</td><td>Today</td><td>${money2(extraNow)}</td></tr>` : ""}${sc.rows.map((r) => `<tr${r.now ? ' class="now"' : ""}><td>${esc(r.label)}</td><td>${esc(r.date)}</td><td>${money2(r.amt)}</td></tr>`).join("")}</tbody></table>`;
  }

  let CARDS = [], BYID = new Map(), view = [], shown = 0;
  const DEF = { sport: "", q: "", rarity: "", serial: "", auto: false, award: false, plan: false, sale: false, team: "", set: "", min: "", max: "", sort: "feat" };
  const st = { ...DEF };

  // ---------- specials: a sale price on top of the listed price (listed price never changes) ----------
  const todayStr = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
  const saleLive = (c) => c.sp != null && (!c.se || c.se >= todayStr);
  const price = (c) => (saleLive(c) ? c.sp : c.$);
  const pctOff = (c) => Math.round((1 - c.sp / c.$) * 100);
  const endsLabel = (e) => { if (!e) return ""; const d = new Date(e + "T12:00:00"); return isNaN(d) ? "" : "Ends " + fmtDate(d); };

  // ---------- cart (localStorage) ----------
  const CK = "tc_cart_v1";
  let cart = new Set(JSON.parse(localStorage.getItem(CK) || "[]"));
  const saveCart = () => { localStorage.setItem(CK, JSON.stringify([...cart])); renderCartBadge(); };
  const cartCards = () => [...cart].map((id) => BYID.get(id)).filter(Boolean);
  const cartTotal = () => r2(cartCards().reduce((s, c) => s + price(c), 0));
  const cartSavings = () => r2(cartCards().reduce((s, c) => s + (c.$ - price(c)), 0));

  const name = (c) => c.p || `Card #${c.i}`;
  const sub = (c) => [c.t, c.s].filter(Boolean).join(" · ") || c.r;
  const serKey = (c) => (c._d === 1 ? "1/1" : c._d ? "/" + c._d : "");
  const serClass = (d) => (d === 1 ? "one" : d <= 9 ? "red" : d <= 10 ? "s10" : d <= 25 ? "s25" : d <= 50 ? "s50" : "s99");
  const alt = (c) => `${name(c)}${c.n ? " " + c.n : ""}${c.a ? " autograph" : ""} card`;
  function tags(c, full) {
    const t = [];
    if (saleLive(c)) t.push(`<span class="tag sale">${esc(c.sb || "Sale")}</span>`);
    if (c._d) t.push(`<span class="tag ${serClass(c._d)}">${c._d === 1 ? "1/1" : esc(c.n)}</span>`);
    if (c.a) t.push('<span class="tag auto">Auto</span>');
    if (c.w) t.push('<span class="tag awd">Award</span>');
    if (c.rs) t.push('<span class="tag rsv">On layaway · Reserved</span>');
    else if (c.l && LAY.enabled) t.push(`<span class="tag lay">${full ? "Payment plan available" : "Plan"}</span>`);
    if (full || c.r === "Legendary") t.push(`<span class="tag ${c.r === "Legendary" ? "leg" : "ico"}">${esc(c.r)}</span>`);
    return t.join("");
  }
  const priceHtml = (c, cls = "price") => saleLive(c) ? `<span class="${cls} on-sale"><s><span class="sr">was </span>${money(c.$)}</s> <b><span class="sr">now </span>${money(c.sp)}</b></span>` : `<span class="${cls}">${money(c.$)}</span>`;
  const bigPrice = (c) => saleLive(c) ? `<s><span class="sr">was </span>${money(c.$)}</s> <b><span class="sr">now </span>${money(c.sp)}</b> <span class="save">Save ${pctOff(c)}%</span>${c.se ? `<span class="ends">${esc(endsLabel(c.se))}</span>` : ""}` : `<b>${money(c.$)}</b>`;
  const addLabel = (c, i) => `${i ? "Remove" : "Add"} ${name(c)} ${i ? "from" : "to"} cart`;
  function tile(c) {
    const inCart = cart.has(c.i);
    const btn = c.rs ? '<button class="add" disabled>Reserved</button>' : `<button class="add${inCart ? " in" : ""}" data-add="${c.i}" aria-label="${esc(addLabel(c, inCart))}">${inCart ? "✓ In cart" : "+ Add"}</button>`;
    const prem = c._d === 1 ? " t-one" : c.f ? " t-feat" : "";
    return `<article class="tile${c.rs ? " reserved" : ""}${prem}" data-id="${c.i}">
      <button class="ph tilt" data-open="${c.i}" aria-label="Quick view: ${esc(name(c))}, ${money(price(c))}"><img loading="lazy" decoding="async" src="img/t/${c.i}.webp" alt="${esc(alt(c))}" width="194" height="270"><span class="shine" aria-hidden="true"></span><span class="rib">${tags(c)}</span><span class="qv" aria-hidden="true">Quick view</span></button>
      <div class="info"><div class="nm" title="${esc(name(c))}">${esc(name(c))}</div><div class="sub">${esc(sub(c))}</div>
      <div class="buy">${priceHtml(c)}${btn}</div></div></article>`;
  }

  // ---------- filtering ----------
  const words = () => st.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  function match(c, skip = "", ws = words()) {
    if (st.sport && c.g !== st.sport) return false;
    if (skip !== "rarity" && st.rarity && c.r !== st.rarity) return false;
    if (skip !== "serial" && st.serial && serKey(c) !== st.serial) return false;
    if (skip !== "auto" && st.auto && !c.a) return false;
    if (skip !== "award" && st.award && !c.w) return false;
    if (skip !== "plan" && st.plan && !(c.l && !c.rs)) return false;
    if (skip !== "sale" && st.sale && !saleLive(c)) return false;
    if (st.team && c.t !== st.team) return false;
    if (st.set && c.s !== st.set) return false;
    if (skip !== "price") {
      const p = price(c);
      if (st.min !== "" && p < +st.min) return false;
      if (st.max !== "" && p > +st.max) return false;
    }
    for (const w of ws) if (!c._h.includes(w)) return false;
    return true;
  }
  const isFiltered = () => !!(st.q.trim() || st.rarity || st.serial || st.auto || st.award || st.plan || st.sale || st.team || st.set || st.min !== "" || st.max !== "");
  function apply() {
    const ws = words();
    view = CARDS.filter((c) => match(c, "", ws));
    const R = (c) => c._d || 1e4;
    const by = {
      feat: (a, b) => b.f - a.f || R(a) - R(b) || price(b) - price(a) || (b.p ? 1 : 0) - (a.p ? 1 : 0) || a.o - b.o,
      "price-desc": (a, b) => price(b) - price(a) || a.o - b.o,
      "price-asc": (a, b) => price(a) - price(b) || a.o - b.o,
      newest: (a, b) => b.o - a.o,
      name: (a, b) => (!a.p) - (!b.p) || a.p.localeCompare(b.p) || a.o - b.o,
      serial: (a, b) => R(a) - R(b) || price(b) - price(a) || a.o - b.o,
      order: (a, b) => a.o - b.o,
    }[st.sort] || ((a, b) => a.o - b.o);
    const qq = st.q.trim().toLowerCase().replace(/\s+/g, " ");
    if (qq.includes(" ") && st.sort === "feat") { const ph = (c) => (` ${(c.p || "").toLowerCase()} `.includes(` ${qq} `) ? 0 : 1); view.sort((a, b) => ph(a) - ph(b) || by(a, b)); }
    else view.sort(by);
    shown = 0;
    $("#grid").innerHTML = "";
    renderMore();
    const q = st.q.trim();
    $("#resTitle").textContent = q ? `Results for “${q}”` : isFiltered() ? "Filtered cards" : "All cards";
    $("#resCount").textContent = `${view.length.toLocaleString()} card${view.length === 1 ? "" : "s"}`;
    const sportEmpty = st.sport && !CARDS.some((c) => c.g === st.sport);
    $("#soon").hidden = !sportEmpty;
    $("#shop").hidden = !!sportEmpty;
    if (sportEmpty) { const sd = SPORTS.find((x) => x.key === st.sport) || {}; $("#soonEmoji").textContent = sd.emoji || "⏳"; $("#soonTitle").textContent = `${sd.label || st.sport} cards coming soon`; }
    renderFeatured(); renderSpecials(); renderFacets(); renderActive(); buildCarousel(); renderSpot();
    $("#empty").hidden = view.length > 0;
    $("#qClear").hidden = !st.q;
    syncUrl();
  }
  function renderMore() {
    const next = view.slice(shown, shown + PAGE);
    $("#grid").insertAdjacentHTML("beforeend", next.map(tile).join(""));
    shown += next.length;
    $("#more").hidden = shown >= view.length;
  }
  new IntersectionObserver((e) => { if (e[0].isIntersecting && shown < view.length && shown > 0) renderMore(); }, { rootMargin: "1200px" }).observe($("#sentinel"));

  // ---------- facets with counts ----------
  let SERIALS = [], RARITIES = [];
  function renderFacets() {
    const ws = words();
    const cnt = (skip, fn) => { let n = 0; for (const c of CARDS) if (fn(c) && match(c, skip, ws)) n++; return n; };
    $("#serialChips").innerHTML = [`<button type="button" class="chip${!st.serial ? " on" : ""}" data-serial="" aria-pressed="${!st.serial}">Any</button>`,
      ...SERIALS.map((k) => { const n = cnt("serial", (c) => serKey(c) === k), on = st.serial === k, d = k === "1/1" ? 1 : +k.slice(1);
        return `<button type="button" class="chip ser-${serClass(d)}${on ? " on" : ""}" data-serial="${k}" aria-pressed="${on}" aria-label="${k} (${n} cards)"${!n && !on ? " disabled" : ""}>${k}<span class="ct" aria-hidden="true">${n}</span></button>`; })].join("");
    $("#rarityChips").innerHTML = [`<button type="button" class="chip${!st.rarity ? " on" : ""}" data-rarity="" aria-pressed="${!st.rarity}">All</button>`,
      ...RARITIES.map((r) => { const n = cnt("rarity", (c) => c.r === r), on = st.rarity === r; return `<button type="button" class="chip${on ? " on" : ""}" data-rarity="${esc(r)}" aria-pressed="${on}" aria-label="${esc(r)} (${n} cards)"${!n && !on ? " disabled" : ""}>${esc(r)}<span class="ct" aria-hidden="true">${n}</span></button>`; })].join("");
    $("#ctAuto").textContent = cnt("auto", (c) => c.a); $("#ctAward").textContent = cnt("award", (c) => c.w);
    $("#ctPlan").textContent = cnt("plan", (c) => c.l && !c.rs); $("#ctSale").textContent = cnt("sale", saleLive);
    [["#fAuto", st.auto], ["#fAward", st.award], ["#fPlan", st.plan], ["#fSale", st.sale]].forEach(([s, v]) => $(s).closest(".chip").classList.toggle("on", v));
    $$("[data-pr]").forEach((b) => { const [a, z] = b.dataset.pr.split("-"); const on = st.min === a && st.max === z; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); });
    const nf = activeList().length; $("#fBadge").hidden = !nf; $("#fBadge").textContent = nf;
  }
  function activeList() {
    const a = [];
    if (st.q.trim()) a.push(["q", `“${st.q.trim()}”`]);
    if (st.serial) a.push(["serial", `Serial ${st.serial}`]);
    if (st.rarity) a.push(["rarity", st.rarity]);
    if (st.auto) a.push(["auto", "Autographs"]);
    if (st.award) a.push(["award", "Award cards"]);
    if (st.plan) a.push(["plan", "Payment plan OK"]);
    if (st.sale) a.push(["sale", "On sale"]);
    if (st.team) a.push(["team", st.team]);
    if (st.set) a.push(["set", st.set]);
    if (st.min !== "" || st.max !== "") a.push(["price", st.max === "" ? `${money(+st.min)}+` : `${money(+st.min || 0)}–${money(+st.max)}`]);
    return a;
  }
  function renderActive() {
    const a = activeList();
    $("#activeChips").innerHTML = a.length ? a.map(([k, l]) => `<button type="button" class="chip act" data-unset="${k}" aria-label="Remove filter ${esc(l)}">${esc(l)} <span aria-hidden="true">×</span></button>`).join("") + '<button type="button" class="link" data-unset="all">Clear all</button>' : "";
  }
  function unset(k) {
    if (k === "all") Object.assign(st, { ...DEF, sport: st.sport, sort: st.sort });
    else if (k === "price") { st.min = ""; st.max = ""; }
    else st[k] = DEF[k];
    reflectControls(); apply();
  }

  // ---------- price range (log-scale slider + inputs + presets) ----------
  let PMIN = 1, PMAX = 100;
  const v2p = (v) => Math.round(Math.exp(Math.log(PMIN) + (v / 100) * (Math.log(PMAX) - Math.log(PMIN))));
  const p2v = (p) => Math.max(0, Math.min(100, Math.round(((Math.log(Math.max(p, PMIN)) - Math.log(PMIN)) / (Math.log(PMAX) - Math.log(PMIN))) * 100)));
  function reflectRange() {
    const a = st.min === "" ? 0 : p2v(+st.min), z = st.max === "" ? 100 : p2v(+st.max);
    $("#rMin").value = a; $("#rMax").value = z;
    $("#rangeFill").style.left = a + "%"; $("#rangeFill").style.right = 100 - z + "%";
    $("#pMin").value = st.min; $("#pMax").value = st.max;
    $("#rMin").setAttribute("aria-valuetext", st.min === "" ? "No minimum" : money(+st.min));
    $("#rMax").setAttribute("aria-valuetext", st.max === "" ? "No maximum" : money(+st.max));
  }
  let rt;
  const later = () => { clearTimeout(rt); rt = setTimeout(apply, 120); };
  $("#rMin").addEventListener("input", (e) => { let v = +e.target.value; if (v > +$("#rMax").value) { v = +$("#rMax").value; e.target.value = v; } st.min = v <= 0 ? "" : String(v2p(v)); reflectRange(); later(); });
  $("#rMax").addEventListener("input", (e) => { let v = +e.target.value; if (v < +$("#rMin").value) { v = +$("#rMin").value; e.target.value = v; } st.max = v >= 100 ? "" : String(v2p(v)); reflectRange(); later(); });
  $("#pMin").addEventListener("change", (e) => { st.min = e.target.value === "" ? "" : String(Math.max(0, +e.target.value)); reflectRange(); apply(); });
  $("#pMax").addEventListener("change", (e) => { st.max = e.target.value === "" ? "" : String(Math.max(0, +e.target.value)); reflectRange(); apply(); });
  $("#presets").addEventListener("click", (e) => { const b = e.target.closest("[data-pr]"); if (!b) return; const [a, z] = b.dataset.pr.split("-"); const on = st.min === a && st.max === z; st.min = on ? "" : a; st.max = on ? "" : z; reflectRange(); apply(); });

  // ---------- URL state (shareable searches) ----------
  function syncUrl() {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(st)) if (v !== "" && v !== false && !(k === "sort" && v === "feat")) p.set(k, v === true ? "1" : v);
    const s = p.toString();
    history.replaceState(null, "", s ? "?" + s : location.pathname);
  }
  function readUrl() {
    const p = new URLSearchParams(location.search);
    for (const k of Object.keys(st)) if (p.has(k)) st[k] = typeof st[k] === "boolean" ? p.get(k) === "1" : p.get(k);
    if (p.has("price")) { const [a, z] = p.get("price").split("-"); st.min = a || ""; st.max = z || ""; } // old links
  }
  function reflectControls() {
    $("#q").value = st.q;
    $("#fAuto").checked = st.auto; $("#fAward").checked = st.award; $("#fPlan").checked = st.plan; $("#fSale").checked = st.sale;
    $("#fTeam").value = st.team; $("#fSet").value = st.set; $("#sort").value = st.sort;
    reflectRange();
  }

  // ---------- controls ----------
  let qt;
  const shopTop = () => $("#shop").getBoundingClientRect().top;
  const scrollToEl = (el) => scrollTo({ top: el.getBoundingClientRect().top + scrollY - ($("#top").offsetHeight + 8), behavior: REDUCED ? "auto" : "smooth" });
  const scrollToShop = () => scrollToEl($("#shop"));
  $("#q").addEventListener("input", (e) => { clearTimeout(qt); qt = setTimeout(() => { const had = !!st.q; st.q = e.target.value; apply(); if (st.q && !had && shopTop() > innerHeight * 0.6) scrollToShop(); }, 140); });
  $("#q").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); clearTimeout(qt); st.q = e.target.value; apply(); scrollToShop(); } });
  $("#qClear").onclick = () => { st.q = ""; reflectControls(); apply(); $("#q").focus(); };
  $("#serialChips").addEventListener("click", (e) => { const b = e.target.closest("[data-serial]"); if (!b) return; st.serial = st.serial === b.dataset.serial ? "" : b.dataset.serial; apply(); });
  $("#rarityChips").addEventListener("click", (e) => { const b = e.target.closest("[data-rarity]"); if (!b) return; st.rarity = st.rarity === b.dataset.rarity ? "" : b.dataset.rarity; apply(); });
  $("#fAuto").onchange = (e) => { st.auto = e.target.checked; apply(); };
  $("#fAward").onchange = (e) => { st.award = e.target.checked; apply(); };
  $("#fPlan").onchange = (e) => { st.plan = e.target.checked; apply(); };
  $("#fSale").onchange = (e) => { st.sale = e.target.checked; apply(); };
  $("#fTeam").onchange = (e) => { st.team = e.target.value; apply(); };
  $("#fSet").onchange = (e) => { st.set = e.target.value; apply(); };
  $("#sort").onchange = (e) => { st.sort = e.target.value; apply(); };
  $("#more").onclick = renderMore;
  $("#reset").onclick = () => unset("all");
  $("#emptyReset").onclick = () => unset("all");
  $("#activeChips").addEventListener("click", (e) => { const b = e.target.closest("[data-unset]"); if (b) unset(b.dataset.unset); });
  // mobile filter sheet
  const setSheet = (on) => { $("#filters").classList.toggle("open", on); $("#fScrim").hidden = !on; $("#fOpen").setAttribute("aria-expanded", on); document.body.classList.toggle("lock", on); if (on) $("#fClose").focus(); };
  $("#fOpen").onclick = () => setSheet(true);
  $("#fClose").onclick = $("#fApply").onclick = $("#fScrim").onclick = () => { setSheet(false); $("#fOpen").focus(); };
  $$("[data-shelf]").forEach((b) => (b.onclick = () => { const s = $("#featured"); s.scrollBy({ left: +b.dataset.shelf * s.clientWidth * 0.85, behavior: REDUCED ? "auto" : "smooth" }); }));

  document.addEventListener("click", (e) => {
    const add = e.target.closest("[data-add]");
    if (add) { toggleCart(+add.dataset.add); return; }
    const op = e.target.closest("[data-open]");
    if (op) { openCard(+op.dataset.open, op); return; }
    if (e.target.closest("[data-viewcart]")) { openCart(); return; }
    if (e.target.closest("[data-close]")) closeAll();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { if ($("#filters").classList.contains("open")) setSheet(false); else closeAll(); }
    if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); $("#q").focus(); }
    if (!$("#cardModal").hidden && (e.key === "ArrowRight" || e.key === "ArrowLeft") && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) step(e.key === "ArrowRight" ? 1 : -1);
    if (e.key === "Tab") trap(e);
  });

  // ---------- dialogs (focus management) ----------
  let lastFocus = null;
  const openLayer = () => $$(".modal,.drawer").find((m) => !m.hidden);
  function closeAll() {
    const was = openLayer();
    $$(".modal,.drawer").forEach((m) => { m.hidden = true; m.classList.remove("in"); });
    document.body.classList.remove("lock");
    if (was && lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
  }
  function open(id) {
    if (!openLayer()) lastFocus = document.activeElement;
    $$(".modal,.drawer").forEach((m) => { if ("#" + m.id !== id) { m.hidden = true; m.classList.remove("in"); } });
    const el = $(id); el.hidden = false; document.body.classList.add("lock");
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("in")));
    setTimeout(() => { const f = el.querySelector(".x"); if (f && !el.contains(document.activeElement)) f.focus(); }, 30);
  }
  function trap(e) {
    const el = openLayer(); if (!el) return;
    const f = $$('button:not([disabled]),a[href],input:not([disabled]),select,textarea,summary,[tabindex]:not([tabindex="-1"])', el).filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (!el.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function syncAddButtons(id) {
    const c = BYID.get(id), i = cart.has(id);
    $$(`[data-add="${id}"]`).forEach((b) => {
      b.classList.toggle("in", i);
      if (b.classList.contains("big-add")) b.textContent = c.rs ? "On layaway · Reserved" : i ? "✓ In cart · remove" : "Add to cart";
      else if (!b.classList.contains("rm")) { b.textContent = i ? "✓ In cart" : "+ Add"; b.setAttribute("aria-label", addLabel(c, i)); }
    });
  }
  function toggleCart(id) {
    const c = BYID.get(id);
    if (!c || c.rs) return;
    if (cart.has(id)) { cart.delete(id); toast("Removed from cart", c, false); } else { cart.add(id); toast("Added to cart", c, true); bump(); }
    saveCart(); syncAddButtons(id);
    if (!$("#cart").hidden) renderCart();
  }
  function bump() { const b = $("#cartBtn"); b.classList.remove("bump"); void b.offsetWidth; b.classList.add("bump"); }
  let tt;
  function toast(m, c, withCart) {
    const t = $("#toast");
    t.innerHTML = c ? `<img src="img/t/${c.i}.webp" alt=""><span><b>${esc(m)}</b><small>${esc(name(c))} · ${money(price(c))}</small></span>${withCart ? '<button type="button" class="btn gold sm" data-viewcart>View cart</button>' : ""}` : `<span><b>${esc(m)}</b></span>`;
    t.hidden = false; t.classList.remove("show"); void t.offsetWidth; t.classList.add("show");
    clearTimeout(tt); tt = setTimeout(() => { t.classList.remove("show"); setTimeout(() => (t.hidden = true), 250); }, 2800);
  }

  // ---------- tilt + shine (mouse only, off for reduced motion) ----------
  if (FINE && !REDUCED) {
    let raf = 0, tgt = null, ev = null;
    const reset = (el) => { el.classList.remove("tilting"); el.style.removeProperty("--rx"); el.style.removeProperty("--ry"); };
    document.addEventListener("pointermove", (e) => {
      ev = e; const t = e.target.closest ? e.target.closest(".tilt") : null;
      if (tgt && tgt !== t) reset(tgt);
      tgt = t; if (!t || raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0; if (!tgt) return;
        const r = tgt.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width, y = (ev.clientY - r.top) / r.height;
        const k = tgt.classList.contains("ph") ? 10 : 14;
        tgt.style.setProperty("--rx", ((0.5 - y) * k).toFixed(2) + "deg");
        tgt.style.setProperty("--ry", ((x - 0.5) * k).toFixed(2) + "deg");
        tgt.style.setProperty("--mx", (x * 100).toFixed(1) + "%");
        tgt.style.setProperty("--my", (y * 100).toFixed(1) + "%");
        tgt.classList.add("tilting");
      });
    }, { passive: true });
    document.documentElement.addEventListener("pointerleave", () => tgt && reset(tgt));
  }

  // ---------- quick view ----------
  let ctx = [], cur = 0;
  function ctxFor(src) {
    if (!src) return [];
    if (src.closest("#grid")) return view.map((c) => c.i);
    if (src.closest("#spot")) { const f = featList().map((c) => c.i), id = +src.dataset.open; return f.includes(id) ? f : [id, ...f]; }
    const box = src.closest("[data-ctx]");
    return box ? [...new Set($$("[data-open]", box).map((b) => +b.dataset.open))] : [];
  }
  function step(d) { if (ctx.length < 2) return; const k = (ctx.indexOf(cur) + d + ctx.length) % ctx.length; openCard(ctx[k]); }
  $("#cdPrev").onclick = () => step(-1); $("#cdNext").onclick = () => step(1);
  function metaRows(c) { return [["Team", c.t], ["Set", c.s], ["Rarity", c.r], ["Serial", c.n], ["Autograph", c.a ? "Yes" : ""], ["Award", c.w ? "Yes" : ""], ["App", c.g], ["Card ID", "#" + c.i]].filter((r) => r[1]).map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join(""); }
  function openCard(id, src) {
    const c = BYID.get(id); if (!c) return;
    if (src) ctx = ctxFor(src);
    if (!ctx.includes(id)) ctx = [id];
    cur = id;
    const img = $("#cdImg"); img.classList.remove("ld"); img.onload = () => img.classList.add("ld"); img.src = `img/l/${c.i}.webp`; img.alt = alt(c);
    $("#cdTags").innerHTML = tags(c, true);
    $("#cdName").textContent = name(c);
    $("#cdSub").textContent = sub(c);
    $("#cdMeta").innerHTML = metaRows(c);
    $("#cdPrice").innerHTML = bigPrice(c);
    const b = $("#cdAdd"); b.dataset.add = c.i; b.disabled = !!c.rs; syncAddButtons(c.i);
    $("#cdPos").textContent = ctx.length > 1 ? `${ctx.indexOf(id) + 1} of ${ctx.length.toLocaleString()}` : "";
    $("#cdPrev").hidden = $("#cdNext").hidden = ctx.length < 2;
    const pb = $("#cdPlan");
    pb.hidden = !(c.l && LAY.enabled && !c.rs);
    if (!pb.hidden) {
      pb.innerHTML = `<div class="pb-head"><span class="tag lay">Payment plan available</span><h4>Payment plan calculator</h4></div><p class="muted small">${LAY.down_pct}% down today (non-refundable), the rest over 1–${maxWeeks()} weeks, weekly or as one lump sum. Card delivered after the final payment.</p>
        <div class="row"><label class="lbl">Plan length <select id="cdWeeks">${weekOpts()}</select></label><label class="lbl">Pay the rest <select id="cdType">${planTypes().map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></label></div>
        <div class="pb-sum" id="cdSum" aria-live="polite"></div><details class="pb-det"><summary>Full schedule</summary><div id="cdSched"></div></details>`;
      const upd = () => {
        const w = +$("#cdWeeks").value, ty = $("#cdType").value, sc = planSchedule(price(c), w, ty);
        $("#cdSum").innerHTML = `<div><small>Due today</small><b>${money2(sc.down)}</b></div>` + (ty === "lump" ? `<div><small>Balance ${esc(sc.rows[1].date.replace(/^By/, "by"))}</small><b>${money2(sc.rest)}</b></div>` : `<div><small>Then weekly</small><b>${money2(sc.rows[1].amt)} × ${w}</b></div>`);
        $("#cdSched").innerHTML = schedTable(sc);
      };
      $("#cdWeeks").onchange = upd; $("#cdType").onchange = upd; upd();
    }
    if ($("#cardModal").hidden) open("#cardModal");
  }

  // ---------- featured card spotlight ----------
  function spotCard() {
    const want = BYID.get(+C.featured_card_id);
    if (want && !want.rs && (!st.sport || want.g === st.sport)) return want;
    return featList().filter((c) => !c.rs).sort((a, b) => price(b) - price(a))[0];
  }
  function renderSpot() {
    const c = spotCard();
    $("#spot").hidden = !c; if (!c) return;
    if ($("#spot").dataset.id === String(c.i) && $("#spot").dataset.p === String(price(c))) return;
    $("#spot").dataset.id = c.i; $("#spot").dataset.p = price(c);
    $("#spotImg").src = `img/l/${c.i}.webp`; $("#spotImg").alt = alt(c);
    $("#spotTags").innerHTML = tags(c, true);
    $("#spotName").textContent = name(c);
    $("#spotSub").textContent = [c.s, c.t].filter(Boolean).join(" · ");
    $("#spotPrice").innerHTML = bigPrice(c);
    const pl = c.l && LAY.enabled && !c.rs;
    $("#spotPlan").hidden = !pl;
    if (pl) { const sc = planSchedule(price(c), LAY.default_weeks || 4, "weekly"); $("#spotPlan").innerHTML = `<span class="tag lay">Payment plan available</span> Take it home for <b>${money2(sc.down)}</b> down (${LAY.down_pct}%, non-refundable), then ${money2(sc.rows[1].amt)}/week for ${LAY.default_weeks || 4} weeks, or pick 1–${maxWeeks()} weeks at checkout. Delivered after the final payment.`; }
    $("#spotAdd").dataset.add = c.i; $("#spotAdd").disabled = !!c.rs; syncAddButtons(c.i);
    $("#spotQV").dataset.open = c.i; $("#spotStage").dataset.open = c.i; $("#spotStage").setAttribute("role", "button"); $("#spotStage").tabIndex = 0; $("#spotStage").setAttribute("aria-label", "Quick view: " + name(c));
    $("#spotMeta").innerHTML = metaRows(c);
  }
  $("#spotStage").addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openCard(+e.currentTarget.dataset.open, e.currentTarget); } });

  // ---------- cart drawer + checkout pane ----------
  function renderCartBadge() {
    $("#cartCount").textContent = cart.size;
    $("#cartTotalTop").textContent = money(cartTotal());
    $("#cartBtn").setAttribute("aria-label", `Open cart, ${cart.size} item${cart.size === 1 ? "" : "s"}, ${money(cartTotal())}`);
  }
  function renderCart() {
    const cs = cartCards();
    $("#cartItems").innerHTML = cs.length ? cs.map((c) => `<div class="ci"><button class="ci-img" data-open="${c.i}" aria-label="Quick view ${esc(name(c))}"><img src="img/t/${c.i}.webp" alt=""></button><div class="d"><div class="nm">${esc(name(c))}</div><div class="sub">${esc(sub(c))}</div><div class="ci-tags">${tags(c)}</div></div>${priceHtml(c, "p")}<button class="rm" data-add="${c.i}" aria-label="Remove ${esc(name(c))}">×</button></div>`).join("")
      : '<div class="cart-empty"><p><b>Your cart is empty.</b></p><p class="muted small">Browse the vault or search for a player to get started.</p><button class="btn ghost" type="button" data-close>Keep shopping</button></div>';
    const sv = cartSavings();
    $("#cartTotal").innerHTML = (sv > 0 ? `<small class="saved">You save ${money2(sv)}</small> ` : "") + money2(cartTotal());
    $("#toCheckout").disabled = !cs.length;
    const pc = cs.filter((c) => c.l && LAY.enabled);
    $("#cartPlanNote").hidden = !pc.length;
    if (pc.length) $("#cartPlanNote").textContent = `Payment plan available at checkout for ${pc.length} card${pc.length > 1 ? "s" : ""}: ${LAY.down_pct}% down today, rest over up to ${maxWeeks()} weeks.`;
  }
  function pane(which) {
    const co = which === "checkout";
    $("#cartPane").hidden = co; $("#checkout").hidden = !co; $("#coBack").hidden = !co;
    $("#drawerTitle").textContent = co ? "Checkout" : "Your cart";
    $("#stepCart").classList.toggle("on", !co); $("#stepCo").classList.toggle("on", co);
    $("#cart .drawer-box").classList.toggle("wide", co);
  }
  function openCart() { renderCart(); pane("cart"); open("#cart"); }
  $("#cartBtn").onclick = openCart;
  $("#coBack").onclick = () => { pane("cart"); renderCart(); $("#toCheckout").focus(); };
  $("#clearCart").onclick = () => { const ids = [...cart]; cart.clear(); saveCart(); renderCart(); ids.forEach(syncAddButtons); };
  $("#toCheckout").onclick = () => { if (cart.size) openCheckout(); };

  // ---------- checkout ----------
  let orderCode = "";
  const P = C.payments || {};
  const ppReady = P.paypal_client_id && !/REPLACE_ME/i.test(P.paypal_client_id);
  function buyer() { return { user: $("#coUser").value.trim(), email: $("#coEmail").value.trim(), note: $("#coNote").value.trim() }; }
  function validBuyer(show) {
    const b = buyer();
    let err = "", bad = null;
    if (!b.user) { err = "Please enter your Topps Collect username so I know where to send the cards."; bad = "#coUser"; }
    else if (!/^\S+@\S+\.\S+$/.test(b.email)) { err = "Please enter a valid email."; bad = "#coEmail"; }
    else if (isPlan() && !$("#planAgree").checked) { err = "Please accept the payment plan terms (the down payment is non-refundable)."; bad = "#planAgree"; }
    if (show) { $("#coUser").setAttribute("aria-invalid", bad === "#coUser"); $("#coEmail").setAttribute("aria-invalid", bad === "#coEmail"); }
    $("#coErr").hidden = !(show && err); $("#coErr").textContent = err;
    if (show && bad) $(bad).focus();
    return !err;
  }
  const planCards = () => cartCards().filter((c) => c.l && LAY.enabled);
  const isPlan = () => !$("#payMode").hidden && $('input[name="pm"]:checked')?.value === "plan";
  function planInfo() {
    if (!isPlan()) return null;
    const elig = r2(planCards().reduce((s, c) => s + price(c), 0)), other = r2(cartTotal() - elig);
    const weeks = +$("#planWeeks").value, type = $("#planType").value;
    const sc = planSchedule(elig, weeks, type);
    return { elig, other, weeks, type, sc, today: r2(other + sc.down) };
  }
  const dueToday = () => (planInfo()?.today ?? cartTotal());
  function refreshPlan() {
    const pc = planCards();
    $("#payMode").hidden = !pc.length;
    if (pc.length) {
      $("#pmFullAmt").textContent = money2(cartTotal()) + " today, cards sent right after payment";
      $("#pmPlanHint").textContent = `${LAY.down_pct}% down today (non-refundable), rest over 1–${maxWeeks()} weeks. Applies to ${pc.length} eligible card${pc.length > 1 ? "s" : ""} (${money2(pc.reduce((s, c) => s + price(c), 0))}).`;
    }
    $("#planOpts").hidden = !isPlan();
    $$(".opt").forEach((o) => o.classList.toggle("on", o.querySelector("input").checked));
    const p = planInfo();
    if (p) $("#schedule").innerHTML = schedTable(p.sc, p.other) + `<p class="small" style="margin:0">Due today: <b>${money2(p.today)}</b> · Plan total: ${money2(cartTotal())}</p>`;
    $("#dueToday").textContent = money2(dueToday());
    refreshManual();
  }
  function scheduleText() {
    const p = planInfo(); if (!p) return "";
    return [`PAYMENT PLAN: ${p.weeks} week(s), ${p.type === "lump" ? "lump sum" : "weekly payments"}. Cards delivered after final payment. ${LAY.down_pct}% down is non-refundable.`,
      ...(p.other ? [`- Today: ${money2(p.other)} other cards paid in full`] : []), ...p.sc.rows.map((r) => `- ${r.date}: ${money2(r.amt)} (${r.label})`)].join("\n");
  }
  const saleNote = (c) => (saleLive(c) ? ` (sale, was ${money2(c.$)})` : "");
  // one machine-readable line Josh can paste into verify_order.py
  function orderLine() {
    const cs = cartCards(), p = planInfo();
    return `ORDER code=${orderCode} ids=${cs.map((c) => c.i).join(",")} prices=${cs.map((c) => price(c).toFixed(2)).join(",")} total=${cartTotal().toFixed(2)} plan=${p ? `${p.weeks}w-${p.type === "lump" ? "lump" : "weekly"}` : "full"} due_now=${dueToday().toFixed(2)}`;
  }
  function summaryText(method) {
    const b = buyer(), cs = cartCards();
    return [`Order ${orderCode} (${C.site?.name || "shop"})`, `Topps Collect username: ${b.user || "(enter above)"}`, `Email: ${b.email || "(enter above)"}`, b.note ? `Note: ${b.note}` : "", method ? `Payment: ${method}` : "",
      `Cards (${cs.length}):`, ...cs.map((c) => `- #${c.i} ${name(c)}${c.n ? " " + c.n : ""}${c.a ? " Auto" : ""} [${c.r}] ${money2(price(c))}${saleNote(c)}`), `Total: ${money2(cartTotal())}`, isPlan() ? `Due today: ${money2(dueToday())}` : "", scheduleText(), orderLine()].filter(Boolean).join("\n");
  }
  function refreshManual() {
    const t = dueToday().toFixed(2);
    $("#mAmt").textContent = money2(dueToday()) + (isPlan() ? " (today's payment)" : "");
    $("#mCode").textContent = orderCode;
    $("#mPaypal").href = `https://paypal.me/${encodeURIComponent(P.paypal_me || "")}/${t}`;
    $("#mPaypal").textContent = `PayPal.me/${P.paypal_me}`;
    $("#mVenmo").href = `https://venmo.com/u/${encodeURIComponent(P.venmo_handle || "")}`;
    $("#mVenmo").textContent = `Venmo @${P.venmo_handle}`;
    $("#mSummary").value = summaryText("PayPal.me / Venmo (manual)");
  }
  function openCheckout() {
    orderCode = "TC-" + Date.now().toString(36).toUpperCase().slice(-6);
    const sv = cartSavings();
    $("#coSummaryLine").innerHTML = `<b>${cart.size} card${cart.size === 1 ? "" : "s"}</b> · ${money2(cartTotal())}${sv > 0 ? ` <span class="saved">(you save ${money2(sv)})</span>` : ""} · order <b>${esc(orderCode)}</b>`;
    $("#coThumbs").innerHTML = cartCards().slice(0, 8).map((c) => `<img src="img/t/${c.i}.webp" alt="${esc(name(c))}" title="${esc(name(c))} · ${money(price(c))}">`).join("") + (cart.size > 8 ? `<span>+${cart.size - 8}</span>` : "");
    $("#coOk").hidden = true; $("#coErr").hidden = true;
    $("#coUser").value = localStorage.getItem("tc_user") || ""; $("#coEmail").value = localStorage.getItem("tc_email") || "";
    $("#coUser").removeAttribute("aria-invalid"); $("#coEmail").removeAttribute("aria-invalid");
    $("#planWeeks").innerHTML = weekOpts();
    $("#planType").innerHTML = planTypes().map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
    $("#agreePct").textContent = LAY.down_pct ?? 20;
    $("#termsList").innerHTML = (LAY.terms || []).map((t) => `<li>${esc(t)}</li>`).join("");
    $("#planAgree").checked = false;
    $('input[name="pm"][value="full"]').checked = true;
    refreshPlan();
    if ($("#cart").hidden) open("#cart");
    pane("checkout");
    $(".co-scroll").scrollTop = 0;
    setTimeout(() => $("#coUser").focus({ preventScroll: true }), 60);
    if (ppReady) renderPayPal(); else { $("#ppNote").hidden = false; $("#manual").open = true; }
  }
  $$('input[name="pm"]').forEach((r) => (r.onchange = refreshPlan));
  $("#planAgree").addEventListener("change", () => { if (!$("#coErr").hidden) validBuyer(true); });
  $("#planWeeks").onchange = refreshPlan; $("#planType").onchange = refreshPlan;
  ["#coUser", "#coEmail", "#coNote"].forEach((s) => $(s).addEventListener("input", () => { refreshManual(); $(s).removeAttribute("aria-invalid"); if (!$("#coErr").hidden && validBuyer(false)) $("#coErr").hidden = true; localStorage.setItem("tc_user", $("#coUser").value); localStorage.setItem("tc_email", $("#coEmail").value); }));
  $("#mCopy").onclick = async () => {
    try { await navigator.clipboard.writeText($("#mSummary").value); } catch { $("#mSummary").select(); document.execCommand("copy"); }
    toast("Order summary copied");
  };
  $("#mSubmit").onclick = async () => {
    if (!validBuyer(true)) return;
    await notify("manual (PayPal.me/Venmo)", null);
    done(`Order <b>${orderCode}</b> submitted. Send <b>${money2(dueToday())}</b> to PayPal.me/${esc(P.paypal_me)} or Venmo @${esc(P.venmo_handle)} with <b>${orderCode}</b> in the note. ${isPlan() ? "Your plan card(s) are reserved; keep paying on the schedule and they're sent after the final payment." : `Cards go to <b>${esc(buyer().user)}</b> once payment arrives.`}`, false);
  };

  async function notify(method, paypalDetails) {
    const ep = C.orders?.formspree_endpoint;
    const b = buyer();
    const payload = { order: orderCode, method, topps_username: b.user, email: b.email, _replyto: b.email, note: b.note, total: cartTotal().toFixed(2), due_today: dueToday().toFixed(2), payment_plan: scheduleText() || "pay in full", order_line: orderLine(),
      cards: cartCards().map((c) => `#${c.i} ${name(c)} ${c.n || ""} ${money2(price(c))}${saleNote(c)}`).join("\n"), summary: summaryText(method),
      paypal_order_id: paypalDetails?.id || "", paypal_payer: paypalDetails?.payer?.email_address || "" };
    if (!ep) { console.info("No order notification endpoint configured yet; order:", payload); return false; }
    try {
      const r = await fetch(ep, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(payload) });
      return r.ok;
    } catch (e) { console.error(e); return false; }
  }
  function done(html, clear = true) {
    $("#coOk").innerHTML = html + `<br><br><span class="muted small">Copy of your order:</span><textarea readonly rows="6" aria-label="Copy of your order">${esc(summaryText(""))}</textarea>`;
    $("#coOk").hidden = false;
    $("#coOk").scrollIntoView({ behavior: REDUCED ? "auto" : "smooth" });
    if (clear) { const ids = [...cart]; cart.clear(); saveCart(); ids.forEach(syncAddButtons); }
  }

  let sdkP;
  function loadSdk() {
    if (sdkP) return sdkP;
    sdkP = new Promise((res, rej) => {
      const s = document.createElement("script");
      const q = new URLSearchParams({ "client-id": P.paypal_client_id, currency: C.site?.currency || "USD", intent: "capture" });
      if (P.enable_venmo) q.set("enable-funding", "venmo");
      s.src = "https://www.paypal.com/sdk/js?" + q; s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
    return sdkP;
  }
  async function renderPayPal() {
    const box = $("#ppButtons"); box.innerHTML = '<p class="muted small">Loading PayPal…</p>';
    try { await loadSdk(); } catch { box.innerHTML = ""; $("#ppNote").hidden = false; $("#manual").open = true; return; }
    box.innerHTML = "";
    window.paypal.Buttons({
      style: { layout: "vertical", color: "gold", shape: "rect", label: "pay" },
      onClick: (_d, actions) => validBuyer(true) ? actions.resolve() : actions.reject(),
      createOrder: (_d, actions) => {
        const cs = cartCards(), plan = planInfo(), total = dueToday().toFixed(2);
        return actions.order.create({ purchase_units: [{
          reference_id: orderCode, custom_id: (buyer().user + "").slice(0, 127),
          description: `Topps Collect digital cards to ${buyer().user}`.slice(0, 127),
          amount: { currency_code: C.site?.currency || "USD", value: total, breakdown: { item_total: { currency_code: C.site?.currency || "USD", value: total } } },
          items: plan ? [{ name: `Order ${orderCode}: today's payment (${LAY.down_pct}% down plan + any paid-in-full cards)`.slice(0, 127), quantity: "1", category: "DIGITAL_GOODS", unit_amount: { currency_code: C.site?.currency || "USD", value: total } }] : cs.map((c) => ({ name: `#${c.i} ${name(c)} ${c.n || ""}`.slice(0, 127), quantity: "1", category: "DIGITAL_GOODS", unit_amount: { currency_code: C.site?.currency || "USD", value: price(c).toFixed(2) } })),
        }], application_context: { shipping_preference: "NO_SHIPPING" } });
      },
      onApprove: async (_d, actions) => {
        const det = await actions.order.capture();
        await notify("PayPal/Venmo checkout", det);
        const wasPlan = !!planInfo(), sched = scheduleText();
        done(wasPlan ? `Down payment received, order <b>${orderCode}</b>. Your card(s) are reserved. Send the remaining payments to PayPal.me/${esc(P.paypal_me)} or Venmo @${esc(P.venmo_handle)} with <b>${orderCode}</b> in the note:<pre class="small">${esc(sched)}</pre>Cards are sent to <b>${esc(buyer().user)}</b> after the final payment.` : `Payment received, thank you! Order <b>${orderCode}</b>. Your cards will be sent to <b>${esc(buyer().user)}</b> in Topps Collect.`);
      },
      onError: (err) => { console.error(err); $("#coErr").hidden = false; $("#coErr").textContent = "PayPal had a problem. Try again or use the manual option below."; },
    }).render(box);
  }

  // ---------- sport tabs + featured + specials ----------
  const SPORTS = (C.sports?.list || []);
  function renderSports() {
    const cnt = (k) => CARDS.filter((c) => !k || c.g === k).length;
    const tabs = [{ key: "", label: "All", emoji: "🃏" }, ...SPORTS];
    $("#sports").innerHTML = tabs.map((t) => { const n = cnt(t.key), on = st.sport === t.key; return `<button class="sport${on ? " on" : ""}" data-sport="${esc(t.key)}" aria-pressed="${on}"><span class="em" aria-hidden="true">${t.emoji || ""}</span>${esc(t.label)} ${n ? `<span class="ct">${n.toLocaleString()}</span>` : '<span class="soon-pill">Soon</span>'}</button>`; }).join("");
    $$("[data-sport]").forEach((b) => (b.onclick = () => { st.sport = b.dataset.sport; renderSports(); apply(); }));
  }
  const featList = () => CARDS.filter((c) => c.f && (!st.sport || c.g === st.sport)).sort((a, b) => (a._d || 1e4) - (b._d || 1e4) || price(b) - price(a));
  function renderFeatured() {
    const feat = featList();
    $("#featuredSec").hidden = !feat.length;
    $("#featured").innerHTML = feat.map(tile).join("");
    $("#featured").dataset.ctx = "feat";
    $("#featCount").textContent = `${feat.length} premium card${feat.length === 1 ? "" : "s"}`;
  }
  function renderSpecials() {
    const groups = (C.specials || []).map((s) => ({ ...s, cards: (s.ids || []).map((i) => BYID.get(i)).filter((c) => c && saleLive(c) && (!st.sport || c.g === st.sport)) })).filter((g) => g.cards.length && (!g.ends || g.ends >= todayStr));
    $("#specialsSec").hidden = !groups.length;
    $("#fSaleWrap").hidden = !CARDS.some(saleLive);
    if (!groups.length) { $("#specials").innerHTML = ""; return; }
    $("#specCount").textContent = `${groups.reduce((s, g) => s + g.cards.length, 0)} cards on sale`;
    $("#specials").innerHTML = groups.map((g, k) => `<div class="spec">
        <div class="spec-head"><span class="tag sale">${esc(g.badge || "Sale")}</span><h3>${esc(g.title)}</h3>${g.ends ? `<span class="ends">${esc(endsLabel(g.ends))}</span>` : ""}${g.note ? `<span class="muted small">${esc(g.note)}</span>` : ""}</div>
        <div class="shelf" data-ctx="spec${k}">${g.cards.map(tile).join("")}</div></div>`).join("");
  }

  // ---------- hero carousel ----------
  const car = { items: [], i: 0, timer: 0, paused: REDUCED, hold: false, key: "" };
  function buildCarousel() {
    const items = CARDS.filter((c) => (c.f || saleLive(c)) && !c.rs && (!st.sport || c.g === st.sport)).sort((a, b) => price(b) - price(a)).slice(0, 9);
    const key = items.map((c) => c.i + ":" + price(c)).join(",");
    if (key === car.key) return;
    car.key = key; car.items = items; car.i = 0;
    $("#carousel").hidden = items.length < 2;
    if (items.length < 2) { stopCar(); return; }
    $("#carStage").innerHTML = items.map((c, k) => `<button class="car-item tilt" data-open="${c.i}" data-k="${k}" aria-label="Quick view: ${esc(name(c))}${c.n ? " " + esc(c.n) : ""}, ${money(price(c))}"><img src="img/l/${c.i}.webp" alt="${esc(alt(c))}" width="194" height="270" decoding="async"><span class="shine" aria-hidden="true"></span><span class="rib">${tags(c)}</span></button>`).join("");
    $("#carStage").dataset.ctx = "car";
    $("#carDots").innerHTML = items.map((c, k) => `<button type="button" class="dot" data-dot="${k}" aria-label="Show ${esc(name(c))}"></button>`).join("");
    layoutCar(); startCar();
  }
  function layoutCar() {
    const n = car.items.length;
    $$(".car-item").forEach((el, k) => {
      let o = k - car.i; if (o > n / 2) o -= n; if (o < -n / 2) o += n;
      const a = Math.abs(o);
      el.style.setProperty("--o", o); el.style.setProperty("--a", a);
      el.style.zIndex = 10 - a; el.classList.toggle("act", o === 0); el.classList.toggle("far", a > 2);
      el.tabIndex = o === 0 ? 0 : -1; if (a > 2) el.setAttribute("aria-hidden", "true"); else el.removeAttribute("aria-hidden");
    });
    $$("#carDots .dot").forEach((d, k) => { d.classList.toggle("on", k === car.i); d.setAttribute("aria-current", k === car.i ? "true" : "false"); });
    const c = car.items[car.i];
    $("#carCap").innerHTML = c ? `<b>${esc(name(c))}</b> <span class="muted">${esc([c.n, c.a ? "Auto" : "", c.s].filter(Boolean).join(" · "))}</span> ${priceHtml(c)}` : "";
  }
  function go(d) { const n = car.items.length; if (!n) return; car.i = (car.i + d + n) % n; layoutCar(); }
  function startCar() { stopCar(); if (car.paused || car.hold || car.items.length < 2 || document.hidden) return; car.timer = setInterval(() => go(1), 3400); }
  function stopCar() { clearInterval(car.timer); car.timer = 0; }
  function setPlay() { const b = $("#carPlay"); b.textContent = car.paused ? "▶" : "❚❚"; b.setAttribute("aria-label", car.paused ? "Play rotation" : "Pause rotation"); b.setAttribute("aria-pressed", String(car.paused)); }
  $("#carPrev").onclick = () => { go(-1); startCar(); };
  $("#carNext").onclick = () => { go(1); startCar(); };
  $("#carPlay").onclick = () => { car.paused = !car.paused; setPlay(); startCar(); };
  $("#carDots").addEventListener("click", (e) => { const d = e.target.closest("[data-dot]"); if (d) { car.i = +d.dataset.dot; layoutCar(); startCar(); } });
  const cEl = $("#carousel");
  cEl.addEventListener("mouseenter", () => { car.hold = true; stopCar(); });
  cEl.addEventListener("mouseleave", () => { car.hold = false; startCar(); });
  cEl.addEventListener("focusin", () => { car.hold = true; stopCar(); });
  cEl.addEventListener("focusout", (e) => { if (!cEl.contains(e.relatedTarget)) { car.hold = false; startCar(); } });
  let tx = 0, ty = 0, swiped = false, rel = 0;
  cEl.addEventListener("touchstart", (e) => { tx = e.touches[0].clientX; ty = e.touches[0].clientY; swiped = false; car.hold = true; stopCar(); clearTimeout(rel); }, { passive: true });
  cEl.addEventListener("touchend", (e) => {
    const dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) { swiped = true; go(dx < 0 ? 1 : -1); }
    rel = setTimeout(() => { car.hold = false; startCar(); }, 5000);
  }, { passive: true });
  // clicking any card opens quick view (a side card also rotates to the front)
  $("#carStage").addEventListener("click", (e) => {
    const it = e.target.closest(".car-item"); if (!it) return;
    if (swiped) { swiped = false; e.stopPropagation(); return; }
    if (!it.classList.contains("act")) { car.i = +it.dataset.k; layoutCar(); } // bring it to the front, then open quick view
  }, true);
  cEl.addEventListener("keydown", (e) => { if (e.key === "ArrowRight") { go(1); e.preventDefault(); } if (e.key === "ArrowLeft") { go(-1); e.preventDefault(); } });
  document.addEventListener("visibilitychange", () => (document.hidden ? stopCar() : startCar()));

  // ---------- header / scroll ----------
  let sTick = false;
  addEventListener("scroll", () => { if (sTick) return; sTick = true; requestAnimationFrame(() => { sTick = false; const y = scrollY; $("#top").classList.toggle("scrolled", y > 10); $("#toTop").hidden = y < 1400; }); }, { passive: true });
  $("#toTop").onclick = () => { scrollTo({ top: 0, behavior: REDUCED ? "auto" : "smooth" }); $("#q").focus({ preventScroll: true }); };
  $("#ctaFeat").addEventListener("click", (e) => { const t = !$("#specialsSec").hidden ? $("#specialsSec") : $("#featuredSec"); if (t.hidden) return; e.preventDefault(); scrollToEl(t); });

  // ---------- boot ----------
  async function boot() {
    const nm = C.site?.name; if (nm) { document.title = nm; $("#siteName").textContent = nm; $("#heroTitle").textContent = nm; }
    $("#tagline").textContent = C.site?.tagline || "";
    $("#buildInfo").textContent = `Updated ${C.build || ""}` + (C.site?.contact_email && !/example\.com/.test(C.site.contact_email) ? ` · Questions: ${C.site.contact_email}` : "");
    $("#payInfo").textContent = `Payments: PayPal (paypal.me/${P.paypal_me || ""}) or Venmo @${P.venmo_handle || ""}.` + (LAY.enabled ? ` Payment plans on high-end cards: ${LAY.down_pct}% down (non-refundable), 1–${maxWeeks()} weeks.` : "");
    CARDS = await (await fetch("data/cards.json", { cache: "no-cache" })).json();
    for (const c of CARDS) {
      const m = /\/\s*(\d+)\s*$/.exec(c.n || "");
      c._d = c.k === "1/1" ? 1 : m ? +m[1] : 0;
      c._h = [c.p, c.t, c.s, c.n, c.r, "#" + c.i, c.a ? "auto autograph" : "", c.w ? "award" : "", saleLive(c) ? "sale special" : ""].join(" ").toLowerCase();
      BYID.set(c.i, c);
    }
    for (const id of [...cart]) if (!BYID.has(id)) cart.delete(id); // sold/removed
    renderCartBadge();
    const dn = (k) => (k === "1/1" ? 1 : +k.slice(1));
    SERIALS = [...new Set(CARDS.map(serKey).filter(Boolean))].sort((a, b) => dn(a) - dn(b));
    RARITIES = [...new Set(CARDS.map((c) => c.r).filter(Boolean))].sort((a, b) => (a === "Legendary" ? -1 : b === "Legendary" ? 1 : a.localeCompare(b)));
    const opts = (vals) => [...new Set(vals.filter(Boolean))].sort((a, b) => a.localeCompare(b)).map((v) => `<option>${esc(v)}</option>`).join("");
    $("#fTeam").insertAdjacentHTML("beforeend", opts(CARDS.map((c) => c.t)));
    $("#fSet").insertAdjacentHTML("beforeend", opts(CARDS.map((c) => c.s)));
    const ps = CARDS.map(price);
    PMIN = Math.max(1, Math.floor(Math.min(...ps))); PMAX = Math.max(PMIN + 1, Math.ceil(Math.max(...ps)));
    $("#fPlanWrap").hidden = !LAY.enabled;
    const n1 = CARDS.filter((c) => c._d === 1).length, nLow = CARDS.filter((c) => c._d && c._d <= 10).length, nPlan = CARDS.filter((c) => c.l && !c.rs).length;
    $("#stats").innerHTML = `<div><dt>Cards listed</dt><dd>${CARDS.length.toLocaleString()}</dd></div><div><dt>1/1 cards</dt><dd>${n1}</dd></div><div><dt>Numbered /10 or lower</dt><dd>${nLow}</dd></div>` + (LAY.enabled ? `<div><dt>Payment-plan cards</dt><dd>${nPlan}</dd></div>` : "");
    readUrl(); setPlay(); renderSports(); reflectControls(); apply();
  }
  boot();
})();
