/* Zpar Connect — Install Quotes (Admins only)
   Upload a supplier equipment quote → Claude reads it (parse-quote function) → the admin reviews
   the inputs → the portal prices it with the 4-Man Install & Wiring Calculator rates → saved by
   quote number + customer, with a printable summary and an .xlsx download. */
(function () {
  "use strict";

  // ---------- calculator rates (master sheet dated 10/8/26) ----------
  const R = {
    crewDay: 1600, truckDay: 120, gasMile: 0.4, trucks: 2, lodgingDay: 350, foodPerson: 55, crew: 4,
    truckIns: 65, workComp: 73, tools: 100, weldDay: 1500, flight: 750, doorSqft: 20,
    jman: 550, helper: 300, wTruck: 75, hotel: 175, wFood: 55, wTruckIns: 35, helperTravel: 230,
    milesPerDriveDay: 500, mileBuffer: 1.2, m40: 0.6, m30: 0.7,
  };
  const MATS = [
    ["lights", "Lights", 150], ["amu", "AMU", 1250], ["rollup_doors", "Roll-up doors", 250], ["solenoid", "Solenoid valve", 125],
    ["door_switches", "Door switches", 175], ["dust_collector", "Dust collector modules", 750], ["panels", "Oven burner and/or control panels", 750],
    ["exhaust_fans", "Oven/booth exhaust fans/motors", 450], ["recirc_fans", "Oven recirc fans", 350], ["probes", "Oven probes/switches/louvers", 225],
    ["air_seals", "Oven air seals", 225],
  ];
  const amuStartup = (n) => (n <= 0 ? 0 : n === 1 ? 3500 : n === 2 ? 6000 : 3000 * n);

  function blankInputs() {
    return { one_way_miles: 0, travel_auto: true, travel_days: 0, install_days: 0, wiring_days: 0, helper: 1, include_wiring: true,
      counts: Object.fromEntries(MATS.map(([k]) => [k, 0])), welding_days: 0, overhead_sqft: 0, amu_units: 0, flight_tickets: 0, finders_fee: 0 };
  }
  const num = (v) => { const n = Number(v); return isFinite(n) && n > 0 ? n : 0; };
  const r2 = (n) => Math.round(n * 100) / 100;

  function derive(i) {
    const miles = num(i.one_way_miles);
    const travel = i.travel_auto ? (miles ? Math.ceil(miles / R.milesPerDriveDay) * 2 : 0) : num(i.travel_days);
    const work = num(i.install_days), w = i.include_wiring ? num(i.wiring_days) : 0;
    return {
      rtMiles: Math.round(miles * 2 * R.mileBuffer), travel,
      onLoc: work ? work + travel : 0, paid: work ? work + Math.ceil(travel / 2) : 0,
      wOnLoc: w ? w + travel : 0, wDays: w, helper: i.include_wiring ? (Number(i.helper) ? 1 : 0) : 0,
    };
  }
  function compute(i) {
    const d = derive(i), c = i.counts || {};
    const inst = [
      ["Crew labor (4-man)", d.paid * R.crewDay, `${d.paid} paid build days × $${R.crewDay}`],
      ["Truck use", d.paid * R.truckDay, `${d.paid} × $${R.truckDay}`],
      ["Gas (2 trucks)", d.rtMiles * R.gasMile * R.trucks, `${d.rtMiles.toLocaleString()} mi × $${R.gasMile} × 2`],
      ["Lodging", d.onLoc * R.lodgingDay, `${d.onLoc} days × $${R.lodgingDay}`],
      ["Food stipend", d.onLoc * R.foodPerson * R.crew, `${d.onLoc} days × $${R.foodPerson} × 4`],
      ["Truck insurance", d.paid * R.truckIns, `${d.paid} × $${R.truckIns}`],
      ["Workers comp", d.paid * R.workComp, `${d.paid} × $${R.workComp}`],
      ["Tools + new hardware", d.paid * R.tools, `${d.paid} × $${R.tools}`],
      ["Welding", num(i.welding_days) * R.weldDay, `${num(i.welding_days)} days × $${R.weldDay}`],
      ["Flights", num(i.flight_tickets) * R.flight, `${num(i.flight_tickets)} tickets × $${R.flight}`],
      ["Overhead door install", num(i.overhead_sqft) * R.doorSqft, `${num(i.overhead_sqft)} sq ft × $${R.doorSqft}`],
      ["AMU startup", amuStartup(num(i.amu_units)), `${num(i.amu_units)} unit(s)`],
      ["Finders fee", num(i.finders_fee), "flat"],
    ];
    const on = !!i.include_wiring;
    const wir = on ? [
      ["Journeyman labor", d.wDays * R.jman, `${d.wDays} days × $${R.jman}`],
      ["Helper labor", d.wDays * R.helper * d.helper, `${d.wDays} × $${R.helper} × helper ${d.helper}`],
      ["Truck use", d.wDays * R.wTruck, `${d.wDays} × $${R.wTruck}`],
      ["Gas (1 truck)", d.rtMiles * R.gasMile, `${d.rtMiles.toLocaleString()} mi × $${R.gasMile}`],
      ["Hotel", d.wOnLoc * R.hotel, `${d.wOnLoc} days × $${R.hotel}`],
      ["Food stipend", d.wOnLoc * R.wFood, `${d.wOnLoc} × $${R.wFood}`],
      ["Truck insurance", d.wOnLoc * R.wTruckIns, `${d.wOnLoc} × $${R.wTruckIns}`],
      ["Helper travel", d.wOnLoc * R.helperTravel * d.helper, `${d.wOnLoc} × $${R.helperTravel} × helper ${d.helper}`],
      ...MATS.map(([k, lab, rate]) => [`Material: ${lab}`, num(c[k]) * rate, `${num(c[k])} × $${rate}`]),
    ] : [];
    const sum = (rows) => r2(rows.reduce((a, x) => a + x[1], 0));
    const pack = (rows) => { const cost = sum(rows); return { rows, cost, s30: r2(cost / R.m30), s40: r2(cost / R.m40) }; };
    const install = pack(inst), wiring = pack(wir);
    const total = { cost: r2(install.cost + wiring.cost), s30: r2(install.s30 + wiring.s30), s40: r2(install.s40 + wiring.s40) };
    return { d, install, wiring, total };
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
  const Q = { list: null, loading: false, cur: null, file: null, busy: "", err: "", confirmDel: null, filter: "" };
  const Z = () => window.ZPC;
  const rerender = () => Z().render();
  const lines = (a) => (Array.isArray(a) ? a : []).join("\n");
  const unlines = (s) => String(s || "").split("\n").map((x) => x.replace(/^\s*[-•]\s*/, "").trim()).filter(Boolean);

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
      extraction: { scope: [], day_reasoning: [], flags: [] }, inputs: blankInputs(), editing: true };
    Q.file = null; Q.err = ""; Q.busy = "";
  }

  // ---------- views ----------
  function view(r) {
    const { topbar, e } = Z();
    const sub = r.id;
    if (!sub) {
      if (Q.list === null) loadList();
      return `${topbar()}${listView(e)}`;
    }
    if (sub === "new") { if (!Q.cur || Q.cur.id !== null) newQuote(); return `${topbar()}${editor(e)}`; }
    if (!Q.cur || Q.cur.id !== sub) { Q.cur = { id: sub, loading: true }; loadOne(sub); }
    if (Q.cur.loading) return `${topbar()}<div class="card empty">Loading quote…</div>`;
    if (Q.cur.missing) return `${topbar()}<div class="card empty">${e(Q.err || "Quote not found.")} <a href="#/quotes">Back to Install Quotes</a></div>`;
    return `${topbar()}${Q.cur.editing ? editor(e) : summary(e)}`;
  }

  function listView(e) {
    const { money } = Z();
    const f = Q.filter.toLowerCase();
    const rows = (Q.list || []).filter((q) => !f || `${q.quote_number} ${q.customer_name} ${q.project || ""}`.toLowerCase().includes(f));
    return `<div class="stack"><div class="row"><div><h1>Install Quotes</h1><div class="sub">Upload a supplier quote → review → priced with the 4-Man Install & Wiring Calculator</div></div><span class="sp"></span>
      <a class="btn go" href="#/quotes/new" style="text-decoration:none">+ New install quote</a></div>
      <div class="row"><input id="iq_filter" data-qf="1" placeholder="Search quote # or customer" value="${e(Q.filter)}" style="max-width:340px"></div>
      ${Q.err ? `<p class="err">${e(Q.err)}</p>` : ""}
      <div class="tablebox"><table><thead><tr><th>Quote #</th><th>Customer / project</th><th>Site</th><th style="text-align:right">Cost</th><th style="text-align:right">Sell @ 30%</th><th style="text-align:right">Sell @ 40%</th><th>Updated</th></tr></thead><tbody>
      ${Q.list === null ? `<tr class="static"><td colspan="7" class="empty">Loading…</td></tr>` : rows.length ? rows.map((q) => `<tr tabindex="0" data-qopen="${e(q.id)}">
        <td class="mono">${e(q.quote_number)}</td><td><b>${e(q.customer_name)}</b><div class="meta">${e(q.project || "")}</div></td><td class="meta">${e(q.site || "")}</td>
        <td class="num">${money(q.totals?.cost)}</td><td class="num">${money(q.totals?.s30)}</td><td class="num">${money(q.totals?.s40)}</td>
        <td class="meta">${new Date(q.updated_at).toLocaleDateString()}<div>${e(q.updated_by || "")}</div></td></tr>`).join("")
        : `<tr class="static"><td colspan="7" class="empty">No install quotes yet.</td></tr>`}</tbody></table></div></div>`;
  }

  function totalsTable(c, e) {
    const { money } = Z();
    const tr = (lab, x, b) => `<tr class="static"><td>${b ? `<b>${lab}</b>` : lab}</td><td class="num">${money(x.cost)}</td><td class="num">${money(x.s30)}</td><td class="num">${money(x.s40)}</td></tr>`;
    return `<div class="tablebox flat"><table class="ps-table"><thead><tr><th></th><th style="text-align:right">Cost</th><th style="text-align:right">Sell @ 30%</th><th style="text-align:right">Sell @ 40%</th></tr></thead><tbody>
      ${tr("Mechanical install (4-man crew)", c.install)}${tr("Interconnect wiring", c.wiring)}${tr("Total installation", c.total, true)}
      <tr class="static"><td class="meta">Gross profit</td><td></td><td class="num meta">${money(c.total.s30 - c.total.cost)}</td><td class="num meta">${money(c.total.s40 - c.total.cost)}</td></tr></tbody></table></div>`;
  }
  function derivedLine(c) {
    const d = c.d;
    return `Travel ${d.travel} days (round trip ${d.rtMiles.toLocaleString()} mi incl. 20%) · Install: ${d.onLoc} days on location, ${d.paid} paid build days · Wiring: ${d.wOnLoc} days on location, ${d.wDays} wiring days, helper ${d.helper}`;
  }

  function summary(e) {
    const { money, fmtD } = Z(), q = Q.cur, c = compute(q.inputs), x = q.extraction || {};
    const breakdown = (part, title) => part.rows.length ? `<div class="cl-sec">${title}</div><div class="tablebox flat"><table class="ps-table"><tbody>${part.rows.filter((r) => r[1]).map((r) => `<tr class="static"><td>${e(r[0])}</td><td class="meta">${e(r[2])}</td><td class="num">${money(r[1])}</td></tr>`).join("")}
      <tr class="static"><td><b>Subtotal</b></td><td></td><td class="num"><b>${money(part.cost)}</b></td></tr></tbody></table></div>` : "";
    const ul = (a) => (a && a.length ? `<ul style="margin:8px 0 0;padding-left:20px">${a.map((s) => `<li>${e(s)}</li>`).join("")}</ul>` : `<p class="meta">None recorded.</p>`);
    return `<div class="stack iq-summary">
      <div class="row iq-noprint"><a href="#/quotes" class="btn link">← Install Quotes</a><span class="sp"></span>
        <button class="btn" type="button" data-q="xlsx">Download .xlsx</button><button class="btn" type="button" data-q="print">Print / PDF</button>
        ${q.file_path ? `<button class="btn" type="button" data-q="original">Original quote</button>` : ""}
        <button class="btn" type="button" data-q="edit">Edit</button>
        <button class="btn" type="button" data-q="del">${Q.confirmDel === q.id ? "Confirm delete" : "Delete"}</button></div>
      <div class="card"><div class="eyebrow">Installation quote summary</div>
        <h1 style="margin-top:4px">${e(q.customer_name)} · <span class="mono">${e(q.quote_number)}</span></h1>
        <div class="sub">${e(q.project || "")}${q.site ? ` · ${e(q.site)}` : ""}</div>
        <p class="meta" style="margin:6px 0 0">Source: ${e(q.source_file || "manual entry")} · Updated ${fmtD(q.updated_at)} by ${e(q.updated_by || "")}</p>
        ${totalsTable(c, e)}
        <p class="meta" style="margin:10px 0 0">${e(derivedLine(c))}</p></div>
      ${(x.flags || []).length ? `<div class="card action"><div class="eyebrow warn-ink">Review before sending</div>${ul(x.flags)}</div>` : ""}
      <div class="two"><div class="card"><div class="eyebrow">Scope basis</div>${ul(x.scope)}</div>
        <div class="card"><div class="eyebrow">Day estimate reasoning</div>${ul(x.day_reasoning)}</div></div>
      ${q.notes ? `<div class="card"><div class="eyebrow">Notes</div><p style="white-space:pre-wrap;margin:8px 0 0">${e(q.notes)}</p></div>` : ""}
      <div class="card"><div class="eyebrow">Cost build-up</div>${breakdown(c.install, "Mechanical install")}${breakdown(c.wiring, "Interconnect wiring")}</div></div>`;
  }

  function editor(e) {
    const q = Q.cur, i = q.inputs, x = q.extraction || {}, c = compute(i), { S } = Z();
    const nf = (key, label, val, step, hint) => `<label class="f" for="iq_${key.replace(".", "_")}">${label}<input id="iq_${key.replace(".", "_")}" type="number" min="0" step="${step || 1}" inputmode="decimal" data-qi="${key}" value="${e(val)}">${hint ? `<span class="meta" style="font-weight:400">${hint}</span>` : ""}</label>`;
    const tf = (key, label, ph) => `<label class="f" for="iq_${key}">${label}<input id="iq_${key}" data-qt="${key}" value="${e(q[key] || "")}" ${ph ? `placeholder="${ph}"` : ""} ${key === "customer_name" ? 'list="iq_custs" autocomplete="off"' : ""}></label>`;
    const ta = (key, label) => `<label class="f" for="iq_x_${key}">${label} <span class="meta" style="font-weight:400">(one per line)</span><textarea id="iq_x_${key}" data-qx="${key}" rows="5">${e(lines(x[key]))}</textarea></label>`;
    const mapsUrl = q.site ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent("Dallas Fort Worth International Airport")}&destination=${encodeURIComponent(q.site)}&travelmode=driving` : "";
    const analyzed = q.id || (x.scope || []).length || q.manual;
    return `<div class="stack">
      <div class="row"><a href="${q.id ? "#/quotes/" + e(q.id) : "#/quotes"}" class="btn link" data-q="${q.id ? "cancel" : ""}">← ${q.id ? "Back to summary" : "Install Quotes"}</a></div>
      <div class="card"><div class="eyebrow">${q.id ? "Edit install quote" : "New install quote"}</div>
        <div class="grid2" style="margin-top:12px">${tf("quote_number", "Quote number", "e.g. U529090")}${tf("customer_name", "Customer name")}
          <datalist id="iq_custs">${(S.customers || []).map((cu) => `<option value="${e(cu.name)}">`).join("")}</datalist>
          ${tf("project", "Project", "e.g. (1) 15x16x30 crossdraft booth")}${tf("site", "Job site", "City, ST zip")}</div>
        ${q.id ? "" : `<div class="row" style="margin-top:16px"><label class="btn" for="iq_file" style="cursor:pointer">Choose quote file</label>
          <input id="iq_file" type="file" accept=".docx,.pdf" hidden data-qfile="1">
          <span class="meta">${Q.file ? e(Q.file.name) : ".docx or .pdf supplier quote"}</span><span class="sp"></span>
          <button class="btn go" type="button" data-q="analyze" ${Q.file && !Q.busy ? "" : "disabled"}>${Q.busy === "analyze" ? "Reading quote…" : "Analyze with Claude"}</button>
          ${analyzed ? "" : `<button class="btn link" type="button" data-q="manual">Enter manually</button>`}</div>`}
        ${Q.busy && Q.busy !== "save" ? `<p class="meta" style="margin:10px 0 0">${e(Q.busyMsg || "")}</p>` : ""}
        ${Q.err ? `<p class="err" style="margin:10px 0 0">${e(Q.err)}</p>` : ""}</div>
      ${analyzed ? `
      <div class="card"><div class="row"><div class="eyebrow">Totals (live)</div><span class="sp"></span><span class="meta">Review every input below — Claude's numbers are a starting point.</span></div>
        <div id="iq_totals">${totalsTable(c, e)}</div><p class="meta" id="iq_derived" style="margin:10px 0 0">${e(derivedLine(c))}</p></div>
      <div class="card"><div class="eyebrow">Travel & days</div>
        <div class="cl-fields" style="max-width:none;margin-top:12px">
          ${nf("one_way_miles", "One-way miles from DFW", i.one_way_miles, 1, mapsUrl ? `<a href="${e(mapsUrl)}" target="_blank" rel="noopener">Check in Google Maps</a>` : "")}
          <label class="f" for="iq_travel_days">Travel days (both ways)<input id="iq_travel_days" type="number" min="0" data-qi="travel_days" value="${e(i.travel_auto ? c.d.travel : i.travel_days)}" ${i.travel_auto ? "disabled" : ""}>
            <span class="na" style="font-weight:400"><input type="checkbox" data-qc="travel_auto" ${i.travel_auto ? "checked" : ""}> Auto (${R.milesPerDriveDay} mi/day)</span></label>
          ${nf("install_days", "Install working days", i.install_days, 0.5, "on site, 4-man crew")}
          ${nf("wiring_days", "Wiring working days", i.wiring_days, 0.5)}
          <label class="f" for="iq_helper">Wiring helper<select id="iq_helper" data-qi="helper"><option value="1" ${Number(i.helper) ? "selected" : ""}>Yes (larger than auto booth)</option><option value="0" ${Number(i.helper) ? "" : "selected"}>No</option></select></label>
          <label class="f">Interconnect wiring<span class="na" style="padding:8px 0"><input type="checkbox" data-qc="include_wiring" ${i.include_wiring ? "checked" : ""}> Include in quote</span></label>
        </div><p class="meta" style="margin:10px 0 0">Paid build days add 1 day for every 2 travel days to cover crew pay.</p></div>
      <div class="card"><div class="eyebrow">Install extras</div><div class="cl-fields" style="max-width:none;margin-top:12px">
          ${nf("welding_days", "Welding days", i.welding_days, 0.5, "$1,500/day")}
          ${nf("flight_tickets", "Flight tickets", i.flight_tickets, 1, "$750 each · jobs over 6 weeks")}
          ${nf("overhead_sqft", "Overhead door sq ft", i.overhead_sqft, 1, "$20/sq ft, metal roll-up only")}
          ${nf("amu_units", "AMU startups", i.amu_units, 1, "$3,500 one · $6,000 two · $3,000 each beyond")}
          ${nf("finders_fee", "Finders fee ($)", i.finders_fee, 1, "flat amount")}</div></div>
      <div class="card"><div class="eyebrow">Electrical material counts</div><div class="cl-fields" style="max-width:none;margin-top:12px">
          ${MATS.map(([k, lab, rate]) => nf("counts." + k, lab, (i.counts || {})[k] || 0, 1, `$${rate} each`)).join("")}</div></div>
      <div class="card"><div class="eyebrow">Summary text</div><div class="stack" style="gap:12px;margin-top:12px">
          ${ta("scope", "Scope basis")}${ta("day_reasoning", "Day estimate reasoning")}${ta("flags", "Flags / exclusions to review")}
          <label class="f" for="iq_notes">Notes<textarea id="iq_notes" data-qt="notes" rows="3">${e(q.notes || "")}</textarea></label></div></div>
      <div class="row"><span class="sp"></span>${q.id ? `<button class="btn" type="button" data-q="cancel">Cancel</button>` : ""}
        <button class="btn go" type="button" data-q="save" ${Q.busy ? "disabled" : ""}>${Q.busy === "save" ? "Saving…" : "Save install quote"}</button></div>` : ""}
    </div>`;
  }

  function refreshLive() {
    const { e } = Z(), c = compute(Q.cur.inputs);
    const t = document.getElementById("iq_totals"), d = document.getElementById("iq_derived"), tv = document.getElementById("iq_travel_days");
    if (t) t.innerHTML = totalsTable(c, e);
    if (d) d.textContent = derivedLine(c);
    if (tv && Q.cur.inputs.travel_auto) tv.value = c.d.travel;
  }

  // ---------- actions ----------
  async function analyze() {
    const q = Q.cur, f = Q.file; if (!f) return;
    Q.err = ""; Q.busy = "analyze"; Q.busyMsg = "Reading the file…"; rerender();
    try {
      const text = await extractText(f);
      Q.busyMsg = "Claude is reading the quote (about 20–60 seconds)…"; rerender();
      const { data, error } = await Z().sb.functions.invoke("parse-quote", { body: { text, quote_number: q.quote_number, customer_name: q.customer_name, file_name: f.name } });
      if (error) { let m = error.message; try { const b = await error.context.json(); if (b && b.error) m = b.error; } catch (_) {} throw new Error(m); }
      if (!data || !data.result) throw new Error((data && data.error) || "No result from Claude.");
      const r = data.result, i = q.inputs;
      Object.assign(i, {
        one_way_miles: Math.round(num(r.one_way_miles_from_dfw)), travel_auto: true, install_days: num(r.install_working_days),
        wiring_days: num(r.wiring_working_days), helper: Number(r.helper) ? 1 : 0, include_wiring: r.include_wiring !== false,
        counts: { ...blankInputs().counts, ...Object.fromEntries(Object.entries(r.counts || {}).map(([k, v]) => [k, num(v)])) },
        welding_days: num((r.extras || {}).welding_days), overhead_sqft: num((r.extras || {}).overhead_door_sqft), amu_units: num((r.extras || {}).amu_startup_units),
      });
      i.flight_tickets = i.install_days > 30 ? 4 : 0;
      if (!q.quote_number && r.quote_number_found) q.quote_number = r.quote_number_found;
      if (!q.customer_name && r.customer_found) q.customer_name = r.customer_found;
      if (!q.project) q.project = r.project || "";
      if (!q.site) q.site = r.site || "";
      q.source_file = f.name;
      q.extraction = { scope: r.scope || [], day_reasoning: r.day_reasoning || [], flags: [...(r.flags || []), ...(i.flight_tickets ? ["Job runs over 6 weeks: 4 flight tickets (1 trip home per crew member) added by default"] : [])], model: data.model, analyzed_at: new Date().toISOString() };
      Z().toast("Quote analyzed. Review the inputs, then save.");
    } catch (err) { Q.err = err.message || String(err); }
    Q.busy = ""; Q.busyMsg = ""; rerender();
  }

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
      const name = q.customer_name.trim(), cust = (S.customers || []).find((c) => c.name.toLowerCase() === name.toLowerCase());
      const c = compute(q.inputs);
      const row = { quote_number: q.quote_number.trim(), customer_name: name, customer_id: cust ? cust.id : null, project: q.project || null, site: q.site || null,
        source_file: q.source_file || null, file_path: q.file_path || null, extraction: q.extraction || {}, inputs: q.inputs, notes: q.notes || null,
        totals: { cost: c.total.cost, s30: c.total.s30, s40: c.total.s40, install_cost: c.install.cost, wiring_cost: c.wiring.cost } };
      const res = q.id ? await sb.from("install_quotes").update(row).eq("id", q.id).select("*") : await sb.from("install_quotes").insert(row).select("*");
      if (res.error) throw res.error.code === "23505" ? new Error(`Quote ${row.quote_number} for ${row.customer_name} already exists. Open it from the list instead.`) : res.error;
      const saved = res.data[0];
      Q.cur = { ...saved, inputs: q.inputs, editing: false }; Q.file = null; Q.list = null;
      toast(`Quote ${saved.quote_number} saved.`);
      Q.busy = ""; location.hash = "#/quotes/" + saved.id; rerender();
    } catch (err) { Q.busy = ""; Q.err = errMsg(err); rerender(); }
  }

  async function download() {
    const q = Q.cur, c = compute(q.inputs), d = c.d, i = q.inputs, x = q.extraction || {};
    await loadScript(LIB.xlsx);
    const X = window.XLSX, ws = {}, set = (ref, v, f, z) => { ws[ref] = { t: typeof v === "string" ? "s" : "n", v }; if (f) ws[ref].f = f; if (z) ws[ref].z = z; };
    const $ = '"$"#,##0.00', L = (r, s) => set("A" + r, s);
    set("A1", "4 Person Crew 2 Trucks"); set("D1", `${q.customer_name} · ${q.quote_number} · ${q.site || ""}`);
    const inst = c.install.rows.map((r) => r[1]);
    L(2, "Projected # of Days on Location and driving"); set("B2", d.onLoc);
    L(3, "Actual Days Building"); set("B3", d.paid); set("D3", "Every 2 travel days adds 1 build day to cover pay");
    L(4, "Total Labor Fixed Cost"); set("B4", inst[0], "B3*1600", $);
    L(5, "Truck Use"); set("B5", inst[1], "120*B3", $);
    L(6, "Gas"); set("B6", inst[2], "C6*0.4*2", $); set("C6", d.rtMiles); set("D6", "C6 = miles DFW to jobsite and back + 20%");
    L(7, "AirBNB"); set("B7", inst[3], "350*B2", $);
    L(8, "Food Stipend"); set("B8", inst[4], "55*4*B2", $);
    L(9, "Truck Insurance Cost"); set("B9", inst[5], "65*B3", $);
    L(10, "Workers Comp Insurance"); set("B10", inst[6], "73*B3", $);
    L(11, "Tools + New Hardware"); set("B11", inst[7], "100*B3", $);
    ["Welding", "Flights", "Overhead Door Install", "AMU Startup", "Finders Fee"].forEach((s, n) => { L(12 + n, s); set("B" + (12 + n), inst[8 + n], null, $); });
    L(17, "Total Labor Only"); set("B17", c.install.cost, "SUM(B4:B16)", $);
    L(18, "Labor Sell Price 40% Margin"); set("B18", c.install.s40, "B17/B19", $); L(19, "Margin"); set("B19", 0.6);
    L(20, "Projected Profit at 40%"); set("B20", c.install.s40 - c.install.cost, "B18-B17", $);
    L(21, "Labor Sell Price 30% Margin"); set("B21", c.install.s30, "B17/B22", $); L(22, "Margin"); set("B22", 0.7);
    L(23, "Projected Profit at 30%"); set("B23", c.install.s30 - c.install.cost, "B21-B17", $);
    L(25, "Electrical Calculations"); set("D25", i.include_wiring ? "Included" : "Not included");
    const w = (k) => (c.wiring.rows.find((r) => r[0] === k) || [0, 0])[1];
    L(26, "Projected # of Days on Location and traveling"); set("B26", d.wOnLoc);
    L(27, "Actual Days Wiring"); set("B27", d.wDays); L(28, "Helper"); set("B28", d.helper);
    L(29, "Journeyman labor costs"); set("B29", w("Journeyman labor"), "B27*550", $);
    L(30, "Helper labor cost"); set("B30", w("Helper labor"), "300*B27*B28", $);
    L(31, "Total Labor Fixed Cost"); set("B31", w("Journeyman labor") + w("Helper labor"), "SUM(B29:B30)", $);
    L(32, "Truck Use"); set("B32", w("Truck use"), "75*B27", $);
    L(33, "Gas"); set("C33", i.include_wiring ? d.rtMiles : 0); set("B33", w("Gas (1 truck)"), "C33*0.4", $);
    L(34, "Hotel"); set("B34", w("Hotel"), "175*B26", $); L(35, "Food Stipend"); set("B35", w("Food stipend"), "55*B26", $);
    L(36, "Truck Insurance Cost"); set("B36", w("Truck insurance"), "35*B26", $); L(37, "Helper Travel cost"); set("B37", w("Helper travel"), "230*B28*B26", $);
    const trav = ["Truck use", "Gas (1 truck)", "Hotel", "Food stipend", "Truck insurance", "Helper travel"].reduce((a, k) => a + w(k), 0);
    L(38, "Total Travel Expenses"); set("B38", trav, "SUM(B32:B37)", $);
    L(39, "Grand Total Travel and Labor expense"); set("B39", trav + w("Journeyman labor") + w("Helper labor"), "B38+B31", $);
    L(40, "ELECTRICAL MATERIAL"); set("C40", "Qty");
    let mat = 0;
    MATS.forEach(([k, lab, rate], n) => { const r = 41 + n, qty = i.include_wiring ? num(i.counts[k]) : 0; mat += qty * rate; L(r, lab); set("C" + r, qty); set("B" + r, qty * rate, `${rate}*C${r}`, $); });
    L(52, "Total Electrical Material Cost"); set("B52", mat, "SUM(B41:B51)", $);
    L(53, "Control Wiring Cost with Labor"); set("B53", c.wiring.cost, "B52+B39", $);
    L(54, "Control Wiring Sell Price 40% Margin"); set("B54", c.wiring.s40, "B53/B55", $); L(55, "40% margin"); set("B55", 0.6);
    L(56, "Control Wiring Sell Price 30% Margin"); set("B56", c.wiring.s30, "B53/B57", $); L(57, "30% Margin"); set("B57", 0.7);
    ws["!ref"] = "A1:D57"; ws["!cols"] = [{ wch: 44 }, { wch: 16 }, { wch: 10 }, { wch: 60 }];

    const aoa = [[`Installation Quote Summary — ${q.customer_name} · ${q.quote_number}`], [`${q.project || ""} · ${q.site || ""}`], [],
      ["", "Cost", "Sell @ 30%", "Sell @ 40%"],
      ["Mechanical install (4-man crew)", c.install.cost, c.install.s30, c.install.s40], ["Interconnect wiring", c.wiring.cost, c.wiring.s30, c.wiring.s40],
      ["TOTAL INSTALLATION", c.total.cost, c.total.s30, c.total.s40], [], [derivedLine(c)], [],
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
  document.addEventListener("click", (ev) => {
    if (!onQuotes()) return;
    const tr = ev.target.closest("tr[data-qopen]"); if (tr) { location.hash = "#/quotes/" + tr.dataset.qopen; return; }
    const b = ev.target.closest("[data-q]"); if (!b || !b.dataset.q) return;
    const a = b.dataset.q;
    if (a === "analyze") analyze();
    else if (a === "manual") { Q.cur.manual = true; rerender(); }
    else if (a === "save") save();
    else if (a === "edit") { Q.cur.editing = true; Q.cur._backup = JSON.stringify(Q.cur); rerender(); }
    else if (a === "cancel") { ev.preventDefault(); if (Q.cur._backup) Q.cur = { ...JSON.parse(Q.cur._backup), editing: false }; else Q.cur.editing = false; Q.err = ""; rerender(); }
    else if (a === "xlsx") download().catch((err) => Z().toast(err.message));
    else if (a === "print") window.print();
    else if (a === "original") openOriginal();
    else if (a === "del") del();
  });
  document.addEventListener("keydown", (ev) => { if (onQuotes() && ev.key === "Enter" && ev.target.matches && ev.target.matches("tr[data-qopen]")) location.hash = "#/quotes/" + ev.target.dataset.qopen; });
  document.addEventListener("input", (ev) => {
    if (!onQuotes() || !Q.cur) { if (ev.target.dataset && ev.target.dataset.qf) { Q.filter = ev.target.value; rerender(); } return; }
    const t = ev.target, ds = t.dataset || {};
    if (ds.qf) { Q.filter = t.value; rerender(); return; }
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
    if (ds.qc) {
      const i = Q.cur.inputs;
      if (ds.qc === "travel_auto" && !ev.target.checked) i.travel_days = derive(i).travel;
      i[ds.qc] = ev.target.checked; rerender();
    }
    if (ds.qi === "helper") { Q.cur.inputs.helper = Number(ev.target.value); refreshLive(); }
  });
  window.addEventListener("hashchange", () => { if (/^#\/?quotes\/?$/.test(location.hash)) { Q.list = null; } if (/^#\/?quotes\/new$/.test(location.hash)) Q.cur = null; });

  window.ZPQ = { view, compute, derive, blankInputs };
})();
