/* Zpar Connect — customer & employee portal (static site + Supabase) */
(function () {
  "use strict";
  const CFG = window.ZPAR_CONFIG || {};
  const app = document.getElementById("app");

  const STAGES = [
    { n: "Proposal Acceptance" }, { n: "End User Site Prep Verified" }, { n: "Deposit Received", bill: "DEPOSIT" },
    { n: "Drawings Being Generated" }, { n: "Submittal Drawings Waiting Approval" }, { n: "In Fabrication" },
    { n: "Factory Acceptance Test", bill: "PROGRESS" }, { n: "Shipped" }, { n: "Installation" },
    { n: "Commissioned", bill: "FINAL" },
  ];
  const LAST = STAGES.length;
  // What each stage means, in the customer's words (shown on their landing page).
  const STAGE_TEXT = [
    "Your proposal has been accepted and we're setting up your project.",
    "We're verifying your site is prepared for installation. Please complete the site preparation checklist below.",
    "Your deposit has been received and your project is scheduled into engineering.",
    "Our engineers are preparing your approval drawings.",
    "Submittal drawings are with your team for approval. If you've requested changes, revisions are underway.",
    "Your equipment is being fabricated.",
    "Your equipment is going through factory acceptance testing before it ships.",
    "Your equipment has shipped and is on its way to your site.",
    "Our crew is installing your equipment.",
    "Your system is commissioned and your project is complete. Thank you for choosing ZPar.",
  ];
  // Job Site Arrival Checklist items are loaded from the checklist_items table.

  // ---------- helpers ----------
  const e = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) => (n == null || n === "" ? "—" : "$" + Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 }));
  const fmtD = (s) => { if (!s) return ""; const d = new Date(String(s).length === 10 ? s + "T12:00:00" : s); return isNaN(d) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); };
  const fmtDT = (s) => { const d = new Date(s); return isNaN(d) ? "" : d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }); };
  const stageOf = (o) => Math.min(LAST, Math.max(1, Number(o.stage) || 1));
  function toast(m) { const t = document.getElementById("toast"); t.textContent = m; t.classList.add("on"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("on"), 2600); }
  const errMsg = (err) => (err && (err.message || err.error_description)) || "Something went wrong. Try again.";

  if (!window.supabase || !CFG.SUPABASE_URL || CFG.SUPABASE_URL.includes("YOUR-")) {
    app.innerHTML = `<div class="card login"><h1>Setup needed</h1><p class="lead">Add your Supabase URL and anon key to <span class="mono">config.js</span>.</p></div>`;
    return;
  }
  const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { auth: { persistSession: true, detectSessionInUrl: true, flowType: "pkce" } });

  const S = { session: null, staff: false, orders: [], customers: [], contacts: [], items: [], photos: {}, q: "", show: "Active" };

  // ---------- routing ----------
  const route = () => { const h = location.hash.replace(/^#\/?/, "").split("/"); return { page: h[0] || "", id: h[1] || null }; };
  window.addEventListener("hashchange", () => render());

  // ---------- shared UI ----------
  function topbar() {
    const r = route();
    const tabs = S.staff ? `<nav class="tabs">${S.manager ? `<a href="#/manager" class="${r.page === "manager" || r.page === "new" ? "on" : ""}">Admin</a>` : ""}<a href="#/" class="${r.page === "" || r.page === "order" ? "on" : ""}">Orders</a><a href="#/customers" class="${r.page === "customers" ? "on" : ""}">Customers</a><a href="#/team" class="${r.page === "team" ? "on" : ""}">Team</a></nav>` : "";
    return `<div class="topbar"><div class="brand">Zpar <span>Connect</span></div>${tabs}<span class="sp"></span>
      <span class="who">${e(S.session.user.email)}${S.manager ? " · Admin" : S.staff ? " · Manager" : ""}</span><button class="btn" type="button" data-act="signout">Sign out</button></div>`;
  }

  const CHECK = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-6.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  function stepper(o) {
    const cur = stageOf(o), dates = o.stage_dates || {};
    return `<div class="card stepper-box"><div class="stepper" role="list" aria-label="Order progress">${STAGES.map((s, i) => {
      const k = i + 1, cls = k < cur ? "done" : k === cur ? "cur" : "";
      return `<div class="step ${cls}" role="listitem" ${k === cur ? 'aria-current="step"' : ""}>
        <div class="bub">${k < cur ? CHECK : k}</div><div class="nm">${e(s.n)}</div>
        ${s.bill ? `<div class="bill">${s.bill}</div>` : ""}${dates[k] && k <= cur ? `<div class="dt">${fmtD(dates[k])}</div>` : ""}</div>`;
    }).join("")}</div></div>`;
  }

  // ---------- Job Site Arrival Checklist ----------
  const sections = () => { const m = new Map(); for (const i of S.items) { if (!m.has(i.section)) m.set(i.section, []); m.get(i.section).push(i); } return [...m.entries()]; };
  function draftOf(o) {
    S.draft = S.draft || {};
    if (!S.draft[o.id]) S.draft[o.id] = { checklist: { ...(o.checklist || {}) }, fields: { ...(o.site_address ? { site_address: o.site_address } : {}), ...(o.checklist_fields || {}) }, notes: o.checklist_notes || "" };
    return S.draft[o.id];
  }
  const itemDone = (i, d) => d.checklist[i.key] === "na" || (d.checklist[i.key] === "yes" && (i.fields || []).every((f) => String(d.fields[f.key] || "").trim()));
  const progress = (o) => { const d = o.customer_signoff ? { checklist: o.checklist || {}, fields: o.checklist_fields || {} } : draftOf(o); const n = S.items.filter((i) => itemDone(i, d)).length; return { n, total: S.items.length, all: S.items.length > 0 && n === S.items.length }; };
  const clStatus = (o) => o.crew_signoff ? "Signed by customer & crew" : o.customer_signoff ? "Customer signed · crew pending" : "Waiting on customer";

  function checklistItems(o, editable) {
    const d = editable ? draftOf(o) : { checklist: o.checklist || {}, fields: o.checklist_fields || {}, notes: o.checklist_notes || "" };
    const dis = editable ? "" : "disabled";
    return sections().map(([sec, items], si) => `<div class="cl-sec">${si + 1}. ${e(sec)}</div>${items.map((i) => {
      const v = d.checklist[i.key];
      return `<div class="cl-item ${itemDone(i, d) ? "on" : ""}">
        <input type="checkbox" id="ck_${e(i.key)}" data-ck="${e(i.key)}" ${v === "yes" ? "checked" : ""} ${dis} aria-label="Confirmed">
        <div class="cl-body"><label for="ck_${e(i.key)}">${e(i.text)}</label>
          ${(i.fields || []).length ? `<div class="cl-fields">${i.fields.map((f) => `<label class="f" for="fl_${e(f.key)}" ${f.wide ? 'style="grid-column:1/-1"' : ""}>${e(f.label)}<input id="fl_${e(f.key)}" data-fld="${e(f.key)}" value="${e(d.fields[f.key] || "")}" ${dis} ${v === "na" ? "disabled" : ""}></label>`).join("")}</div>` : ""}</div>
        ${i.allow_na ? `<label class="na" for="na_${e(i.key)}"><input type="checkbox" id="na_${e(i.key)}" data-na="${e(i.key)}" ${v === "na" ? "checked" : ""} ${dis}>N/A</label>` : ""}</div>`;
    }).join("")}`).join("") + `
      <label class="f" for="cl_notes" style="margin-top:18px">Notes${editable ? " — planned changes to the space, questions or anything that isn't ready" : ""}<textarea id="cl_notes" data-notes="1" ${dis}>${e(d.notes || "")}</textarea></label>`;
  }

  function signoffSummary(o) {
    const c = o.customer_signoff, k = o.crew_signoff;
    return `<div class="signs">
      <div class="signed ${c ? "" : "pending"}"><div class="eyebrow">Customer representative</div>${c ? `<b>${e(c.name)}</b>${c.title ? `, ${e(c.title)}` : ""}<div class="meta">${fmtDT(c.signed_at)}</div>` : `<span class="meta">Not signed yet</span>`}</div>
      <div class="signed ${k ? "" : "pending"}"><div class="eyebrow">ZPar crew lead</div>${k ? `<b>${e(k.crew_lead)}</b><div class="meta">${fmtDT(k.signed_at)}${k.install_dates ? ` · Install ${e(k.install_dates)}` : ""}</div>${k.crew_present ? `<div class="meta">Crew: ${e(k.crew_present)}</div>` : ""}` : `<span class="meta">Countersigns on arrival</span>`}</div></div>`;
  }

  function customerChecklist(o) {
    const st = stageOf(o), pr = progress(o);
    if (o.customer_signoff) {
      return `<div class="card"><div class="row"><div class="eyebrow">Job Site Install Preparation & Expectations</div><span class="sp"></span><span class="pill go">Signed</span></div>
        <p class="lead" style="margin:8px 0 0">${o.crew_signoff ? "Our crew lead completed the site verification walk-through on arrival." : "Thank you. Our crew will perform a site verification walk-through on arrival, before installation begins."}</p>
        ${signoffSummary(o)}<details style="margin-top:14px"><summary class="btn link">View your answers and photos</summary>${checklistItems(o, false)}${photosBlock(o, false)}</details></div>`;
    }
    if (st >= 9) return "";
    return `<div class="card action" id="checklist"><div class="row"><div class="eyebrow warn-ink">Action required · Job Site Install Preparation & Expectations</div><span class="sp"></span>
        <span class="pill ${pr.all ? "go" : "warn"}" id="clCount">${pr.n} of ${pr.total} complete</span></div>
      <p class="meta" style="margin:6px 0 0">Please review and confirm the items below before our crew's scheduled arrival.</p>
      <div class="cw-head" style="margin-top:12px">
        <div><div class="eyebrow">Job / PO #</div><div class="ro mono">${e(o.number || "—")}</div></div>
        <div><div class="eyebrow">Site address</div><div class="ro">${e(o.site_address || "Confirm below")}</div></div>
        <div><div class="eyebrow">Scheduled install date</div><div class="ro">${e(o.install_date || "To be scheduled")}</div></div></div>
      <p class="lead" style="margin:10px 0 0">To keep your installation on schedule and avoid delays or added trip charges, please confirm the following are complete before our crew arrives. Our crew will perform a site verification walk-through on arrival — if conditions don't match this sheet, we may need to reschedule.</p>
      <p class="meta" style="margin:6px 0 0" id="clSaved">Your answers save automatically.</p>
      ${checklistItems(o, true)}
      ${photosBlock(o, true)}
      <p class="meta" style="margin:18px 0 0">Questions before your install date? Contact ${e(o.pm_name || "your ZPar project manager")} at ${e(o.pm_email || CFG.SUPPORT_EMAIL || "")} — we're happy to walk through any item above.</p>
      <p class="meta" style="margin:10px 0 0"><b>By signing below, I confirm the above has been reviewed and the site will be ready as described by the scheduled install date.</b></p>
      <div class="sign"><label class="f" for="sg_name">Printed name<input id="sg_name" autocomplete="name"></label>
        <label class="f" for="sg_title">Title<input id="sg_title" autocomplete="organization-title"></label></div>
      <div class="row" style="margin-top:14px"><button class="btn go" type="button" data-act="sign" id="signBtn" ${pr.all ? "" : "disabled"}>Sign</button>
        <span class="meta" id="signHint">${pr.all ? "All items complete." : "Complete every item to sign."}</span></div></div>`;
  }

  const adminFilling = (o) => !!(o && S.manager && !o.customer_signoff && stageOf(o) < 9 && S.fillFor && S.fillFor[o.id]);
  function staffChecklist(o) {
    const pr = progress(o), c = o.customer_signoff, canFill = S.manager && !c && stageOf(o) < 9, filling = adminFilling(o);
    return `<div class="card ${filling ? "action" : ""}"><div class="row"><div class="eyebrow ${filling ? "warn-ink" : ""}">Customer Job Site Preparation sheet${filling ? " · admin entry" : ""}</div><span class="sp"></span>
        <span class="pill ${c || pr.all ? "go" : "warn"}" ${filling ? 'id="clCount"' : ""}>${c ? "Signed by customer" : filling ? `${pr.n} of ${pr.total} complete` : "Waiting on customer"}</span>
        ${canFill ? `<button class="btn ${filling ? "go" : ""}" type="button" data-act="fillfor">${filling ? "Done" : "Fill out for customer"}</button>` : ""}</div>
      ${filling ? `<p class="meta" style="margin:8px 0 0" id="clSaved">You're filling this out on the customer's behalf. Answers save automatically and appear on the customer's portal. The customer still signs it themselves.</p>${checklistItems(o, true)}
      <div class="row" style="margin-top:14px"><span class="sp"></span><button class="btn go" type="button" data-act="fillfor">Done</button></div>` : `
      <p class="meta" style="margin:8px 0 0">${c ? `${e(c.name)}${c.title ? `, ${e(c.title)}` : ""} completed ${pr.n} of ${pr.total} items · ${fmtDT(c.signed_at)}` : `Customer progress: ${pr.n} of ${pr.total} items. They complete and sign it on their portal page${canFill ? ", or an admin can fill it out for them" : ""}.`}</p>
      <details style="margin-top:10px"><summary class="btn link">Customer answers</summary>${checklistItems(o, false)}</details>`}
      ${photosBlock(o, true)}
      ${c ? `<div class="row" style="margin-top:12px"><span class="sp"></span><button class="btn" type="button" data-act="reopen">Reopen for customer</button></div>` : ""}</div>
      ${crewChecklist(o)}`;
  }

  // ---------- Crew Arrival Checklist (ZPar crew lead, on arrival) ----------
  let CREW_ITEMS = [], CREW_SECTIONS = []; // loaded from the crew_items table
  function crewDraft(o) {
    S.cdraft = S.cdraft || {};
    if (!S.cdraft[o.id]) { const h = o.crew_header || {}, k = o.crew_signoff || {};
      S.cdraft[o.id] = { checklist: { ...(o.crew_checklist || {}) }, fields: { ...(o.crew_fields || {}) }, notes: o.crew_notes || "",
        header: { lead: k.crew_lead || h.lead || "", crew: k.crew_present || h.crew || "", dates: k.install_dates || h.dates || "", rep: k.customer_rep || h.rep || c1(o) } }; }
    return S.cdraft[o.id];
  }
  const c1 = (o) => (o.customer_signoff && o.customer_signoff.name) || "";
  const crewDone = (i, d) => { const v = d.checklist[i.key]; return v === "na" || v === "exc" || (v === "yes" && i.fields.every((f) => String(d.fields[f.key] || "").trim())); };
  function crewProg(o) {
    const d = o.crew_signoff ? { checklist: o.crew_checklist || {}, fields: o.crew_fields || {}, notes: o.crew_notes || "", header: {} } : crewDraft(o);
    const n = CREW_ITEMS.filter((i) => crewDone(i, d)).length, exc = Object.values(d.checklist).filter((v) => v === "exc").length;
    const needNotes = exc > 0 && !String(d.notes || "").trim(), needLead = String((d.header || {}).lead || "").trim().length < 2;
    return { n, total: CREW_ITEMS.length, exc, all: n === CREW_ITEMS.length, needNotes, needLead, ready: n === CREW_ITEMS.length && !needNotes && !needLead };
  }
  const custLabel = (o, key) => { const it = S.items.find((i) => i.key === key); if (!it) return ""; const v = (o.checklist || {})[key];
    return `<div class="cw-cust">Customer: ${v === "yes" ? "confirmed" : v === "na" ? "N/A" : "not confirmed"}${it.fields && it.fields.length ? it.fields.map((f) => (o.checklist_fields || {})[f.key] ? ` · ${e(f.label)} ${e(o.checklist_fields[f.key])}` : "").join("") : ""}</div>`; };
  function crewChecklist(o) {
    const k = o.crew_signoff, ro = !!k, d = ro ? { checklist: o.crew_checklist || {}, fields: o.crew_fields || {}, notes: o.crew_notes || "", header: {} } : crewDraft(o);
    const pr = crewProg(o), dis = ro ? "disabled" : "";
    const statusPill = k ? `<span class="pill ${k.exceptions ? "warn" : "go"}">Signed${k.exceptions ? ` · ${k.exceptions} exception${k.exceptions === 1 ? "" : "s"}` : ""}</span>` : `<span class="pill ${pr.all ? "go" : "warn"}" id="cwCount">${pr.n} of ${pr.total} reviewed</span>`;
    const hv = (key, label, ph, full) => `<label class="f${full ? " full" : ""}" for="cwh_${key}">${label}<input id="cwh_${key}" data-cwh="${key}" value="${e(ro ? { lead: k.crew_lead, crew: k.crew_present, dates: k.install_dates, rep: k.customer_rep }[key] || "" : d.header[key] || "")}" ${ph ? `placeholder="${ph}"` : ""} ${dis}></label>`;
    const items = CREW_SECTIONS.map((sec, si) => `<div class="cl-sec">${si + 1}. ${e(sec)}</div>${CREW_ITEMS.filter((i) => i.sec === si + 1).map((i) => {
      const v = d.checklist[i.key];
      const btn = (val, lbl) => `<button type="button" data-cw="${e(i.key)}" data-cwv="${val}" aria-pressed="${v === val}" ${dis}>${lbl}</button>`;
      return `<div class="cw-item ${v === "exc" ? "exc" : ""}"><div class="cw-body"><span>${e(i.text)}</span>
          ${i.fields.length ? `<div class="cl-fields">${i.fields.map((f) => `<label class="f" for="cf_${e(f.key)}">${e(f.label)}<input id="cf_${e(f.key)}" data-cwfld="${e(f.key)}" value="${e(d.fields[f.key] || "")}" ${dis || (v === "na" ? "disabled" : "")}></label>`).join("")}</div>` : ""}
          ${custLabel(o, i.key)}</div>
        <div class="seg3" role="group" aria-label="${e(i.text)}" ${ro ? 'aria-disabled="true"' : ""}>${btn("yes", "✓ OK")}${btn("exc", "Exception")}${i.allow_na ? btn("na", "N/A") : ""}</div></div>`;
    }).join("")}`).join("");
    const hint = !o.customer_signoff ? "The customer must sign their Job Site Preparation sheet first." : pr.ready ? "Ready to sign." : !pr.all ? `${pr.total - pr.n} item${pr.total - pr.n === 1 ? "" : "s"} left to review.` : pr.needNotes ? "Describe each exception in the notes." : "Enter the crew lead's name.";
    S.crewCollapsed = S.crewCollapsed || {};
    const col = S.crewCollapsed[o.id] ?? !!k;
    const tgl = `<button class="btn" type="button" data-act="crewtoggle" aria-expanded="${!col}" aria-controls="crewBody">${col ? "Expand ▾" : "Collapse ▴"}</button>`;
    return `<div class="card ${k ? "" : "action"}" id="crew"><div class="row"><div class="eyebrow ${k ? "" : "warn-ink"}">Crew Arrival Checklist & Sign-Off · required before Installation</div><span class="sp"></span>${statusPill}${tgl}</div>
      ${col ? `<p class="meta" style="margin:8px 0 0">${k ? `Signed by crew lead <b>${e(k.crew_lead)}</b> · ${fmtDT(k.signed_at)}` : `${pr.n} of ${pr.total} items reviewed${pr.exc ? ` · ${pr.exc} exception${pr.exc === 1 ? "" : "s"}` : ""}. Expand to continue.`}</p></div>` : `<div id="crewBody">
      <p class="lead" style="margin:8px 0 0;font-size:15px">${k ? `Signed by crew lead <b>${e(k.crew_lead)}</b> · ${fmtDT(k.signed_at)}${k.customer_rep ? ` · reviewed with ${e(k.customer_rep)}` : ""}` : "To be completed by the crew lead immediately on arrival, before any installation work begins. Walk the entire site before unloading and review each item. If an item can't be confirmed, mark it <b>Exception</b>, describe it in the notes and contact the office before proceeding."}</p>
      <div class="cw-head">
        <div><div class="eyebrow">Customer</div><div class="ro">${e(o.customers?.name || "")}</div></div>
        <div><div class="eyebrow">Job / PO #</div><div class="ro mono">${e(o.number || "—")}</div></div>
        <div><div class="eyebrow">Site address</div><div class="ro">${e(o.site_address || "—")}</div></div>
        ${hv("lead", "Crew lead")}${hv("crew", "Crew present", "Names")}${hv("dates", "Install date(s)", "e.g. Oct 5–9, 2026")}
      </div>
      ${ro ? `<details style="margin-top:12px"><summary class="btn link">View crew answers</summary>${items}</details>` : items}
      <label class="f" for="cw_notes" style="margin-top:18px">Notes / discrepancies ${ro ? "" : "(add photos below)"}<textarea id="cw_notes" data-cwnotes="1" ${dis}>${e(d.notes || "")}</textarea></label>
      ${ro ? `<div class="row" style="margin-top:14px"><span class="sp"></span><button class="btn" type="button" data-act="crewreopen">Reopen crew checklist</button></div>` : `
      <p class="meta" style="margin:16px 0 0">By signing, the crew lead and customer representative confirm the site conditions above were reviewed together before the start of installation, and any exceptions were noted.</p>
      <div class="grid2" style="margin-top:12px">${hv("rep", "Customer representative on site")}</div>
      <p class="meta" id="cwSaved" style="margin:10px 0 0">Crew answers save automatically.</p>
      <div class="row" style="margin-top:12px"><button class="btn go" type="button" data-act="crewsign" id="cwSign" ${pr.ready && o.customer_signoff ? "" : "disabled"}>Crew lead sign-off</button>
        <span class="meta" id="cwHint">${hint}</span></div>`}</div></div>`}`;
  }
  function refreshCrewUI(o) {
    const pr = crewProg(o), cnt = document.getElementById("cwCount"), btn = document.getElementById("cwSign"), hint = document.getElementById("cwHint");
    if (cnt) { cnt.textContent = `${pr.n} of ${pr.total} reviewed`; cnt.className = "pill " + (pr.all ? "go" : "warn"); }
    if (btn) btn.disabled = !(pr.ready && o.customer_signoff);
    if (hint) hint.textContent = !o.customer_signoff ? "The customer must sign their Job Site Preparation sheet first." : pr.ready ? "Ready to sign." : !pr.all ? `${pr.total - pr.n} item${pr.total - pr.n === 1 ? "" : "s"} left to review.` : pr.needNotes ? "Describe each exception in the notes." : "Enter the crew lead's name.";
  }
  let crewTimer = null;
  function queueCrewSave(o, delay) {
    const el = document.getElementById("cwSaved"); if (el) el.textContent = "Saving…";
    clearTimeout(crewTimer);
    crewTimer = setTimeout(async () => {
      const d = crewDraft(o);
      const { error } = await sb.rpc("save_crew_checklist", { p_order: o.id, p_checklist: d.checklist, p_fields: d.fields, p_notes: d.notes, p_header: d.header });
      const el2 = document.getElementById("cwSaved");
      if (error) { if (el2) el2.textContent = "Not saved: " + errMsg(error); toast(errMsg(error)); return; }
      o.crew_checklist = { ...d.checklist }; o.crew_fields = { ...d.fields }; o.crew_notes = d.notes; o.crew_header = { ...d.header };
      if (el2) el2.textContent = "All changes saved.";
    }, delay);
  }

  // ---------- Checklist photos ----------
  const BUCKET = "checklist-photos";
  const itemLabel = (k) => { const i = S.items.find((x) => x.key === k); return i ? i.text : "General / discrepancy"; };
  async function loadPhotos(orderId) {
    const { data, error } = await sb.from("checklist_photos").select("*").eq("order_id", orderId).order("created_at");
    if (error) { S.photos[orderId] = []; return; }
    const rows = data || [];
    if (rows.length) {
      const { data: urls } = await sb.storage.from(BUCKET).createSignedUrls(rows.map((r) => r.path), 3600);
      const m = new Map((urls || []).map((u) => [u.path, u.signedUrl]));
      rows.forEach((r) => (r.url = m.get(r.path) || ""));
    }
    S.photos[orderId] = rows;
  }
  function photosBlock(o, canUpload) {
    const list = S.photos[o.id];
    const me = S.session.user.email.toLowerCase();
    const canDel = (p) => S.staff || (p.uploaded_by === me && !o.customer_signoff && stageOf(o) < 9);
    const grid = list === undefined ? `<p class="meta">Loading photos…</p>`
      : list.length ? `<div class="photos">${list.map((p) => `<figure class="photo">
          <a href="${e(p.url)}" target="_blank" rel="noopener">${p.url ? `<img src="${e(p.url)}" alt="${e(itemLabel(p.item_key))}" loading="lazy">` : ""}</a>
          <figcaption><span>${e(itemLabel(p.item_key))}</span><span class="meta">${p.by_staff ? "ZPar" : "Customer"} · ${fmtD(p.created_at)}</span>
          ${canDel(p) ? `<button class="btn link" type="button" data-act="rmphoto" data-id="${e(p.id)}">Remove</button>` : ""}</figcaption></figure>`).join("")}</div>`
      : `<p class="meta" style="margin:0">No photos yet.</p>`;
    const up = canUpload ? `<div class="row uploader">
        <select id="ph_item" aria-label="Photo shows" style="flex:2 1 220px;width:auto;min-width:0;max-width:100%"><option value="">General / discrepancy</option>${S.items.map((i) => `<option value="${e(i.key)}">${e(i.text.length > 70 ? i.text.slice(0, 67) + "…" : i.text)}</option>`).join("")}</select>
        <label class="btn go" for="ph_file" style="cursor:pointer">Add photos</label>
        <input id="ph_file" type="file" accept="image/*" multiple hidden>
        <span class="meta" id="ph_status"></span></div>` : "";
    return `<div class="photo-sec"><div class="cl-sec" style="margin-top:22px">Photos</div>
      ${canUpload ? `<p class="meta" style="margin:10px 0">Add photos of the space, openings, utility stubs and any discrepancies. Pick what the photo shows, then choose one or more images (up to 10 MB each).</p>` : ""}
      ${up}${grid}</div>`;
  }
  // Shrink large phone photos before upload (keeps them sharp, ~0.5–1.5 MB).
  async function prepareImage(file) {
    try {
      const bmp = await createImageBitmap(file);
      const max = 2400, scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
      if (scale === 1 && file.size < 3e6 && /jpe?g|png|webp/.test(file.type)) return { blob: file, ext: (file.type.split("/")[1] || "jpg").replace("jpeg", "jpg"), type: file.type };
      const c = document.createElement("canvas"); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
      c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
      if (blob) return { blob, ext: "jpg", type: "image/jpeg" };
    } catch (_) { /* e.g. HEIC outside Safari: upload the original */ }
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    return { blob: file, ext, type: file.type || "image/jpeg" };
  }
  async function uploadPhotos(o, files, itemKey) {
    const st = document.getElementById("ph_status");
    let ok = 0, fail = 0;
    for (const [n, file] of [...files].entries()) {
      if (st) st.textContent = `Uploading ${n + 1} of ${files.length}…`;
      if (!file.type.startsWith("image/") && !/\.(heic|heif)$/i.test(file.name)) { fail++; continue; }
      const img = await prepareImage(file);
      if (img.blob.size > 10485760) { fail++; toast(`${file.name} is over 10 MB.`); continue; }
      const path = `${o.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${img.ext}`;
      const up = await sb.storage.from(BUCKET).upload(path, img.blob, { contentType: img.type, upsert: false });
      if (up.error) { fail++; toast(errMsg(up.error)); continue; }
      const ins = await sb.from("checklist_photos").insert({ order_id: o.id, path, item_key: itemKey || null, uploaded_by: S.session.user.email.toLowerCase(), by_staff: S.staff });
      if (ins.error) { fail++; await sb.storage.from(BUCKET).remove([path]); toast(errMsg(ins.error)); continue; }
      ok++;
    }
    await loadPhotos(o.id); render();
    toast(fail ? `${ok} uploaded, ${fail} failed.` : `${ok} photo${ok === 1 ? "" : "s"} added.`);
  }

  function refreshProgressUI(o) {
    const pr = progress(o), cnt = document.getElementById("clCount"), btn = document.getElementById("signBtn"), hint = document.getElementById("signHint");
    if (cnt) { cnt.textContent = `${pr.n} of ${pr.total} complete`; cnt.className = "pill " + (pr.all ? "go" : "warn"); }
    if (btn) btn.disabled = !pr.all;
    if (hint) hint.textContent = pr.all ? "All items complete." : "Complete every item to sign.";
  }
  let saveTimer = null;
  function queueSave(o, delay) {
    const el = document.getElementById("clSaved"); if (el) el.textContent = "Saving…";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const d = draftOf(o);
      const { error } = await sb.rpc("save_site_checklist", { p_order: o.id, p_checklist: d.checklist, p_fields: d.fields, p_notes: d.notes });
      const el2 = document.getElementById("clSaved");
      if (error) { if (el2) el2.textContent = "Not saved: " + errMsg(error); toast(errMsg(error)); return; }
      o.checklist = { ...d.checklist }; o.checklist_fields = { ...d.fields }; o.checklist_notes = d.notes;
      if (el2) el2.textContent = "All changes saved.";
    }, delay);
  }

  // ---------- login ----------
  function loginView(sent) {
    return `<div class="card login stack">
      <div><div class="eyebrow">${e(CFG.COMPANY || "ZPar International")}</div><h1>Zpar Connect</h1></div>
      ${sent ? `<p class="lead">Check <b>${e(sent)}</b> for a sign-in link. It expires in one hour.</p><button class="btn" type="button" data-act="relogin">Use a different email</button>`
      : `<p class="meta" style="margin:0">Enter the email address ZPar has on file for your project. We'll email you a sign-in link — no password needed.</p>
        <form id="loginForm" class="stack" style="gap:12px"><label class="f" for="lg_email">Email<input id="lg_email" type="email" autocomplete="email" required></label>
        <button class="btn go" type="submit">Email me a sign-in link</button><div class="err" id="lgErr"></div></form>`}</div>`;
  }

  // ---------- customer ----------
  function customerHome() {
    const r = route();
    if (!S.orders.length) return `${topbar()}<div class="card empty">No projects are linked to ${e(S.session.user.email)} yet. If you expected to see one, contact ${e(CFG.SUPPORT_EMAIL || "your ZPar project manager")}.</div>`;
    const o = r.page === "order" ? S.orders.find((x) => x.id === r.id) : S.orders.length === 1 ? S.orders[0] : null;
    if (!o) {
      return `${topbar()}<div class="stack"><header><div class="eyebrow">Welcome</div><h1>${e(S.orders[0].customers?.name || "Your projects")}</h1></header><div class="cards">${S.orders.map((x) => { const st = stageOf(x); return `
        <a class="ocard" href="#/order/${e(x.id)}"><div class="mono meta">${e(x.number || "")}</div><b>${e(x.project || "Project")}</b>
        <div class="bar" style="margin-top:12px"><i style="width:${(st / LAST) * 100}%"></i></div>
        <div class="meta" style="margin-top:6px">${st}. ${e(STAGES[st - 1].n)}</div></a>`; }).join("")}</div></div>`;
    }
    const st = stageOf(o), dates = o.stage_dates || {}, next = st < LAST ? STAGES[st].n : null;
    const reached = STAGES.map((s, i) => ({ n: s.n, d: dates[i + 1] })).slice(0, st).filter((x) => x.d).reverse();
    const pm = o.pm_name ? `<b>${e(o.pm_name)}</b>${o.pm_email ? `<div class="mono" style="margin-top:4px">${e(o.pm_email)}</div>` : ""}` : `<div class="mono">${e(CFG.SUPPORT_EMAIL || "")}</div>`;
    return `${topbar()}<div class="stack">
      ${S.orders.length > 1 ? `<div><a class="btn link" href="#/">← All projects</a></div>` : ""}
      <header><div class="eyebrow">Welcome</div><h1>${e(o.customers?.name || "Your project")}</h1><div class="sub">${e([o.number, o.project].filter(Boolean).join(" · "))}</div></header>
      ${stepper(o)}
      <section class="card hero">
        <div class="eyebrow">Current status · Stage ${st} of ${LAST}</div>
        <div class="hero-stage">${e(STAGES[st - 1].n)}</div>
        <p class="lead" style="margin:6px 0 0">${e(STAGE_TEXT[st - 1])}</p>
        <div class="bar" style="margin-top:18px" role="progressbar" aria-valuemin="0" aria-valuemax="${LAST}" aria-valuenow="${st}"><i style="width:${(st / LAST) * 100}%"></i></div>
        <div class="row meta" style="margin-top:8px"><span>${dates[st] ? `Since ${fmtD(dates[st])}` : ""}</span><span class="sp"></span><span>${next ? `Next: ${e(next)}` : "Complete"}</span></div>
      </section>
      ${o.customer_signoff ? "" : customerChecklist(o)}
      <div class="two">
        <div class="card"><div class="eyebrow" style="margin-bottom:8px">Milestones</div>
          ${reached.length ? `<ul class="events">${reached.map((x) => `<li><span class="mono">${fmtD(x.d)}</span><span>${e(x.n)}</span></li>`).join("")}</ul>` : `<p class="meta" style="margin:0">Milestone dates appear here as your project moves forward.</p>`}</div>
        <div class="card"><div class="eyebrow" style="margin-bottom:8px">Your ZPar contact</div>${pm}
          ${o.site_address ? `<div class="eyebrow" style="margin:18px 0 6px">Job site</div><div>${e(o.site_address)}</div>` : ""}</div>
      </div>
      ${o.customer_signoff ? customerChecklist(o) : ""}
    </div>`;
  }

  // ---------- staff ----------
  function staffOrders() {
    const act = S.orders.filter((o) => stageOf(o) < LAST), q = S.q.toLowerCase();
    let rows = S.orders.filter((o) => S.show === "All" || (S.show === "Active" ? stageOf(o) < LAST : stageOf(o) === LAST));
    if (q) rows = rows.filter((o) => [o.customers?.name, o.number, o.project, o.pm_name, o.sales_rep, o.products_note, ...(o.lines || []).map((l) => l.item)].join(" ").toLowerCase().includes(q));
    const sync = S.lastSync;
    return `${topbar()}<div class="stack">
      <header class="row"><div><div class="eyebrow">Orders since Aug 1, 2026 · from QuickBooks + manual entries</div><h1>Orders</h1></div><span class="sp"></span>
        <div class="status"><span class="dot ${sync ? (sync.ok ? "live" : "off") : ""}"></span>${sync ? (sync.ok ? `Synced ${fmtDT(sync.ran_at)}` : `Last sync failed ${fmtDT(sync.ran_at)}`) : "No QuickBooks sync yet"}</div></header>
      ${sync && !sync.ok ? `<div class="notice">${e(sync.message)}</div>` : ""}
      <section class="kpis" aria-label="Summary" ${S.manager ? "" : 'style="grid-template-columns:repeat(3,minmax(0,1fr))"'}>
        <div class="kpi"><small>Active orders</small><b>${act.length}</b></div>
        ${S.manager ? `<div class="kpi"><small>Active order value</small><b>${money(act.reduce((a, o) => a + (Number(o.amount) || 0), 0))}</b></div>` : ""}
        <div class="kpi"><small>Waiting on customer</small><b>${act.filter((o) => [2, 5].includes(stageOf(o))).length}</b><small>site prep or drawing approval</small></div>
        <div class="kpi"><small>Site prep sheet not signed</small><b>${act.filter((o) => stageOf(o) < 9 && !o.customer_signoff).length}</b><small>required before Installation</small></div>
      </section>
      <div class="row"><input id="q" type="search" placeholder="Search customer, order #, project, product, rep…" value="${e(S.q)}" style="flex:1 1 220px;width:auto" aria-label="Search orders">
        <select id="show" style="width:auto" aria-label="Show">${["Active", "Completed", "All"].map((x) => `<option ${x === S.show ? "selected" : ""}>${x}</option>`).join("")}</select></div>
      <div class="tablebox"><table><thead><tr><th>Order</th><th>Customer / project</th><th>Products & services</th><th>Sales rep</th><th>Stage</th><th>Site prep / crew</th>${S.manager ? `<th style="text-align:right">Amount</th>` : ""}</tr></thead>
      <tbody>${rows.length ? rows.map((o) => { const st = stageOf(o); return `<tr tabindex="0" data-open="${e(o.id)}">
        <td class="mono">${e(o.number || "—")}<div class="meta" style="font-family:var(--f-body)">${fmtD(o.order_date) || ""}</div></td><td><b>${e(o.customers?.name || "")}</b><div class="meta">${e(o.project || "")}${o.source === "manual" ? " · <b>Manual entry</b>" : ""}</div></td>
        <td class="ps">${productsSummary(o)}</td>
        <td>${o.sales_rep ? e(o.sales_rep) : '<span class="meta">—</span>'}</td>
        <td><span class="pill ${st === LAST ? "go" : [2, 5].includes(st) ? "warn" : ""}">${st}. ${e(STAGES[st - 1].n)}</span></td>
        <td>${st >= 9 && !o.crew_signoff ? '<span class="meta">—</span>' : `<span class="pill ${o.crew_signoff ? "go" : o.customer_signoff ? "" : "warn"}">${o.crew_signoff ? "Complete" : o.customer_signoff ? `Crew ${crewProg(o).n}/${crewProg(o).total}` : `Customer ${progress(o).n}/${progress(o).total}`}</span>`}</td>
        ${S.manager ? `<td class="num">${money(o.amount)}</td>` : ""}</tr>`; }).join("")
        : `<tr><td colspan="${S.manager ? 7 : 6}" class="empty">No orders here yet. They appear after the next QuickBooks sync.</td></tr>`}</tbody></table></div></div>`;
  }

  function staffOrder(o) {
    const st = stageOf(o), notes = S.internal?.[o.id] ?? "", ev = S.events?.[o.id] || [];
    const contacts = S.contacts.filter((c) => c.customer_id === o.customer_id);
    return `${topbar()}<div class="stack">
      <div><a class="btn link" href="#/">← All orders</a></div>
      <header><h1>${e(o.customers?.name || "")}</h1><div class="sub">${e([o.number, o.project].filter(Boolean).join(" · "))}</div></header>
      ${stepper(o)}
      <div class="card"><div class="row"><div class="eyebrow">Stage ${st} of ${LAST}</div><span class="sp"></span>
        <button class="btn" type="button" data-act="back" ${st > 1 ? "" : "disabled"}>Move back</button>
        <button class="btn go" type="button" data-act="adv" ${st < LAST && !(st === 8 && !o.crew_signoff) ? "" : "disabled"}>${st < LAST ? `Advance to ${st + 1}. ${e(STAGES[st].n)}` : "Completed"}</button></div>
        ${st === 8 && !o.crew_signoff ? `<p class="meta" style="margin:10px 0 0">Installation is locked until the customer signs the Job Site Preparation sheet and the crew lead signs the Crew Arrival Checklist.</p>` : ""}</div>
      ${staffChecklist(o)}
      <div class="card"><div class="eyebrow" style="margin-bottom:12px">Order details</div>
        <form id="det" class="grid2">
          <label class="f">Order # <span class="meta" style="font-weight:400">· ${SRC(o)}</span><input value="${e(o.number || "")}" disabled></label>
          ${S.manager ? `<label class="f">Amount <span class="meta" style="font-weight:400">· ${SRC(o)}</span><input value="${e(money(o.amount))}" disabled></label>` : ""}
          ${o.source === "manual" ? `<label class="f">Source<input value="${e("Manual entry" + (o.created_by ? " by " + o.created_by : ""))}" disabled></label><label class="f">Order date<input value="${e(fmtD(o.order_date))}" disabled></label>` : `<label class="f">QuickBooks status<input value="${e(o.qb_status || "")}" disabled></label>
          <label class="f">Accepted date <span class="meta" style="font-weight:400">· QuickBooks</span><input value="${e(o.accepted_date ? fmtD(o.accepted_date) : (o.estimate_date ? "Not recorded · estimate dated " + fmtD(o.estimate_date) : ""))}" disabled></label>`}
          <label class="f">Sales rep <span class="meta" style="font-weight:400">· ${SRC(o)}</span><input value="${e(o.sales_rep || (o.source === "manual" ? "Not set" : "Not set in QuickBooks"))}" disabled></label>
          <label class="f full">Project / scope <span class="meta" style="font-weight:400">· ${SRC(o)}</span><input value="${e(o.project || "")}" disabled></label>
          <label class="f" for="d_pm_name">ZPar PM (shown to customer)<input id="d_pm_name" name="pm_name" value="${e(o.pm_name || "")}"></label>
          <label class="f" for="d_pm_email">PM email<input id="d_pm_email" name="pm_email" type="email" value="${e(o.pm_email || "")}"></label>
          <label class="f" for="d_site">Job site address<input id="d_site" name="site_address" value="${e(o.site_address || "")}"></label>
          <label class="f" for="d_inst">Scheduled install date (shown to customer)<input id="d_inst" name="install_date" value="${e(o.install_date || "")}" placeholder="e.g. Oct 5–9, 2026"></label>
          <label class="f full" for="d_notes">Internal notes (staff only)<textarea id="d_notes" name="notes">${e(notes)}</textarea></label>
          <div class="full"><button class="btn go" type="submit">Save</button></div></form></div>
      ${productsCard(o)}
      <div class="card"><div class="eyebrow" style="margin-bottom:8px">Customer logins for ${e(o.customers?.name || "this customer")}</div>
        ${contacts.length ? contacts.map((c) => `<div class="contact"><span class="mono">${e(c.email)}</span><span class="meta">${e(c.name || "")}</span></div>`).join("") : `<p class="meta">No customer email on file. Add one under Customers, or add an email to this customer in QuickBooks.</p>`}
        <p class="meta" style="margin:10px 0 0">They sign in at this portal's address with that email and see a read-only status page for this customer's projects.</p></div>
      <div class="card"><div class="eyebrow" style="margin-bottom:8px">Activity</div>
        ${ev.length ? `<ul class="events">${ev.map((x) => `<li><span class="mono">${fmtDT(x.created_at)}</span><span>${x.from_stage ? `${e(STAGES[x.from_stage - 1]?.n)} → ` : ""}<b>${e(STAGES[x.to_stage - 1]?.n)}</b> <span class="meta">${e(x.actor_email || "system")}</span></span></li>`).join("")}</ul>` : `<p class="meta" style="margin:0">No stage changes yet.</p>`}</div></div>`;
  }

  const SRC = (o) => (o.source === "manual" ? "Manual entry" : "QuickBooks");
  // Products & services: equipment items first, then install/service items (staff only; never rendered on customer pages)
  const SERVICE_ITEMS = ["labor", "maintenance labor", "control wiring", "rental equipment allowance", "startup", "freight", "services", "installation", "travel"];
  const isService = (n) => SERVICE_ITEMS.includes(String(n || "").trim().toLowerCase());
  function productsSummary(o) {
    if (o.products_note) return `<span>${e(o.products_note)}</span>`;
    const ls = o.lines || []; if (!ls.length) return '<span class="meta">—</span>';
    const uniq = (a) => [...new Set(a)];
    const eq = uniq(ls.filter((l) => !isService(l.item)).map((l) => l.item)), sv = uniq(ls.filter((l) => isService(l.item)).map((l) => l.item.replace("Rental Equipment Allowance", "Rental allowance")));
    return `${eq.length ? `<b class="ps-eq">${e(eq.join(", "))}</b>` : ""}${sv.length ? `<div class="meta">${eq.length ? "+ " : ""}${e(sv.join(", "))}</div>` : ""}`;
  }
  function productsCard(o) {
    const ls = o.lines || [];
    if (!ls.length && !o.products_note) return "";
    return `<div class="card"><div class="row"><div class="eyebrow">Products & services purchased</div><span class="sp"></span><span class="meta">${SRC(o)} · staff only</span></div>
      ${o.products_note ? `<p style="margin:10px 0 0">${e(o.products_note)}</p>` : `<div class="tablebox flat"><table class="ps-table"><thead><tr><th>Item</th><th>Description</th><th style="text-align:right">Qty</th>${S.manager ? `<th style="text-align:right">Amount</th>` : ""}</tr></thead>
      <tbody>${ls.map((l) => `<tr class="static"><td><b>${e(l.item)}</b>${isService(l.item) ? ' <span class="meta">service</span>' : ""}</td><td class="meta">${e(l.desc)}</td><td class="num">${e(String(l.qty).replace(/\.0+$/, ""))}</td>${S.manager ? `<td class="num">${money(l.amt)}</td>` : ""}</tr>`).join("")}</tbody></table></div>`}</div>`;
  }
  function newProjectView() {
    const today = new Date().toISOString().slice(0, 10);
    return `${topbar()}<div class="stack">
      <div><a class="btn link" href="#/manager">← Admin overview</a></div>
      <header><div class="eyebrow">Admin · manual entry</div><h1>Add a project</h1></header>
      <p class="meta" style="margin:0">For jobs that aren't coming through QuickBooks. The project starts at the stage you pick and then works like any other order.</p>
      <div class="card"><form id="newProj" class="grid2" autocomplete="off">
        <label class="f" for="np_cust">Customer *<input id="np_cust" name="customer" list="np_custs" required placeholder="Pick existing or type a new name"></label>
        <datalist id="np_custs">${S.customers.map((c) => `<option value="${e(c.name)}"></option>`).join("")}</datalist>
        <label class="f" for="np_email">Customer contact email<input id="np_email" name="email" type="email" placeholder="Gives them a portal login"></label>
        <label class="f" for="np_num">Order / job # *<input id="np_num" name="number" required placeholder="e.g. ZP26-10340"></label>
        <label class="f" for="np_date">Order date *<input id="np_date" name="order_date" type="date" required value="${today}"></label>
        <label class="f full" for="np_proj">Project / scope *<input id="np_proj" name="project" required placeholder="e.g. Cross-draft paint booth with AMU, installed"></label>
        <label class="f full" for="np_ps">Products & services (staff only)<input id="np_ps" name="products_note" placeholder="e.g. Paint booth, AMU + install labor, control wiring"></label>
        ${S.manager ? `<label class="f" for="np_amt">Amount ($)<input id="np_amt" name="amount" type="number" min="0" step="0.01" inputmode="decimal"></label>` : ""}
        <label class="f" for="np_stage">Starting stage<select id="np_stage" name="stage">${STAGES.slice(0, 8).map((s, i) => `<option value="${i + 1}">${i + 1}. ${e(s.n)}</option>`).join("")}</select></label>
        <label class="f" for="np_rep">Sales rep<input id="np_rep" name="sales_rep" list="np_reps"></label>
        <datalist id="np_reps">${[...new Set(S.orders.map((o) => o.sales_rep).filter(Boolean))].sort().map((r) => `<option value="${e(r)}"></option>`).join("")}</datalist>
        <label class="f" for="np_pm">ZPar PM (shown to customer)<input id="np_pm" name="pm_name"></label>
        <label class="f" for="np_pme">PM email<input id="np_pme" name="pm_email" type="email"></label>
        <label class="f" for="np_site">Job site address<input id="np_site" name="site_address"></label>
        <label class="f" for="np_inst">Scheduled install date<input id="np_inst" name="install_date" placeholder="e.g. Nov 3–7, 2026"></label>
        <div class="full row"><button class="btn go" type="submit">Add project</button><span class="err" id="npErr"></span></div>
      </form></div>
      <p class="meta" style="margin:0">Installation (stage 9) still requires both checklist sign-offs, so manual projects can start at stage 8 at the latest.</p></div>`;
  }

  function staffCustomers() {
    const q = S.q.toLowerCase();
    const list = S.customers.filter((c) => !q || c.name.toLowerCase().includes(q) || S.contacts.some((k) => k.customer_id === c.id && k.email.includes(q)));
    return `${topbar()}<div class="stack">
      <header><div class="eyebrow">Synced from QuickBooks</div><h1>Customers</h1></header>
      <p class="meta" style="margin:0">Each customer's logins can see only that customer's projects. QuickBooks emails are added automatically; add other people here.</p>
      <input id="q" type="search" placeholder="Search customers or emails…" value="${e(S.q)}" aria-label="Search customers">
      ${list.length ? list.map((c) => { const ks = S.contacts.filter((k) => k.customer_id === c.id); const n = S.orders.filter((o) => o.customer_id === c.id).length; return `
        <div class="card"><div class="row"><b>${e(c.name)}</b><span class="meta">${n} order${n === 1 ? "" : "s"}</span></div>
          ${ks.map((k) => `<div class="contact"><span class="mono">${e(k.email)}</span><span class="meta">${e([k.name, k.title].filter(Boolean).join(", "))}</span><span class="sp"></span>
            <button class="btn" type="button" data-act="rmcontact" data-id="${e(k.id)}">Remove</button></div>`).join("")}
          <form class="row addcontact" data-cust="${e(c.id)}" style="margin-top:12px">
            <input name="email" type="email" required placeholder="email@customer.com" style="flex:2 1 200px;width:auto" aria-label="Contact email">
            <input name="name" placeholder="Name" style="flex:1 1 140px;width:auto" aria-label="Contact name">
            <button class="btn" type="submit">Add login</button></form></div>`; }).join("")
        : `<div class="card empty">No customers yet. They appear after the first QuickBooks sync.</div>`}</div>`;
  }

  // ---------- manager ----------
  const STALL_DAYS = 14; // flag orders sitting in one stage longer than this
  const daysSince = (d) => (d ? Math.floor((Date.now() - new Date(String(d).length === 10 ? d + "T12:00:00" : d)) / 864e5) : null);
  function managerView() {
    const act = S.orders.filter((o) => stageOf(o) < LAST);
    const val = act.reduce((a, o) => a + (Number(o.amount) || 0), 0);
    const inStage = (o) => daysSince((o.stage_dates || {})[stageOf(o)]);
    const stalled = act.filter((o) => (inStage(o) ?? 0) > STALL_DAYS).sort((a, b) => inStage(b) - inStage(a));
    const blocked = act.filter((o) => stageOf(o) === 8 && !o.crew_signoff);
    const waitCust = act.filter((o) => [5].includes(stageOf(o)) || (stageOf(o) < 9 && !o.customer_signoff && stageOf(o) >= 7));
    const noPm = act.filter((o) => !o.pm_name);
    const upcoming = act.filter((o) => stageOf(o) >= 7 && stageOf(o) <= 9).sort((a, b) => stageOf(b) - stageOf(a));
    const monthAgo = Date.now() - 30 * 864e5;
    const completed30 = S.orders.filter((o) => stageOf(o) === LAST && new Date((o.stage_dates || {})[LAST] || 0) >= monthAgo).length;
    const byStage = STAGES.map((s, i) => { const os = S.orders.filter((o) => stageOf(o) === i + 1); return { n: s.n, k: i + 1, c: os.length, v: os.reduce((a, o) => a + (Number(o.amount) || 0), 0) }; });
    const maxC = Math.max(1, ...byStage.map((x) => x.c));
    const pms = {}; act.forEach((o) => { const k = o.pm_name || "Unassigned"; pms[k] = pms[k] || { n: 0, v: 0, att: 0 }; pms[k].n++; pms[k].v += Number(o.amount) || 0; if (stalled.includes(o) || blocked.includes(o)) pms[k].att++; });
    const row = (o, why) => `<tr tabindex="0" data-open="${e(o.id)}"><td class="mono">${e(o.number || "—")}</td><td><b>${e(o.customers?.name || "")}</b><div class="meta">${e(o.project || "")}</div></td>
      <td><span class="pill">${stageOf(o)}. ${e(STAGES[stageOf(o) - 1].n)}</span></td><td>${why}</td><td class="meta">${e(o.sales_rep || "—")}</td><td class="meta">${e(o.pm_name || "Unassigned")}</td></tr>`;
    const attention = [
      ...blocked.map((o) => row(o, `<span class="pill bad">Install blocked</span> <span class="meta">${o.customer_signoff ? "crew sign-off pending" : `site prep sheet ${progress(o).n}/${progress(o).total}`}</span>`)),
      ...stalled.filter((o) => !blocked.includes(o)).map((o) => row(o, `<span class="pill warn">${inStage(o)} days in stage</span>`)),
      ...act.filter((o) => o.crew_signoff && o.crew_signoff.exceptions && !blocked.includes(o) && !stalled.includes(o)).map((o) => row(o, `<span class="pill warn">${o.crew_signoff.exceptions} crew exception${o.crew_signoff.exceptions === 1 ? "" : "s"}</span> <span class="meta">noted on arrival</span>`)),
      ...noPm.filter((o) => !blocked.includes(o) && !stalled.includes(o)).map((o) => row(o, `<span class="pill">No PM assigned</span>`)),
    ];
    return `${topbar()}<div class="stack">
      <header class="row"><div><div class="eyebrow">ZPar admin portal</div><h1>Operations overview</h1></div><a class="btn go" href="#/new">+ Add project</a><span class="sp"></span>
        <div class="status"><span class="dot ${S.lastSync ? (S.lastSync.ok ? "live" : "off") : ""}"></span>${S.lastSync ? (S.lastSync.ok ? `QuickBooks synced ${fmtDT(S.lastSync.ran_at)}` : "QuickBooks sync failed") : "No QuickBooks sync yet"}</div></header>
      <section class="kpis kpis-5" aria-label="Summary">
        <div class="kpi"><small>Active orders</small><b>${act.length}</b><small>${money(val)} total</small></div>
        <div class="kpi"><small>Needs attention</small><b class="${attention.length ? "bad-ink" : ""}">${attention.length}</b><small>blocked, stalled or no PM</small></div>
        <div class="kpi"><small>Install blocked</small><b class="${blocked.length ? "bad-ink" : ""}">${blocked.length}</b><small>shipped, checklist not signed</small></div>
        <div class="kpi"><small>Waiting on customer</small><b>${waitCust.length}</b><small>drawings or site prep sheet</small></div>
        <div class="kpi"><small>Completed · 30 days</small><b>${completed30}</b></div>
      </section>
      <div class="card"><div class="row"><div class="eyebrow">Orders by stage</div><span class="sp"></span><span class="meta">count · value</span></div>
        <div class="stagechart">${byStage.map((x) => `<div class="sc-row"><span class="sc-lbl">${x.k}. ${e(x.n)}</span>
          <span class="sc-bar"><i style="width:${(x.c / maxC) * 100}%"></i></span><span class="sc-n mono">${x.c}</span><span class="sc-v mono">${x.c ? money(x.v) : ""}</span></div>`).join("")}</div></div>
      <div class="card"><div class="row"><div class="eyebrow">Needs attention</div><span class="sp"></span><span class="meta">Stalled = more than ${STALL_DAYS} days in the current stage</span></div>
        ${attention.length ? `<div class="tablebox flat"><table><thead><tr><th>Order</th><th>Customer / project</th><th>Stage</th><th>Issue</th><th>Sales rep</th><th>PM</th></tr></thead><tbody>${attention.join("")}</tbody></table></div>` : `<p class="meta" style="margin:10px 0 0">Nothing needs attention right now.</p>`}</div>
      <div class="two">
        <div class="card"><div class="eyebrow" style="margin-bottom:8px">Shipping & installs</div>
          ${upcoming.length ? `<ul class="events">${upcoming.map((o) => `<li><span class="mono">${e(o.crew_signoff?.install_dates || STAGES[stageOf(o) - 1].n)}</span><span><a href="#/order/${e(o.id)}"><b>${e(o.customers?.name || "")}</b></a> <span class="meta">${e(o.number || "")} · ${o.crew_signoff ? "cleared for install" : o.customer_signoff ? "crew sign-off pending" : "site prep sheet not signed"}</span></span></li>`).join("")}</ul>` : `<p class="meta" style="margin:0">No orders in testing, shipping or installation.</p>`}</div>
        <div class="card"><div class="eyebrow" style="margin-bottom:8px">By sales rep</div>
          ${(() => { const r = {}; act.forEach((o) => { const k = o.sales_rep || "Not set"; r[k] = r[k] || { n: 0, v: 0 }; r[k].n++; r[k].v += Number(o.amount) || 0; }); const ks = Object.entries(r).sort((a, b) => b[1].v - a[1].v);
            return ks.length ? `<ul class="events">${ks.map(([k, v]) => `<li><span style="min-width:150px"><b>${e(k)}</b></span><span>${v.n} order${v.n === 1 ? "" : "s"} · ${money(v.v)}</span></li>`).join("")}</ul>` : `<p class="meta" style="margin:0">No active orders.</p>`; })()}</div>
        <div class="card"><div class="eyebrow" style="margin-bottom:8px">PM workload</div>
          ${Object.keys(pms).length ? `<ul class="events">${Object.entries(pms).sort((a, b) => b[1].n - a[1].n).map(([k, v]) => `<li><span style="min-width:150px"><b>${e(k)}</b></span><span>${v.n} order${v.n === 1 ? "" : "s"} · ${money(v.v)}${v.att ? ` · <span class="bad-ink">${v.att} need attention</span>` : ""}</span></li>`).join("")}</ul>` : `<p class="meta" style="margin:0">No active orders.</p>`}</div>
      </div>
      <div class="card"><div class="eyebrow" style="margin-bottom:8px">Recent stage changes</div>
        ${(S.recent || []).length ? `<ul class="events">${S.recent.map((x) => `<li><span class="mono">${fmtDT(x.created_at)}</span><span><a href="#/order/${e(x.order_id)}"><b>${e(x.orders?.customers?.name || "")}</b></a> <span class="meta">${e(x.orders?.number || "")}</span> — ${x.from_stage ? `${e(STAGES[x.from_stage - 1]?.n)} → ` : ""}<b>${e(STAGES[x.to_stage - 1]?.n)}</b> <span class="meta">${e(x.actor_email || "system")}</span></span></li>`).join("")}</ul>` : `<p class="meta" style="margin:0">No stage changes yet.</p>`}</div>
    </div>`;
  }

  function teamView() {
    const me = S.session.user.email.toLowerCase();
    return `${topbar()}<div class="stack">
      <header><div class="eyebrow">ZPar staff</div><h1>Team</h1></header>
      <p class="meta" style="margin:0"><b>Managers</b> update order stages, checklists and photos. <b>Admins</b> also see the Admin overview and can add or remove team members. Everyone signs in at this portal with their work email.</p>
      <div class="card">${(S.team || []).map((t) => `<div class="contact"><span style="min-width:200px"><b>${e(t.name || t.email)}</b><div class="meta mono">${e(t.email)}</div></span>
          ${S.manager && t.email !== me ? `<select data-role="${e(t.email)}" aria-label="Role for ${e(t.email)}" style="width:auto"><option value="employee" ${t.role === "employee" ? "selected" : ""}>Manager</option><option value="manager" ${t.role === "manager" ? "selected" : ""}>Admin</option></select>
            <span class="sp"></span><button class="btn" type="button" data-act="rmstaff" data-email="${e(t.email)}">Remove</button>`
          : `<span class="pill ${t.role === "manager" ? "go" : ""}">${t.role === "manager" ? "Admin" : "Manager"}</span>${t.email === me ? `<span class="meta">you</span>` : ""}`}</div>`).join("")}
        ${S.manager ? `<form id="addStaff" class="row" style="margin-top:14px">
          <input name="email" type="email" required placeholder="name@zparint.com" style="flex:2 1 200px;width:auto" aria-label="Email">
          <input name="name" placeholder="Name" style="flex:1 1 140px;width:auto" aria-label="Name">
          <select name="role" style="width:auto" aria-label="Role"><option value="employee">Manager</option><option value="manager">Admin</option></select>
          <button class="btn go" type="submit">Add to team</button></form>` : ""}</div></div>`;
  }

  // ---------- data ----------
  async function loadAll() {
    const o = await sb.from("orders").select("*, customers(name)").order("order_date", { ascending: false });
    if (o.error) throw o.error;
    S.orders = o.data || [];
    if (S.manager) await loadFinancials();
    const it = await sb.from("checklist_items").select("*").eq("active", true).order("sec_order").order("sort");
    S.items = it.data || [];
    if (S.staff) {
      const [c, k, l] = await Promise.all([
        sb.from("customers").select("*").order("name"),
        sb.from("customer_contacts").select("*").order("email"),
        sb.from("qb_sync_log").select("*").order("ran_at", { ascending: false }).limit(1),
      ]);
      S.customers = c.data || []; S.contacts = k.data || []; S.lastSync = (l.data || [])[0] || null;
      const [t, rc] = await Promise.all([
        sb.from("staff").select("*").order("name"),
        sb.from("order_events").select("*, orders(number, customers(name))").order("created_at", { ascending: false }).limit(12),
      ]);
      S.team = t.data || []; S.recent = rc.data || [];
      const ci = await sb.from("crew_items").select("*").eq("active", true).order("sec_order").order("sort");
      CREW_ITEMS = (ci.data || []).map((i) => ({ key: i.key, sec: i.sec_order, section: i.section, text: i.text, allow_na: !!i.allow_na, fields: i.fields || [] }));
      CREW_SECTIONS = []; CREW_ITEMS.forEach((i) => { CREW_SECTIONS[i.sec - 1] = i.section; });
    }
  }
  async function loadOrderExtras(id) {
    const [n, ev] = await Promise.all([
      sb.from("order_internal").select("notes").eq("order_id", id).maybeSingle(),
      sb.from("order_events").select("*").eq("order_id", id).order("created_at", { ascending: false }).limit(50),
    ]);
    S.internal = { ...(S.internal || {}), [id]: n.data?.notes || "" };
    S.events = { ...(S.events || {}), [id]: ev.data || [] };
  }
  // Dollar amounts live in order_financials, which only Admins can read.
  async function loadFinancials() {
    const f = await sb.from("order_financials").select("order_id, amount, line_amounts");
    S.fin = new Map((f.data || []).map((x) => [x.order_id, x.amount]));
    S.lineAmts = new Map((f.data || []).map((x) => [x.order_id, x.line_amounts || []]));
    S.orders.forEach(mergeFin);
  }
  // Line-item dollar amounts are also kept in order_financials (Admins only); merge them back for display.
  function mergeFin(o) {
    if (S.fin && S.fin.has(o.id)) o.amount = S.fin.get(o.id);
    const la = S.lineAmts && S.lineAmts.get(o.id);
    if (la && Array.isArray(o.lines)) o.lines.forEach((l, i) => { if (la[i] != null) l.amt = la[i]; });
  }
  async function refreshOrder(id) {
    const r = await sb.from("orders").select("*, customers(name)").eq("id", id).maybeSingle();
    if (r.data) { mergeFin(r.data); S.orders = S.orders.map((x) => (x.id === id ? r.data : x)); }
    if (S.staff) { await loadOrderExtras(id); const rc = await sb.from("order_events").select("*, orders(number, customers(name))").order("created_at", { ascending: false }).limit(12); S.recent = rc.data || S.recent; }
    render();
  }

  // ---------- render ----------
  let loadedExtrasFor = null, loadingPhotos = null;
  function render() {
    if (!S.session) { app.innerHTML = loginView(S.sent); return; }
    const r = route();
    const active = document.activeElement, fid = active && active.id, pos = active && active.selectionStart;
    const po = S.staff ? (r.page === "order" ? S.orders.find((x) => x.id === r.id) : null) : currentCustomerOrder();
    if (po && S.photos[po.id] === undefined && loadingPhotos !== po.id) { loadingPhotos = po.id; loadPhotos(po.id).then(() => { loadingPhotos = null; render(); }); }
    if (!S.staff) app.innerHTML = customerHome();
    else if (r.page === "customers") app.innerHTML = staffCustomers();
    else if (r.page === "team") app.innerHTML = teamView();
    else if (r.page === "new" && S.manager) app.innerHTML = newProjectView();
    else if (r.page === "manager" && S.manager) app.innerHTML = managerView();
    else if (r.page === "order") {
      const o = S.orders.find((x) => x.id === r.id);
      if (!o) app.innerHTML = `${topbar()}<div class="card empty">Order not found.</div>`;
      else {
        if (loadedExtrasFor !== o.id) { loadedExtrasFor = o.id; loadOrderExtras(o.id).then(render); }
        app.innerHTML = staffOrder(o);
      }
    } else app.innerHTML = staffOrders();
    if (fid && document.getElementById(fid)) { const el = document.getElementById(fid); el.focus(); try { if (pos != null) el.setSelectionRange(pos, pos); } catch (_) {} }
  }

  // ---------- events ----------
  document.addEventListener("submit", async (ev) => {
    const f = ev.target;
    if (f.id === "loginForm") {
      ev.preventDefault();
      const email = document.getElementById("lg_email").value.trim().toLowerCase();
      const btn = f.querySelector("button"); btn.disabled = true;
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
      btn.disabled = false;
      if (error) { document.getElementById("lgErr").textContent = errMsg(error); return; }
      S.sent = email; render(); return;
    }
    if (f.id === "det") {
      ev.preventDefault();
      const id = route().id, fd = new FormData(f);
      const upd = { pm_name: fd.get("pm_name").trim() || null, pm_email: fd.get("pm_email").trim() || null, site_address: fd.get("site_address").trim() || null, install_date: fd.get("install_date").trim() || null };
      const [a, b] = await Promise.all([
        sb.from("orders").update(upd).eq("id", id),
        sb.from("order_internal").upsert({ order_id: id, notes: fd.get("notes"), updated_at: new Date().toISOString() }),
      ]);
      if (a.error || b.error) toast(errMsg(a.error || b.error)); else { toast("Saved"); refreshOrder(id); }
      return;
    }
    if (f.id === "newProj") {
      ev.preventDefault();
      if (!S.manager) { toast("Only admins can add projects."); return; }
      const fd = new FormData(f), v = (k) => String(fd.get(k) || "").trim(), err = document.getElementById("npErr");
      const btn = f.querySelector("button[type=submit]"); btn.disabled = true; err.textContent = "";
      const name = v("customer");
      let cust = S.customers.find((c) => c.name.toLowerCase() === name.toLowerCase());
      if (!cust) {
        const c = await sb.from("customers").insert({ name }).select("*");
        if (c.error) { err.textContent = errMsg(c.error); btn.disabled = false; return; }
        cust = c.data[0];
      }
      const amt = v("amount");
      const row = { customer_id: cust.id, number: v("number"), project: v("project"), order_date: v("order_date"), stage: Number(v("stage")) || 1,
        amount: amt === "" ? null : Number(amt), pm_name: v("pm_name") || null, pm_email: v("pm_email") || null, site_address: v("site_address") || null,
        install_date: v("install_date") || null, sales_rep: v("sales_rep") || null, products_note: v("products_note") || null, source: "manual", created_by: S.session.user.email };
      const o = await sb.from("orders").insert(row).select("*");
      if (o.error) { err.textContent = errMsg(o.error); btn.disabled = false; return; }
      const em = v("email").toLowerCase();
      if (em && !S.contacts.some((k) => k.email === em)) await sb.from("customer_contacts").insert({ customer_id: cust.id, email: em, name: null });
      await loadAll(); toast(`${row.number} added.`); location.hash = "#/order/" + o.data[0].id; return;
    }
    if (f.id === "addStaff") {
      ev.preventDefault();
      const fd = new FormData(f);
      const row = { email: String(fd.get("email")).trim().toLowerCase(), name: String(fd.get("name")).trim() || null, role: fd.get("role") };
      const { error } = await sb.from("staff").insert(row);
      if (error) { toast(error.code === "23505" ? "That person is already on the team." : errMsg(error)); return; }
      toast(`${row.name || row.email} added. They can sign in with that email.`); await loadAll(); render(); return;
    }
    if (f.classList.contains("addcontact")) {
      ev.preventDefault();
      const fd = new FormData(f);
      const row = { customer_id: f.dataset.cust, email: String(fd.get("email")).trim().toLowerCase(), name: String(fd.get("name")).trim() || null };
      const { error } = await sb.from("customer_contacts").insert(row);
      if (error) { toast(error.code === "23505" ? "That email already has a login." : errMsg(error)); return; }
      toast("Login added. They can sign in with that email."); await loadAll(); render();
    }
  });

  document.addEventListener("click", async (ev) => {
    const a = ev.target.closest("[data-act]");
    const tr = ev.target.closest("tr[data-open]");
    if (tr) { location.hash = "#/order/" + tr.dataset.open; return; }
    const cwb = ev.target.closest("button[data-cwv]");
    if (cwb && S.staff) {
      const o = S.orders.find((x) => x.id === route().id); if (!o || o.crew_signoff) return;
      const d = crewDraft(o), key = cwb.dataset.cw, v = cwb.dataset.cwv;
      if (d.checklist[key] === v) delete d.checklist[key]; else d.checklist[key] = v;
      render(); queueCrewSave(o, 300); return;
    }
    if (!a) return;
    const act = a.dataset.act, id = route().id || (S.orders.length === 1 ? S.orders[0].id : null);
    if (act === "signout") { await sb.auth.signOut(); return; }
    if (act === "relogin") { S.sent = null; render(); return; }
    const o = S.orders.find((x) => x.id === id);
    if ((act === "adv" || act === "back") && o) {
      const to = stageOf(o) + (act === "adv" ? 1 : -1);
      a.disabled = true;
      const { error } = await sb.from("orders").update({ stage: to }).eq("id", o.id);
      if (error) { toast(errMsg(error)); a.disabled = false; return; }
      toast("Moved to " + STAGES[to - 1].n); refreshOrder(o.id); return;
    }
    if (act === "sign" && o) {
      const name = document.getElementById("sg_name").value.trim();
      if (name.length < 2) { toast("Enter your full name to sign."); document.getElementById("sg_name").focus(); return; }
      a.disabled = true; clearTimeout(saveTimer);
      const d = draftOf(o);
      let r = await sb.rpc("save_site_checklist", { p_order: o.id, p_checklist: d.checklist, p_fields: d.fields, p_notes: d.notes });
      if (!r.error) r = await sb.rpc("sign_site_checklist", { p_order: o.id, p_name: name, p_title: document.getElementById("sg_title").value.trim() });
      if (r.error) { toast(errMsg(r.error)); a.disabled = false; return; }
      delete S.draft[o.id]; toast("Checklist signed. Thank you."); refreshOrder(o.id); return;
    }
    if (act === "crewsign" && o) {
      a.disabled = true; clearTimeout(crewTimer);
      const d = crewDraft(o);
      let r = await sb.rpc("save_crew_checklist", { p_order: o.id, p_checklist: d.checklist, p_fields: d.fields, p_notes: d.notes, p_header: d.header });
      if (!r.error) r = await sb.rpc("crew_signoff_checklist", { p_order: o.id, p_crew_lead: d.header.lead.trim(), p_crew_present: d.header.crew.trim(), p_install_dates: d.header.dates.trim(), p_customer_rep: d.header.rep.trim() });
      const error = r.error;
      if (error) { toast(errMsg(error)); a.disabled = false; return; }
      delete S.cdraft[o.id];
      toast("Crew sign-off recorded. Install is unlocked."); refreshOrder(o.id); return;
    }
    if (act === "fillfor" && o) {
      if (!S.manager) { toast("Only admins can fill out the site prep sheet for a customer."); return; }
      S.fillFor = S.fillFor || {}; S.fillFor[o.id] = !S.fillFor[o.id];
      if (!S.fillFor[o.id]) toast("Saved. The customer can review and sign on their portal.");
      render(); return;
    }
    if (act === "crewtoggle" && o) {
      S.crewCollapsed = S.crewCollapsed || {};
      const was = S.crewCollapsed[o.id] ?? !!o.crew_signoff;
      S.crewCollapsed[o.id] = !was; render();
      const c = document.getElementById("crew"); if (c && was === false) c.scrollIntoView({ block: "nearest" });
      return;
    }
    if (act === "crewreopen" && o) {
      if (!a.dataset.armed) { a.dataset.armed = "1"; a.textContent = "Confirm reopen (clears crew signature)"; a.style.color = "var(--bad)"; return; }
      if (stageOf(o) >= 9) { toast("Move the order back to Shipped before reopening the crew checklist."); return; }
      const { error } = await sb.from("orders").update({ crew_signoff: null }).eq("id", o.id);
      if (error) { toast(errMsg(error)); return; }
      if (S.cdraft) delete S.cdraft[o.id]; toast("Crew checklist reopened."); refreshOrder(o.id); return;
    }
    if (act === "reopen" && o) {
      if (!a.dataset.armed) { a.dataset.armed = "1"; a.textContent = "Confirm reopen (clears both signatures)"; a.style.color = "var(--bad)"; return; }
      const { error } = await sb.from("orders").update({ customer_signoff: null, crew_signoff: null }).eq("id", o.id);
      if (error) { toast(errMsg(error)); return; }
      toast("Checklist reopened for the customer."); refreshOrder(o.id); return;
    }
    if (act === "rmphoto") {
      if (!a.dataset.armed) { a.dataset.armed = "1"; a.textContent = "Confirm remove"; a.style.color = "var(--bad)"; return; }
      const o2 = S.staff ? S.orders.find((x) => x.id === route().id) : currentCustomerOrder();
      const p = o2 && (S.photos[o2.id] || []).find((x) => x.id === a.dataset.id);
      if (!p) return;
      const del = await sb.from("checklist_photos").delete().eq("id", p.id).select("id");
      if (del.error || !(del.data || []).length) { toast(del.error ? errMsg(del.error) : "This photo can no longer be removed."); return; }
      await sb.storage.from(BUCKET).remove([p.path]);
      await loadPhotos(o2.id); render(); toast("Photo removed"); return;
    }
    if (act === "rmstaff") {
      if (!a.dataset.armed) { a.dataset.armed = "1"; a.textContent = "Confirm remove"; a.style.color = "var(--bad)"; return; }
      const { data, error } = await sb.from("staff").delete().eq("email", a.dataset.email).select("email");
      if (error || !(data || []).length) { toast(error ? errMsg(error) : "Only admins can remove team members."); return; }
      toast("Removed from team"); await loadAll(); render(); return;
    }
    if (act === "rmcontact") {
      if (!a.dataset.armed) { a.dataset.armed = "1"; a.textContent = "Confirm remove"; a.style.color = "var(--bad)"; return; }
      const { error } = await sb.from("customer_contacts").delete().eq("id", a.dataset.id);
      if (error) toast(errMsg(error)); else { toast("Login removed"); await loadAll(); render(); }
    }
  });

  document.addEventListener("change", async (ev) => {
    const k = ev.target.dataset && ev.target.dataset.ck;
    if (ev.target.dataset && ev.target.dataset.role) {
      const { data, error } = await sb.from("staff").update({ role: ev.target.value }).eq("email", ev.target.dataset.role).select("email");
      if (error || !(data || []).length) { toast(error ? errMsg(error) : "Only admins can change roles."); await loadAll(); render(); return; }
      toast("Role updated"); await loadAll(); render(); return;
    }
    if (ev.target.id === "ph_file") {
      const files = ev.target.files, o2 = S.staff ? S.orders.find((x) => x.id === route().id) : currentCustomerOrder();
      if (files && files.length && o2) uploadPhotos(o2, files, document.getElementById("ph_item").value);
      return;
    }
    const na = ev.target.dataset && ev.target.dataset.na;
    if ((k || na) && (!S.staff || adminFilling(S.orders.find((x) => x.id === route().id)))) {
      const o = S.staff ? S.orders.find((x) => x.id === route().id) : currentCustomerOrder(); if (!o) return;
      const d = draftOf(o), key = k || na;
      if (k) { if (ev.target.checked) d.checklist[key] = "yes"; else delete d.checklist[key]; }
      else { if (ev.target.checked) d.checklist[key] = "na"; else delete d.checklist[key]; }
      render(); queueSave(o, 300); return;
    }
    if (ev.target.id === "show") { S.show = ev.target.value; render(); }
  });
  function currentCustomerOrder() { const r = route(); return r.page === "order" ? S.orders.find((x) => x.id === r.id) : S.orders.length === 1 ? S.orders[0] : null; }
  document.addEventListener("input", (ev) => {
    if (ev.target.id === "q") { S.q = ev.target.value; render(); return; }
    const ds = ev.target.dataset || {};
    if ((ds.cwfld || ds.cwnotes || ds.cwh) && S.staff) {
      const o = S.orders.find((x) => x.id === route().id); if (!o || o.crew_signoff) return;
      const d = crewDraft(o);
      if (ds.cwfld) d.fields[ds.cwfld] = ev.target.value; else if (ds.cwnotes) d.notes = ev.target.value; else d.header[ds.cwh] = ev.target.value;
      refreshCrewUI(o); queueCrewSave(o, 900); return;
    }
    const fld = ev.target.dataset && ev.target.dataset.fld, notes = ev.target.dataset && ev.target.dataset.notes;
    if ((fld || notes) && (!S.staff || adminFilling(S.orders.find((x) => x.id === route().id)))) {
      const o = S.staff ? S.orders.find((x) => x.id === route().id) : currentCustomerOrder(); if (!o) return;
      const d = draftOf(o);
      if (fld) d.fields[fld] = ev.target.value; else d.notes = ev.target.value;
      if (fld) { const row = ev.target.closest(".cl-item"), item = S.items.find((i) => (i.fields || []).some((f) => f.key === fld)); if (row && item) row.classList.toggle("on", itemDone(item, d)); }
      refreshProgressUI(o); queueSave(o, 900);
    }
  });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && ev.target.matches && ev.target.matches("tr[data-open]")) location.hash = "#/order/" + ev.target.dataset.open; });

  // ---------- boot ----------
  async function boot(session) {
    S.session = session;
    if (!session) { S.orders = []; S.staff = false; render(); return; }
    app.innerHTML = `<div class="card empty">Loading your projects…</div>`;
    try {
      const { data } = await sb.rpc("is_staff");
      S.staff = data === true; S.manager = false;
      if (S.staff) { const m = await sb.rpc("is_manager"); S.manager = m.data === true; }
      if (S.manager && !location.hash) history.replaceState(null, "", "#/manager");
      await loadAll();
    } catch (err) { app.innerHTML = `<div class="card login"><p class="err">${e(errMsg(err))}</p><button class="btn" data-act="signout" type="button">Sign out</button></div>`; return; }
    render();
  }
  let lastUser;
  sb.auth.onAuthStateChange((_evt, session) => {
    const uid = session?.user?.id || null;
    if (uid === lastUser && S.session) { S.session = session; return; }
    lastUser = uid; setTimeout(() => boot(session), 0);
  });
})();
