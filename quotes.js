/* Zpar Connect — Install Quotes (Admins only)
   Upload a supplier quote → read it (free GFS/RTT reader, or paste results from a Claude chat)
   → the admin reviews the inputs → priced with the 4-Man Install & Wiring Calculator rules →
   saved by quote number + customer, with a printable summary and an .xlsx download.
   Rates are NOT in this file: they live in the database (Install Quotes → Rates, Admins only). */
(function () {
  "use strict";

  // ---------- rate fields (values come from the install_settings table) ----------
  const MATS = [
    ["lights", "Lights"], ["amu", "AMU"], ["rollup_doors", "Roll-up doors"], ["solenoid", "Solenoid valve"],
    ["door_switches", "Door switches"], ["dust_collector", "Dust collector modules"], ["panels", "Oven burner and/or control panels"],
    ["exhaust_fans", "Oven/booth exhaust fans/motors"], ["recirc_fans", "Oven recirc fans"], ["probes", "Oven probes/switches/louvers"],
    ["air_seals", "Oven air seals"],
  ];
  const RATE_GROUPS = [
    ["Install crew", [["crew_day", "Crew labor per paid build day", "$"], ["crew_size", "Crew size (people)"], ["trucks", "Trucks"], ["truck_day", "Truck use per build day", "$"],
      ["truck_ins_day", "Truck insurance per build day", "$"], ["workers_comp_day", "Workers comp per build day", "$"], ["tools_day", "Tools + new hardware per build day", "$"]]],
    ["Install travel", [["gas_mile", "Gas per mile, per truck", "$"], ["lodging_day", "Lodging per day on location", "$"], ["food_person_day", "Food per person per day", "$"]]],
    ["Install extras", [["weld_day", "Welding per day", "$"], ["flight", "Flight, per round-trip ticket", "$"], ["door_sqft", "Overhead door install per sq ft", "$"],
      ["amu_startup_1", "AMU startup — one unit", "$"], ["amu_startup_2", "AMU startup — two units", "$"], ["amu_startup_extra", "AMU startup — per unit beyond two", "$"]]],
    ["Wiring crew & travel", [["jman_day", "Journeyman per wiring day", "$"], ["helper_day", "Helper per wiring day", "$"], ["w_truck_day", "Truck use per wiring day", "$"],
      ["w_gas_mile", "Gas per mile", "$"], ["hotel_day", "Hotel per day on location", "$"], ["w_food_day", "Food per day on location", "$"],
      ["w_truck_ins_day", "Truck insurance per day on location", "$"], ["helper_travel_day", "Helper travel per day on location", "$"]]],
    ["Electrical material (per device)", MATS.map(([k, l]) => ["mat_" + k, l, "$"])],
    ["Travel rules", [["miles_per_drive_day", "Driving miles per travel day"], ["mile_buffer_pct", "Local-miles buffer on round trip", "%"]]],
    ["Market, overhead & margins", [["market_pct", "Market adjustment (applied to all costs; use − for decreases)", "%"], ["overhead_pct", "Overhead (added after market adjustment)", "%"],
      ["margin_low_pct", "Lower margin", "%"], ["margin_high_pct", "Higher margin", "%"]]],
  ];

  function blankInputs() {
    return { one_way_miles: 0, travel_auto: true, travel_days: 0, install_days: 0, wiring_days: 0, helper: 1, include_wiring: true,
      counts: Object.fromEntries(MATS.map(([k]) => [k, 0])), welding_days: 0, overhead_sqft: 0, amu_units: 0, flight_tickets: 0, finders_fee: 0 };
  }
  const num = (v) => { const n = Number(v); return isFinite(n) && n > 0 ? n : 0; };
  const sn = (v) => { const n = Number(v); return isFinite(n) ? n : 0; }; // signed (market % can be negative)
  const r2 = (n) => Math.round(n * 100) / 100;
  const amuStartup = (n, R) => (n <= 0 ? 0 : n === 1 ? num(R.amu_startup_1) : num(R.amu_startup_2) + Math.max(0, n - 2) * num(R.amu_startup_extra));
  const pct = (R, k) => sn(R[k]) / 100;

  function derive(i, R) {
    const miles = num(i.one_way_miles);
    const travel = i.travel_auto ? (miles ? Math.ceil(miles / (num(R.miles_per_drive_day) || 500)) * 2 : 0) : num(i.travel_days);
    const work = num(i.install_days), w = i.include_wiring ? num(i.wiring_days) : 0;
    return {
      rtMiles: Math.round(miles * 2 * (1 + pct(R, "mile_buffer_pct"))), travel,
      onLoc: work ? work + travel : 0, paid: work ? work + Math.ceil(travel / 2) : 0,
      wOnLoc: w ? w + travel : 0, wDays: w, helper: i.include_wiring ? (Number(i.helper) ? 1 : 0) : 0,
    };
  }
  function compute(i, R) {
    const d = derive(i, R), c = i.counts || {}, $ = (k) => num(R[k]), m = (x) => "$" + Number(x).toLocaleString();
    const inst = [
      ["Crew labor", d.paid * $("crew_day"), `${d.paid} paid build days × ${m($("crew_day"))}`],
      ["Truck use", d.paid * $("truck_day"), `${d.paid} × ${m($("truck_day"))}`],
      [`Gas (${$("trucks")} trucks)`, d.rtMiles * $("gas_mile") * $("trucks"), `${d.rtMiles.toLocaleString()} mi × ${m($("gas_mile"))} × ${$("trucks")}`],
      ["Lodging", d.onLoc * $("lodging_day"), `${d.onLoc} days × ${m($("lodging_day"))}`],
      ["Food stipend", d.onLoc * $("food_person_day") * $("crew_size"), `${d.onLoc} days × ${m($("food_person_day"))} × ${$("crew_size")}`],
      ["Truck insurance", d.paid * $("truck_ins_day"), `${d.paid} × ${m($("truck_ins_day"))}`],
      ["Workers comp", d.paid * $("workers_comp_day"), `${d.paid} × ${m($("workers_comp_day"))}`],
      ["Tools + new hardware", d.paid * $("tools_day"), `${d.paid} × ${m($("tools_day"))}`],
      ["Welding", num(i.welding_days) * $("weld_day"), `${num(i.welding_days)} days × ${m($("weld_day"))}`],
      ["Flights", num(i.flight_tickets) * $("flight"), `${num(i.flight_tickets)} tickets × ${m($("flight"))}`],
      ["Overhead door install", num(i.overhead_sqft) * $("door_sqft"), `${num(i.overhead_sqft)} sq ft × ${m($("door_sqft"))}`],
      ["AMU startup", amuStartup(num(i.amu_units), R), `${num(i.amu_units)} unit(s)`],
      ["Finders fee", num(i.finders_fee), "flat"],
    ];
    const wir = i.include_wiring ? [
      ["Journeyman labor", d.wDays * $("jman_day"), `${d.wDays} days × ${m($("jman_day"))}`],
      ["Helper labor", d.wDays * $("helper_day") * d.helper, `${d.wDays} × ${m($("helper_day"))} × helper ${d.helper}`],
      ["Truck use", d.wDays * $("w_truck_day"), `${d.wDays} × ${m($("w_truck_day"))}`],
      ["Gas (1 truck)", d.rtMiles * $("w_gas_mile"), `${d.rtMiles.toLocaleString()} mi × ${m($("w_gas_mile"))}`],
      ["Hotel", d.wOnLoc * $("hotel_day"), `${d.wOnLoc} days × ${m($("hotel_day"))}`],
      ["Food stipend", d.wOnLoc * $("w_food_day"), `${d.wOnLoc} × ${m($("w_food_day"))}`],
      ["Truck insurance", d.wOnLoc * $("w_truck_ins_day"), `${d.wOnLoc} × ${m($("w_truck_ins_day"))}`],
      ["Helper travel", d.wOnLoc * $("helper_travel_day") * d.helper, `${d.wOnLoc} × ${m($("helper_travel_day"))} × helper ${d.helper}`],
      ...MATS.map(([k, lab]) => [`Material: ${lab}`, num(c[k]) * $("mat_" + k), `${num(c[k])} × ${m($("mat_" + k))}`]),
    ] : [];
    const lo = pct(R, "margin_low_pct"), hi = pct(R, "margin_high_pct"), mk = pct(R, "market_pct"), oh = pct(R, "overhead_pct");
    const pack = (rows) => {
      const base = r2(rows.reduce((a, x) => a + x[1], 0)), market = r2(base * mk), overhead = r2((base + market) * oh), cost = r2(base + market + overhead);
      return { rows, base, market, overhead, cost, sLow: r2(cost / (1 - lo)), sHigh: r2(cost / (1 - hi)) };
    };
    const install = pack(inst), wiring = pack(wir);
    const add = (k) => r2(install[k] + wiring[k]);
    const total = { base: add("base"), market: add("market"), overhead: add("overhead"), cost: add("cost"), sLow: add("sLow"), sHigh: add("sHigh") };
    return { d, install, wiring, total, lo: Math.round(lo * 100), hi: Math.round(hi * 100), mk: sn(R.market_pct), oh: sn(R.overhead_pct) };
  }

  // ---------- quote text extraction (in the browser) ----------
  const loaded = {};
  const loadScript = (src) => loaded[src] || (loaded[src] = new Promise((ok, bad) => {
    const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => { delete loaded[src]; bad(new Error("Could not load " + src)); }; document.head.appendChild(s);
  }));
  const LIB = {
    mammoth: "https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js",
    pdf: "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js",
    pdfWorker: "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js",
    xlsx: "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js",
  };
  async function extractText(file) {
    const buf = await file.arrayBuffer();
    if (/\.docx$/i.test(file.name)) {
      await loadScript(LIB.mammoth);
      const { value } = await window.mammoth.convertToHtml({ arrayBuffer: buf });
      const doc = new DOMParser().parseFromString(value, "text/html");
      doc.querySelectorAll("tr").forEach((tr) => { tr.textContent = [...tr.children].map((td) => td.textContent.trim()).filter(Boolean).join(" | ") + "\n"; });
      doc.querySelectorAll("p,li,h1,h2,h3,h4,h5,h6").forEach((p) => p.append("\n"));
      return doc.body.textContent.replace(/\n{3,}/g, "\n\n").trim();
    }
    if (/\.pdf$/i.test(file.name)) {
      await loadScript(LIB.pdf);
      const pdfjs = window.pdfjsLib; pdfjs.GlobalWorkerOptions.workerSrc = LIB.pdfWorker;
      const pdf = await pdfjs.getDocument({ data: buf }).promise;
      let out = "";
      for (let p = 1; p <= pdf.numPages; p++) {
        const tc = await (await pdf.getPage(p)).getTextContent();
        out += tc.items.map((it) => it.str + (it.hasEOL ? "\n" : " ")).join("") + "\n\n";
      }
      return out.trim();
    }
    if (/\.(txt|md|csv)$/i.test(file.name)) return new TextDecoder().decode(buf);
    throw new Error("Upload a .docx or .pdf quote.");
  }

  // ---------- state ----------
  const Q = { list: null, loading: false, cur: null, file: null, busy: "", err: "", confirmDel: null, filter: "", rates: null, ratesMeta: null, ratesDraft: null, showImport: false };
  const Z = () => window.ZPC;
  const rerender = () => Z().render();
  const lines = (a) => (Array.isArray(a) ? a : []).join("\n");
  const unlines = (s) => String(s || "").split("\n").map((x) => x.replace(/^\s*[-•]\s*/, "").trim()).filter(Boolean);
  const rOf = (q) => (q && q.rates) || Q.rates || {};
  const sameRates = (a, b) => JSON.stringify(a || {}) === JSON.stringify(b || {});

  async function loadRates() {
    if (Q.rates !== null) return;
    Q.rates = undefined;
    const { data, error } = await Z().sb.from("install_settings").select("*").eq("key", "rates").maybeSingle();
    if (error || !data) { Q.rates = false; Q.err = error ? Z().errMsg(error) : "No rates set up yet. Run supabase/install_rates.sql."; }
    else { Q.rates = data.value; Q.ratesMeta = { by: data.updated_by, at: data.updated_at }; }
    rerender();
  }
  async function loadList() {
    if (Q.loading) return; Q.loading = true;
    const { data, error } = await Z().sb.from("install_quotes").select("id,quote_number,customer_name,project,site,totals,updated_at,updated_by").order("updated_at", { ascending: false });
    Q.loading = false; Q.list = error ? [] : data || []; if (error) Q.err = Z().errMsg(error);
    rerender();
  }
  async function loadOne(id) {
    const { data, error } = await Z().sb.from("install_quotes").select("*").eq("id", id).maybeSingle();
    if (error || !data) { Q.err = error ? Z().errMsg(error) : "Quote not found."; Q.cur = { id, missing: true }; }
    else Q.cur = { ...data, inputs: { ...blankInputs(), ...data.inputs, counts: { ...blankInputs().counts, ...(data.inputs || {}).counts } }, editing: false };
    rerender();
  }
  function newQuote() {
    Q.cur = { id: null, quote_number: "", customer_name: "", project: "", site: "", source_file: "", file_path: null, notes: "",
      extraction: { scope: [], day_reasoning: [], flags: [] }, inputs: blankInputs(), rates: null, editing: true };
    Q.file = null; Q.err = ""; Q.busy = ""; Q.showImport = false;
  }

  // ---------- views ----------
  function view(r) {
    const { topbar, e } = Z();
    if (Q.rates === null) loadRates();
    if (Q.rates === undefined) return `${topbar()}<div class="card empty">Loading rates…</div>`;
    if (Q.rates === false) return `${topbar()}<div class="card empty">${e(Q.err)}</div>`;
    const sub = r.id;
    if (sub === "rates") { if (!Q.ratesDraft) Q.ratesDraft = { ...Q.rates }; return `${topbar()}${ratesView(e)}`; }
    if (!sub) { if (Q.list === null) loadList(); return `${topbar()}${listView(e)}`; }
    if (sub === "new") { if (!Q.cur || Q.cur.id !== null) newQuote(); return `${topbar()}${editor(e)}`; }
    if (!Q.cur || Q.cur.id !== sub) { Q.cur = { id: sub, loading: true }; loadOne(sub); }
    if (Q.cur.loading) return `${topbar()}<div class="card empty">Loading quote…</div>`;
    if (Q.cur.missing) return `${topbar()}<div class="card empty">${e(Q.err || "Quote not found.")} <a href="#/quotes">Back to Install Quotes</a></div>`;
    return `${topbar()}${Q.cur.editing ? editor(e) : summary(e)}`;
  }

  function listView(e) {
    const { money } = Z(), R = Q.rates;
    const f = Q.filter.toLowerCase();
    const rows = (Q.list || []).filter((q) => !f || `${q.quote_number} ${q.customer_name} ${q.project || ""}`.toLowerCase().includes(f));
    const lo = sn(R.margin_low_pct), hi = sn(R.margin_high_pct);
    return `<div class="stack"><div class="row"><div><h1>Install Quotes</h1><div class="sub">Upload a supplier quote → review → priced with the 4-Man Install & Wiring Calculator</div></div><span class="sp"></span>
      <a class="btn" href="#/quotes/rates" style="text-decoration:none">Rates</a><a class="btn go" href="#/quotes/new" style="text-decoration:none">+ New install quote</a></div>
      <div class="row"><input id="iq_filter" data-qf="1" placeholder="Search quote # or customer" value="${e(Q.filter)}" style="max-width:340px">
        <span class="sp"></span><span class="meta">Market ${sn(R.market_pct)}% · Overhead ${sn(R.overhead_pct)}%</span></div>
      ${Q.err ? `<p class="err">${e(Q.err)}</p>` : ""}
      <div class="tablebox"><table><thead><tr><th>Quote #</th><th>Customer / project</th><th>Site</th><th style="text-align:right">Cost</th><th style="text-align:right">Sell (low margin)</th><th style="text-align:right">Sell (high margin)</th><th>Updated</th></tr></thead><tbody>
      ${Q.list === null ? `<tr class="static"><td colspan="7" class="empty">Loading…</td></tr>` : rows.length ? rows.map((q) => `<tr tabindex="0" data-qopen="${e(q.id)}">
        <td class="mono">${e(q.quote_number)}</td><td><b>${e(q.customer_name)}</b><div class="meta">${e(q.project || "")}</div></td><td class="meta">${e(q.site || "")}</td>
        <td class="num">${money(q.totals?.cost)}</td><td class="num">${money(q.totals?.sLow ?? q.totals?.s30)}${q.totals?.lo ? `<div class="meta">${q.totals.lo}%</div>` : ""}</td><td class="num">${money(q.totals?.sHigh ?? q.totals?.s40)}${q.totals?.hi ? `<div class="meta">${q.totals.hi}%</div>` : ""}</td>
        <td class="meta">${new Date(q.updated_at).toLocaleDateString()}<div>${e(q.updated_by || "")}</div></td></tr>`).join("")
        : `<tr class="static"><td colspan="7" class="empty">No install quotes yet. Current margins: ${lo}% / ${hi}%.</td></tr>`}</tbody></table></div></div>`;
  }

  function ratesView(e) {
    const D = Q.ratesDraft, meta = Q.ratesMeta || {}, { fmtD } = Z();
    const changed = !sameRates(D, Q.rates);
    return `<div class="stack"><div class="row"><a href="#/quotes" class="btn link">← Install Quotes</a></div>
      <div class="card"><div class="eyebrow">Install & wiring rates</div><h1 style="margin-top:4px">Rates</h1>
        <p class="meta" style="margin:6px 0 0">Used for new quotes and when you reprice a saved quote. Saved quotes keep the rates they were priced with. Admins only — rates are stored in the database, not in the website code.${meta.at ? ` Last changed ${fmtD(meta.at)} by ${e(meta.by || "")}.` : ""}</p></div>
      ${RATE_GROUPS.map(([title, fields]) => `<div class="card"><div class="eyebrow">${e(title)}</div><div class="cl-fields" style="max-width:none;margin-top:12px">
        ${fields.map(([k, label, unit]) => `<label class="f" for="rt_${k}">${e(label)}${unit ? ` <span class="meta" style="font-weight:400">(${unit})</span>` : ""}<input id="rt_${k}" type="number" step="any" inputmode="decimal" data-rt="${k}" value="${e(D[k] ?? 0)}"></label>`).join("")}</div>
        ${title.startsWith("Market") ? `<p class="meta" style="margin:10px 0 0">Cost = calculator total × (1 + market %) × (1 + overhead %). Sell = cost ÷ (1 − margin).</p>` : ""}</div>`).join("")}
      ${Q.err ? `<p class="err">${e(Q.err)}</p>` : ""}
      <div class="row"><span class="sp"></span><button class="btn" type="button" data-q="rates-reset" ${changed ? "" : "disabled"}>Undo changes</button>
        <button class="btn go" type="button" data-q="rates-save" ${changed && !Q.busy ? "" : "disabled"}>${Q.busy === "rates" ? "Saving…" : "Save rates"}</button></div></div>`;
  }

  function totalsTable(c, e) {
    const { money } = Z();
    const tr = (lab, x, b) => `<tr class="static"><td>${b ? `<b>${lab}</b>` : lab}</td><td class="num">${money(x.cost)}</td><td class="num">${money(x.sLow)}</td><td class="num">${money(x.sHigh)}</td></tr>`;
    const adj = c.mk || c.oh ? `<tr class="static"><td class="meta" colspan="4">Cost includes ${c.mk ? `market ${c.mk > 0 ? "+" : ""}${c.mk}% (${money(c.total.market)})` : ""}${c.mk && c.oh ? " and " : ""}${c.oh ? `overhead ${c.oh}% (${money(c.total.overhead)})` : ""} on a calculator base of ${money(c.total.base)}</td></tr>` : "";
    return `<div class="tablebox flat"><table class="ps-table"><thead><tr><th></th><th style="text-align:right">Cost</th><th style="text-align:right">Sell @ ${c.lo}%</th><th style="text-align:right">Sell @ ${c.hi}%</th></tr></thead><tbody>
      ${tr("Mechanical install (4-man crew)", c.install)}${tr("Interconnect wiring", c.wiring)}${tr("Total installation", c.total, true)}
      <tr class="static"><td class="meta">Gross profit</td><td></td><td class="num meta">${money(c.total.sLow - c.total.cost)}</td><td class="num meta">${money(c.total.sHigh - c.total.cost)}</td></tr>${adj}</tbody></table></div>`;
  }
  function derivedLine(c, R) {
    const d = c.d;
    return `Travel ${d.travel} days (round trip ${d.rtMiles.toLocaleString()} mi incl. ${sn(R.mile_buffer_pct)}%) · Install: ${d.onLoc} days on location, ${d.paid} paid build days · Wiring: ${d.wOnLoc} days on location, ${d.wDays} wiring days, helper ${d.helper}`;
  }

  function summary(e) {
    const { money, fmtD } = Z(), q = Q.cur, R = rOf(q), c = compute(q.inputs, R), x = q.extraction || {};
    const breakdown = (part, title) => part.rows.length ? `<div class="cl-sec">${title}</div><div class="tablebox flat"><table class="ps-table"><tbody>${part.rows.filter((r) => r[1]).map((r) => `<tr class="static"><td>${e(r[0])}</td><td class="meta">${e(r[2])}</td><td class="num">${money(r[1])}</td></tr>`).join("")}
      ${part.market ? `<tr class="static"><td>Market adjustment</td><td class="meta">${c.mk}%</td><td class="num">${money(part.market)}</td></tr>` : ""}
      ${part.overhead ? `<tr class="static"><td>Overhead</td><td class="meta">${c.oh}%</td><td class="num">${money(part.overhead)}</td></tr>` : ""}
      <tr class="static"><td><b>Subtotal</b></td><td></td><td class="num"><b>${money(part.cost)}</b></td></tr></tbody></table></div>` : "";
    const ul = (a) => (a && a.length ? `<ul style="margin:8px 0 0;padding-left:20px">${a.map((s) => `<li>${e(s)}</li>`).join("")}</ul>` : `<p class="meta">None recorded.</p>`);
    const stale = q.rates && Q.rates && !sameRates(q.rates, Q.rates);
    return `<div class="stack iq-summary">
      <div class="row iq-noprint"><a href="#/quotes" class="btn link">← Install Quotes</a><span class="sp"></span>
        <button class="btn" type="button" data-q="xlsx">Download .xlsx</button><button class="btn" type="button" data-q="print">Print / PDF</button>
        ${q.file_path ? `<button class="btn" type="button" data-q="original">Original quote</button>` : ""}
        <button class="btn" type="button" data-q="edit">Edit</button>
        <button class="btn" type="button" data-q="del">${Q.confirmDel === q.id ? "Confirm delete" : "Delete"}</button></div>
      ${stale ? `<p class="meta iq-noprint">Priced with the rates in effect when it was saved. Rates have changed since — use Edit → Reprice with current rates to update.</p>` : ""}
      <div class="card"><div class="eyebrow">Installation quote summary</div>
        <h1 style="margin-top:4px">${e(q.customer_name)} · <span class="mono">${e(q.quote_number)}</span></h1>
        <div class="sub">${e(q.project || "")}${q.site ? ` · ${e(q.site)}` : ""}</div>
        <p class="meta" style="margin:6px 0 0">Source: ${e(q.source_file || "manual entry")}${x.reader ? ` (${e(x.reader)})` : ""} · Updated ${fmtD(q.updated_at)} by ${e(q.updated_by || "")}</p>
        ${totalsTable(c, e)}
        <p class="meta" style="margin:10px 0 0">${e(derivedLine(c, R))}</p></div>
      ${(x.flags || []).length ? `<div class="card action"><div class="eyebrow warn-ink">Review before sending</div>${ul(x.flags)}</div>` : ""}
      <div class="two"><div class="card"><div class="eyebrow">Scope basis</div>${ul(x.scope)}</div>
        <div class="card"><div class="eyebrow">Day estimate reasoning</div>${ul(x.day_reasoning)}</div></div>
      ${q.notes ? `<div class="card"><div class="eyebrow">Notes</div><p style="white-space:pre-wrap;margin:8px 0 0">${e(q.notes)}</p></div>` : ""}
      <div class="card"><div class="eyebrow">Cost build-up</div>${breakdown(c.install, "Mechanical install")}${breakdown(c.wiring, "Interconnect wiring")}</div></div>`;
  }

  function editor(e) {
    const q = Q.cur, i = q.inputs, x = q.extraction || {}, R = rOf(q), c = compute(i, R), { S } = Z(), CFG = window.ZPAR_CONFIG || {};
    const $ = (k) => "$" + num(R[k]).toLocaleString();
    const nf = (key, label, val, step, hint) => `<label class="f" for="iq_${key.replace(".", "_")}">${label}<input id="iq_${key.replace(".", "_")}" type="number" min="0" step="${step || 1}" inputmode="decimal" data-qi="${key}" value="${e(val)}">${hint ? `<span class="meta" style="font-weight:400">${hint}</span>` : ""}</label>`;
    const tf = (key, label, ph) => `<label class="f" for="iq_${key}">${label}<input id="iq_${key}" data-qt="${key}" value="${e(q[key] || "")}" ${ph ? `placeholder="${ph}"` : ""} ${key === "customer_name" ? 'list="iq_custs" autocomplete="off"' : ""}></label>`;
    const ta = (key, label) => `<label class="f" for="iq_x_${key}">${label} <span class="meta" style="font-weight:400">(one per line)</span><textarea id="iq_x_${key}" data-qx="${key}" rows="5">${e(lines(x[key]))}</textarea></label>`;
    const mapsUrl = q.site ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent("Dallas Fort Worth International Airport")}&destination=${encodeURIComponent(q.site)}&travelmode=driving` : "";
    const analyzed = q.id || (x.scope || []).length || q.manual;
    const stale = q.id && q.rates && Q.rates && !sameRates(q.rates, Q.rates);
    const hasZip = /\b\d{5}\b/.test(q.site || "");
    return `<div class="stack">
      <div class="row"><a href="${q.id ? "#/quotes/" + e(q.id) : "#/quotes"}" class="btn link" data-q="${q.id ? "cancel" : ""}">← ${q.id ? "Back to summary" : "Install Quotes"}</a></div>
      <div class="card"><div class="eyebrow">${q.id ? "Edit install quote" : "New install quote"}</div>
        <div class="grid2" style="margin-top:12px">${tf("quote_number", "Quote number", "e.g. U529090")}${tf("customer_name", "Customer name")}
          <datalist id="iq_custs">${(S.customers || []).map((cu) => `<option value="${e(cu.name)}">`).join("")}</datalist>
          ${tf("project", "Project", "e.g. (1) 15x16x30 crossdraft booth")}${tf("site", "Job site", "City, ST zip")}</div>
        ${q.id ? "" : `<div class="row" style="margin-top:16px"><label class="btn" for="iq_file" style="cursor:pointer">Choose quote file</label>
          <input id="iq_file" type="file" accept=".docx,.pdf" hidden data-qfile="1">
          <span class="meta">${Q.file ? e(Q.file.name) : ".docx or .pdf — GFS or RTT"}</span><span class="sp"></span>
          <button class="btn go" type="button" data-q="read" ${Q.file && !Q.busy ? "" : "disabled"}>${Q.busy === "read" ? "Reading…" : "Read quote (free)"}</button>
          ${CFG.CLAUDE_API ? `<button class="btn" type="button" data-q="analyze" ${Q.file && !Q.busy ? "" : "disabled"}>${Q.busy === "analyze" ? "Claude is reading…" : "Analyze with Claude API"}</button>` : ""}</div>
          <div class="row" style="margin-top:10px"><button class="btn link" type="button" data-q="toggle-import">${Q.showImport ? "Hide import" : "Paste results from a Claude chat"}</button>
            ${analyzed ? "" : `<button class="btn link" type="button" data-q="manual">Enter manually</button>`}</div>
          ${Q.showImport ? `<label class="f" for="iq_import" style="margin-top:8px">Ask Claude in a chat to "analyze this quote for Zpar Connect", then paste the result block here<textarea id="iq_import" rows="6" placeholder='{"zpar_connect_import": 1, ...}'></textarea></label>
            <div class="row" style="margin-top:8px"><span class="sp"></span><button class="btn go" type="button" data-q="import">Import</button></div>` : ""}`}
        ${Q.busy && !["save", "rates"].includes(Q.busy) ? `<p class="meta" style="margin:10px 0 0">${e(Q.busyMsg || "")}</p>` : ""}
        ${Q.err ? `<p class="err" style="margin:10px 0 0">${e(Q.err)}</p>` : ""}</div>
      ${analyzed ? `
      <div class="card"><div class="row"><div class="eyebrow">Totals (live)</div><span class="sp"></span><span class="meta">Review every input below — the reader's numbers are a starting point.</span></div>
        ${stale ? `<div class="row" style="margin-top:8px"><span class="meta">This quote uses the rates from when it was saved.</span><span class="sp"></span><button class="btn" type="button" data-q="reprice">Reprice with current rates</button></div>` : ""}
        <div id="iq_totals">${totalsTable(c, e)}</div><p class="meta" id="iq_derived" style="margin:10px 0 0">${e(derivedLine(c, R))}</p></div>
      <div class="card"><div class="eyebrow">Travel & days</div>
        <div class="cl-fields" style="max-width:none;margin-top:12px">
          ${nf("one_way_miles", "One-way miles from DFW", i.one_way_miles, 1, [hasZip ? `<a href="#" data-q="miles">Estimate from zip</a>` : "", mapsUrl ? `<a href="${e(mapsUrl)}" target="_blank" rel="noopener">Google Maps</a>` : ""].filter(Boolean).join(" · "))}
          <label class="f" for="iq_travel_days">Travel days (both ways)<input id="iq_travel_days" type="number" min="0" data-qi="travel_days" value="${e(i.travel_auto ? c.d.travel : i.travel_days)}" ${i.travel_auto ? "disabled" : ""}>
            <span class="na" style="font-weight:400"><input type="checkbox" data-qc="travel_auto" ${i.travel_auto ? "checked" : ""}> Auto (${num(R.miles_per_drive_day)} mi/day)</span></label>
          ${nf("install_days", "Install working days", i.install_days, 0.5, `on site, ${num(R.crew_size)}-person crew`)}
          ${nf("wiring_days", "Wiring working days", i.wiring_days, 0.5)}
          <label class="f" for="iq_helper">Wiring helper<select id="iq_helper" data-qi="helper"><option value="1" ${Number(i.helper) ? "selected" : ""}>Yes (larger than auto booth)</option><option value="0" ${Number(i.helper) ? "" : "selected"}>No</option></select></label>
          <label class="f">Interconnect wiring<span class="na" style="padding:8px 0"><input type="checkbox" data-qc="include_wiring" ${i.include_wiring ? "checked" : ""}> Include in quote</span></label>
        </div><p class="meta" style="margin:10px 0 0">Paid build days add 1 day for every 2 travel days to cover crew pay.</p></div>
      <div class="card"><div class="eyebrow">Install extras</div><div class="cl-fields" style="max-width:none;margin-top:12px">
          ${nf("welding_days", "Welding days", i.welding_days, 0.5, `${$("weld_day")}/day`)}
          ${nf("flight_tickets", "Flight tickets", i.flight_tickets, 1, `${$("flight")} each · jobs over 6 weeks`)}
          ${nf("overhead_sqft", "Overhead door sq ft", i.overhead_sqft, 1, `${$("door_sqft")}/sq ft, metal roll-up only`)}
          ${nf("amu_units", "AMU startups", i.amu_units, 1, `${$("amu_startup_1")} one · ${$("amu_startup_2")} two · ${$("amu_startup_extra")} each beyond`)}
          ${nf("finders_fee", "Finders fee ($)", i.finders_fee, 1, "flat amount")}</div></div>
      <div class="card"><div class="eyebrow">Electrical material counts</div><div class="cl-fields" style="max-width:none;margin-top:12px">
          ${MATS.map(([k, lab]) => nf("counts." + k, lab, (i.counts || {})[k] || 0, 1, `${$("mat_" + k)} each`)).join("")}</div></div>
      <div class="card"><div class="eyebrow">Summary text</div><div class="stack" style="gap:12px;margin-top:12px">
          ${ta("scope", "Scope basis")}${ta("day_reasoning", "Day estimate reasoning")}${ta("flags", "Flags / exclusions to review")}
          <label class="f" for="iq_notes">Notes<textarea id="iq_notes" data-qt="notes" rows="3">${e(q.notes || "")}</textarea></label></div></div>
      <div class="row"><span class="sp"></span>${q.id ? `<button class="btn" type="button" data-q="cancel">Cancel</button>` : ""}
        <button class="btn go" type="button" data-q="save" ${Q.busy ? "disabled" : ""}>${Q.busy === "save" ? "Saving…" : "Save install quote"}</button></div>` : ""}
    </div>`;
  }

  function refreshLive() {
    const { e } = Z(), R = rOf(Q.cur), c = compute(Q.cur.inputs, R);
    const t = document.getElementById("iq_totals"), d = document.getElementById("iq_derived"), tv = document.getElementById("iq_travel_days");
    if (t) t.innerHTML = totalsTable(c, e);
    if (d) d.textContent = derivedLine(c, R);
    if (tv && Q.cur.inputs.travel_auto) tv.value = c.d.travel;
  }

  // ---------- reading a quote ----------
  function applyResult(r, reader, fileName) {
    const q = Q.cur, i = q.inputs, R = rOf(q);
    Object.assign(i, {
      one_way_miles: Math.round(num(r.one_way_miles_from_dfw)), travel_auto: true, install_days: num(r.install_working_days),
      wiring_days: num(r.wiring_working_days), helper: Number(r.helper) ? 1 : 0, include_wiring: r.include_wiring !== false,
      counts: { ...blankInputs().counts, ...Object.fromEntries(Object.entries(r.counts || {}).filter(([k]) => k in blankInputs().counts).map(([k, v]) => [k, num(v)])) },
      welding_days: num((r.extras || {}).welding_days), overhead_sqft: num((r.extras || {}).overhead_door_sqft), amu_units: num((r.extras || {}).amu_startup_units),
    });
    const weeks6 = derive(i, R).onLoc > 42;
    i.flight_tickets = weeks6 ? num(R.crew_size) : 0;
    if (!q.quote_number && r.quote_number_found) q.quote_number = r.quote_number_found;
    if (!q.customer_name && r.customer_found) q.customer_name = r.customer_found;
    if (!q.project && r.project) q.project = r.project;
    if (!q.site && r.site) q.site = r.site;
    if (fileName) q.source_file = fileName;
    q.extraction = { scope: r.scope || [], day_reasoning: r.day_reasoning || [], reader,
      flags: [...(r.flags || []), ...(weeks6 ? [`Job runs over 6 weeks: ${num(R.crew_size)} flight tickets (1 trip home per crew member) added by default`] : [])], analyzed_at: new Date().toISOString() };
  }
  async function fillMiles(silent) {
    const zip = ((Q.cur.site || "").match(/\b(\d{5})\b/) || [])[1];
    const res = zip && window.ZPQR ? await window.ZPQR.milesFromZip(zip) : null;
    if (!res) { if (!silent) Z().toast("Couldn't look up that zip. Enter the miles yourself."); return false; }
    Q.cur.inputs.one_way_miles = res.miles;
    if (/^\s*\d{5}\s*$/.test(Q.cur.site || "")) Q.cur.site = res.place;
    (Q.cur.extraction.flags = Q.cur.extraction.flags || []).push(`Miles estimated from zip ${zip} (${res.place}): ${res.miles} one way — check in Google Maps`);
    return true;
  }
  async function readFree() {
    const f = Q.file; if (!f) return;
    Q.err = ""; Q.busy = "read"; Q.busyMsg = "Reading the file…"; rerender();
    try {
      const text = await extractText(f);
      const r = window.ZPQR && window.ZPQR.parse(text);
      if (!r) throw new Error("This doesn't look like a GFS or RTT quote. Use “Paste results from a Claude chat” or enter it manually.");
      applyResult(r, `free ${r.vendor} reader`, f.name);
      if (r.zip) await fillMiles(true);
      Z().toast(`${r.vendor} quote read. Review the inputs, then save.`);
    } catch (err) { Q.err = err.message || String(err); }
    Q.busy = ""; Q.busyMsg = ""; rerender();
  }
  async function analyzeApi() {
    const q = Q.cur, f = Q.file; if (!f) return;
    Q.err = ""; Q.busy = "analyze"; Q.busyMsg = "Reading the file…"; rerender();
    try {
      const text = await extractText(f);
      Q.busyMsg = "Claude is reading the quote (about 20–60 seconds)…"; rerender();
      const { data, error } = await Z().sb.functions.invoke("parse-quote", { body: { text, quote_number: q.quote_number, customer_name: q.customer_name, file_name: f.name } });
      if (error) { let m = error.message; try { const b = await error.context.json(); if (b && b.error) m = b.error; } catch (_) {} throw new Error(m); }
      if (!data || !data.result) throw new Error((data && data.error) || "No result from Claude.");
      applyResult(data.result, "Claude API", f.name);
      Z().toast("Quote analyzed. Review the inputs, then save.");
    } catch (err) { Q.err = err.message || String(err); }
    Q.busy = ""; Q.busyMsg = ""; rerender();
  }
  function importChat() {
    const raw = (document.getElementById("iq_import") || {}).value || "";
    Q.err = "";
    try {
      const s = raw.indexOf("{"), t = raw.lastIndexOf("}");
      if (s < 0 || t < s) throw new Error("No result block found. Paste the whole block Claude gave you, including the { } braces.");
      const r = JSON.parse(raw.slice(s, t + 1));
      if (!r.counts) throw new Error("That block is missing the equipment counts. Ask Claude to analyze the quote for Zpar Connect again.");
      applyResult(r, "Claude chat", r.file_name || (Q.file && Q.file.name) || "");
      Q.showImport = false;
      Z().toast("Imported. Review the inputs, then save.");
    } catch (err) { Q.err = err instanceof SyntaxError ? "Couldn't read that block — paste exactly what Claude gave you." : err.message; }
    rerender();
  }

  // ---------- saving ----------
  async function save() {
    const { sb, S, errMsg, toast } = Z(), q = Q.cur;
    Q.err = "";
    if (!String(q.quote_number || "").trim() || !String(q.customer_name || "").trim()) { Q.err = "Enter the quote number and customer name."; rerender(); return; }
    Q.busy = "save"; rerender();
    try {
      if (Q.file && !q.file_path) {
        const path = `${crypto.randomUUID()}/${Q.file.name.replace(/[^\w.\-]+/g, "_")}`;
        const up = await sb.storage.from("install-quotes").upload(path, Q.file, { upsert: false, contentType: Q.file.type || undefined });
        if (!up.error) q.file_path = path;
      }
      const R = rOf(q), name = q.customer_name.trim(), cust = (S.customers || []).find((c) => c.name.toLowerCase() === name.toLowerCase());
      const c = compute(q.inputs, R);
      const row = { quote_number: q.quote_number.trim(), customer_name: name, customer_id: cust ? cust.id : null, project: q.project || null, site: q.site || null,
        source_file: q.source_file || null, file_path: q.file_path || null, extraction: q.extraction || {}, inputs: q.inputs, notes: q.notes || null, rates: R,
        totals: { cost: c.total.cost, sLow: c.total.sLow, sHigh: c.total.sHigh, lo: c.lo, hi: c.hi, base: c.total.base, install_cost: c.install.cost, wiring_cost: c.wiring.cost } };
      const res = q.id ? await sb.from("install_quotes").update(row).eq("id", q.id).select("*") : await sb.from("install_quotes").insert(row).select("*");
      if (res.error) throw res.error.code === "23505" ? new Error(`Quote ${row.quote_number} for ${row.customer_name} already exists. Open it from the list instead.`) : res.error;
      const saved = res.data[0];
      Q.cur = { ...saved, inputs: q.inputs, editing: false }; Q.file = null; Q.list = null;
      toast(`Quote ${saved.quote_number} saved.`);
      Q.busy = ""; location.hash = "#/quotes/" + saved.id; rerender();
    } catch (err) { Q.busy = ""; Q.err = errMsg(err); rerender(); }
  }
  async function saveRates() {
    const { sb, errMsg, toast } = Z();
    const D = Object.fromEntries(Object.entries(Q.ratesDraft).map(([k, v]) => [k, sn(v)]));
    const lo = D.margin_low_pct, hi = D.margin_high_pct;
    if (lo < 0 || lo >= 100 || hi < 0 || hi >= 100) { Q.err = "Margins must be between 0 and 99%."; rerender(); return; }
    Q.err = ""; Q.busy = "rates"; rerender();
    const { data, error } = await sb.from("install_settings").update({ value: D }).eq("key", "rates").select("*");
    Q.busy = "";
    if (error || !(data || []).length) { Q.err = error ? errMsg(error) : "Rates were not saved."; rerender(); return; }
    Q.rates = data[0].value; Q.ratesDraft = { ...Q.rates }; Q.ratesMeta = { by: data[0].updated_by, at: data[0].updated_at };
    toast("Rates saved. New quotes will use them.");
    rerender();
  }

  // ---------- .xlsx export ----------
  async function download() {
    const q = Q.cur, R = rOf(q), c = compute(q.inputs, R), d = c.d, i = q.inputs, x = q.extraction || {};
    await loadScript(LIB.xlsx);
    const X = window.XLSX, ws = {}, set = (ref, v, f, z) => { ws[ref] = { t: typeof v === "string" ? "s" : "n", v }; if (f) ws[ref].f = f; if (z) ws[ref].z = z; };
    const $ = '"$"#,##0.00', P = "0.0%", L = (r, s) => set("A" + r, s), rt = (k) => num(R[k]);
    set("A1", `${rt("crew_size")} Person Crew ${rt("trucks")} Trucks`); set("D1", `${q.customer_name} · ${q.quote_number} · ${q.site || ""}`);
    const inst = c.install.rows.map((r) => r[1]);
    L(2, "Projected # of Days on Location and driving"); set("B2", d.onLoc);
    L(3, "Actual Days Building"); set("B3", d.paid); set("D3", "Every 2 travel days adds 1 build day to cover pay");
    L(4, "Total Labor Fixed Cost"); set("B4", inst[0], `B3*${rt("crew_day")}`, $);
    L(5, "Truck Use"); set("B5", inst[1], `${rt("truck_day")}*B3`, $);
    L(6, "Gas"); set("B6", inst[2], `C6*${rt("gas_mile")}*${rt("trucks")}`, $); set("C6", d.rtMiles); set("D6", `C6 = miles DFW to jobsite and back + ${sn(R.mile_buffer_pct)}%`);
    L(7, "Lodging"); set("B7", inst[3], `${rt("lodging_day")}*B2`, $);
    L(8, "Food Stipend"); set("B8", inst[4], `${rt("food_person_day")}*${rt("crew_size")}*B2`, $);
    L(9, "Truck Insurance Cost"); set("B9", inst[5], `${rt("truck_ins_day")}*B3`, $);
    L(10, "Workers Comp Insurance"); set("B10", inst[6], `${rt("workers_comp_day")}*B3`, $);
    L(11, "Tools + New Hardware"); set("B11", inst[7], `${rt("tools_day")}*B3`, $);
    ["Welding", "Flights", "Overhead Door Install", "AMU Startup", "Finders Fee"].forEach((s, n) => { L(12 + n, s); set("B" + (12 + n), inst[8 + n], null, $); });
    const tail = (r0, baseRef, part) => {
      L(r0, "Market adjustment"); set("C" + r0, pct(R, "market_pct"), null, P); set("B" + r0, part.market, `${baseRef}*C${r0}`, $);
      L(r0 + 1, "Overhead"); set("C" + (r0 + 1), pct(R, "overhead_pct"), null, P); set("B" + (r0 + 1), part.overhead, `(${baseRef}+B${r0})*C${r0 + 1}`, $);
      L(r0 + 2, "Cost incl. market & overhead"); set("B" + (r0 + 2), part.cost, `${baseRef}+B${r0}+B${r0 + 1}`, $);
      L(r0 + 3, `Sell price @ ${c.lo}% margin`); set("C" + (r0 + 3), c.lo / 100, null, P); set("B" + (r0 + 3), part.sLow, `B${r0 + 2}/(1-C${r0 + 3})`, $);
      L(r0 + 4, `Sell price @ ${c.hi}% margin`); set("C" + (r0 + 4), c.hi / 100, null, P); set("B" + (r0 + 4), part.sHigh, `B${r0 + 2}/(1-C${r0 + 4})`, $);
    };
    L(17, "Total Labor Only (calculator base)"); set("B17", c.install.base, "SUM(B4:B16)", $);
    tail(18, "B17", c.install);
    L(25, "Electrical Calculations"); set("D25", i.include_wiring ? "Included" : "Not included");
    const w = (k) => (c.wiring.rows.find((r) => r[0] === k) || [0, 0])[1];
    L(26, "Projected # of Days on Location and traveling"); set("B26", d.wOnLoc);
    L(27, "Actual Days Wiring"); set("B27", d.wDays); L(28, "Helper"); set("B28", d.helper);
    L(29, "Journeyman labor costs"); set("B29", w("Journeyman labor"), `B27*${rt("jman_day")}`, $);
    L(30, "Helper labor cost"); set("B30", w("Helper labor"), `${rt("helper_day")}*B27*B28`, $);
    L(31, "Total Labor Fixed Cost"); set("B31", w("Journeyman labor") + w("Helper labor"), "SUM(B29:B30)", $);
    L(32, "Truck Use"); set("B32", w("Truck use"), `${rt("w_truck_day")}*B27`, $);
    L(33, "Gas"); set("C33", i.include_wiring ? d.rtMiles : 0); set("B33", w("Gas (1 truck)"), `C33*${rt("w_gas_mile")}`, $);
    L(34, "Hotel"); set("B34", w("Hotel"), `${rt("hotel_day")}*B26`, $); L(35, "Food Stipend"); set("B35", w("Food stipend"), `${rt("w_food_day")}*B26`, $);
    L(36, "Truck Insurance Cost"); set("B36", w("Truck insurance"), `${rt("w_truck_ins_day")}*B26`, $); L(37, "Helper Travel cost"); set("B37", w("Helper travel"), `${rt("helper_travel_day")}*B28*B26`, $);
    const trav = ["Truck use", "Gas (1 truck)", "Hotel", "Food stipend", "Truck insurance", "Helper travel"].reduce((a, k) => a + w(k), 0);
    L(38, "Total Travel Expenses"); set("B38", trav, "SUM(B32:B37)", $);
    L(39, "Grand Total Travel and Labor expense"); set("B39", trav + w("Journeyman labor") + w("Helper labor"), "B38+B31", $);
    L(40, "ELECTRICAL MATERIAL"); set("C40", "Qty");
    let mat = 0;
    MATS.forEach(([k, lab], n) => { const r = 41 + n, qty = i.include_wiring ? num(i.counts[k]) : 0, rate = rt("mat_" + k); mat += qty * rate; L(r, lab); set("C" + r, qty); set("B" + r, qty * rate, `${rate}*C${r}`, $); });
    L(52, "Total Electrical Material Cost"); set("B52", mat, "SUM(B41:B51)", $);
    L(53, "Control Wiring Cost (calculator base)"); set("B53", c.wiring.base, "B52+B39", $);
    tail(54, "B53", c.wiring);
    ws["!ref"] = "A1:D58"; ws["!cols"] = [{ wch: 44 }, { wch: 16 }, { wch: 10 }, { wch: 60 }];

    const aoa = [[`Installation Quote Summary — ${q.customer_name} · ${q.quote_number}`], [`${q.project || ""} · ${q.site || ""}`], [],
      ["", "Cost", `Sell @ ${c.lo}%`, `Sell @ ${c.hi}%`],
      ["Mechanical install (4-man crew)", c.install.cost, c.install.sLow, c.install.sHigh], ["Interconnect wiring", c.wiring.cost, c.wiring.sLow, c.wiring.sHigh],
      ["TOTAL INSTALLATION", c.total.cost, c.total.sLow, c.total.sHigh], [],
      [`Calculator base ${c.total.base.toFixed(2)} · market ${c.mk}% · overhead ${c.oh}%`], [derivedLine(c, R)], [],
      ["Scope basis"], ...(x.scope || []).map((s) => ["- " + s]), [], ["Day estimate reasoning"], ...(x.day_reasoning || []).map((s) => ["- " + s]), [],
      ["Flags / exclusions to review"], ...(x.flags || []).map((s) => ["- " + s]), ...(q.notes ? [[], ["Notes"], [q.notes]] : [])];
    const s2 = X.utils.aoa_to_sheet(aoa); s2["!cols"] = [{ wch: 48 }, { wch: 16 }, { wch: 16 }, { wch: 16 }];
    for (const r of [5, 6, 7]) for (const col of "BCD") if (s2[col + r]) s2[col + r].z = $;
    const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, s2, "Quote Summary"); X.utils.book_append_sheet(wb, ws, "Calculator");
    X.writeFile(wb, `${q.quote_number}_${q.customer_name}_Install_Quote.xlsx`.replace(/[^\w.\-]+/g, "_"));
  }

  async function openOriginal() {
    const { data, error } = await Z().sb.storage.from("install-quotes").createSignedUrl(Q.cur.file_path, 300, { download: true });
    if (error) { Z().toast(Z().errMsg(error)); return; }
    window.open(data.signedUrl, "_blank", "noopener");
  }
  async function del() {
    const { sb, toast, errMsg } = Z(), q = Q.cur;
    if (Q.confirmDel !== q.id) { Q.confirmDel = q.id; rerender(); setTimeout(() => { if (Q.confirmDel === q.id) { Q.confirmDel = null; rerender(); } }, 5000); return; }
    const res = await sb.from("install_quotes").delete().eq("id", q.id);
    if (res.error) { toast(errMsg(res.error)); return; }
    if (q.file_path) await sb.storage.from("install-quotes").remove([q.file_path]);
    Q.confirmDel = null; Q.cur = null; Q.list = null; toast("Quote deleted."); location.hash = "#/quotes";
  }

  // ---------- events (own attributes, separate from app.js's data-act) ----------
  const onQuotes = () => /^#\/?quotes/.test(location.hash);
  document.addEventListener("click", async (ev) => {
    if (!onQuotes()) return;
    const tr = ev.target.closest("tr[data-qopen]"); if (tr) { location.hash = "#/quotes/" + tr.dataset.qopen; return; }
    const b = ev.target.closest("[data-q]"); if (!b || !b.dataset.q) return;
    const a = b.dataset.q;
    if (a === "read") readFree();
    else if (a === "analyze") analyzeApi();
    else if (a === "toggle-import") { Q.showImport = !Q.showImport; rerender(); }
    else if (a === "import") importChat();
    else if (a === "manual") { Q.cur.manual = true; rerender(); }
    else if (a === "miles") { ev.preventDefault(); if (await fillMiles(false)) rerender(); }
    else if (a === "reprice") { Q.cur.rates = { ...Q.rates }; rerender(); Z().toast("Repriced with current rates. Save to keep it."); }
    else if (a === "save") save();
    else if (a === "rates-save") saveRates();
    else if (a === "rates-reset") { Q.ratesDraft = { ...Q.rates }; Q.err = ""; rerender(); }
    else if (a === "edit") { Q.cur.editing = true; Q.cur._backup = JSON.stringify(Q.cur); rerender(); }
    else if (a === "cancel") { ev.preventDefault(); if (Q.cur._backup) Q.cur = { ...JSON.parse(Q.cur._backup), editing: false }; else Q.cur.editing = false; Q.err = ""; rerender(); }
    else if (a === "xlsx") download().catch((err) => Z().toast(err.message));
    else if (a === "print") window.print();
    else if (a === "original") openOriginal();
    else if (a === "del") del();
  });
  document.addEventListener("keydown", (ev) => { if (onQuotes() && ev.key === "Enter" && ev.target.matches && ev.target.matches("tr[data-qopen]")) location.hash = "#/quotes/" + ev.target.dataset.qopen; });
  document.addEventListener("input", (ev) => {
    if (!onQuotes()) return;
    const t = ev.target, ds = t.dataset || {};
    if (ds.qf) { Q.filter = t.value; rerender(); return; }
    if (ds.rt && Q.ratesDraft) {
      Q.ratesDraft[ds.rt] = t.value === "" ? 0 : Number(t.value);
      const changed = !sameRates(Object.fromEntries(Object.entries(Q.ratesDraft).map(([k, v]) => [k, sn(v)])), Q.rates);
      document.querySelectorAll('[data-q="rates-save"],[data-q="rates-reset"]').forEach((btn) => { btn.disabled = !changed; });
      return;
    }
    if (!Q.cur) return;
    if (ds.qt) { Q.cur[ds.qt] = t.value; return; }
    if (ds.qx) { Q.cur.extraction = { ...(Q.cur.extraction || {}), [ds.qx]: unlines(t.value) }; return; }
    if (ds.qi) {
      const [a, b] = ds.qi.split("."), v = t.value === "" ? 0 : Number(t.value);
      if (b) Q.cur.inputs[a][b] = v; else Q.cur.inputs[a] = v;
      refreshLive();
    }
  });
  document.addEventListener("change", (ev) => {
    if (!onQuotes() || !Q.cur) return;
    const ds = ev.target.dataset || {};
    if (ds.qfile) { Q.file = ev.target.files && ev.target.files[0] || null; Q.err = ""; rerender(); return; }
    if (ds.qt === "site") { rerender(); return; }
    if (ds.qc) {
      const i = Q.cur.inputs;
      if (ds.qc === "travel_auto" && !ev.target.checked) i.travel_days = derive(i, rOf(Q.cur)).travel;
      i[ds.qc] = ev.target.checked; rerender();
    }
    if (ds.qi === "helper") { Q.cur.inputs.helper = Number(ev.target.value); refreshLive(); }
  });
  window.addEventListener("hashchange", () => {
    if (/^#\/?quotes\/?$/.test(location.hash)) Q.list = null;
    if (/^#\/?quotes\/new$/.test(location.hash)) Q.cur = null;
    if (/^#\/?quotes\/rates$/.test(location.hash)) { Q.ratesDraft = null; Q.err = ""; }
  });

  window.ZPQ = { view, compute, derive, blankInputs };
})();
