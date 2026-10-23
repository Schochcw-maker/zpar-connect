/* Zpar Connect — free quote reader (no AI, no API cost)
   Reads GFS and RTT supplier quotes with fixed rules and returns the same shape the
   Claude reader returns. Everything it produces is a starting point for the admin to review. */
(function () {
  "use strict";

  const DFW = [32.8998, -97.0403];
  const ROAD_FACTOR = 1.18; // straight-line → typical highway miles

  const n = (s) => { const m = String(s || "").match(/(\d+(?:\.\d+)?)/); return m ? Number(m[1]) : 0; };
  const paren = (s) => { const all = [...String(s || "").matchAll(/\((\d+)\)/g)].map((m) => Number(m[1])); return all.length ? all.reduce((a, b) => a + b, 0) : 0; };
  const feet = (s) => { const m = String(s || "").match(/(\d+)\s*'\s*(?:(\d+)\s*(?:''|"|”))?/); return m ? Number(m[1]) + (Number(m[2]) || 0) / 12 : 0; };
  function dims(s) { // "15' 0'' W x 16' 0'' H x 30' 0'' L" or "20' 0" wide X 18' 0" tall X 3' 0" long"
    const parts = String(s || "").split(/\s[xX]\s/).map((p) => ({ v: feet(p), k: /\bW|wide/i.test(p) ? "w" : /\bH\b|tall/i.test(p) ? "h" : /\bL\b|long|deep/i.test(p) ? "l" : "" }));
    const d = { w: 0, h: 0, l: 0 }; parts.forEach((p, i) => { d[p.k || "whl"[i]] = p.v; }); return d;
  }
  const fmtDims = (d) => (d.w ? `${Math.round(d.w)}'W x ${Math.round(d.h)}'H x ${Math.round(d.l)}'L` : "");
  const half = (x) => Math.ceil(x * 2) / 2;

  // ---------- day rules (per unit) ----------
  function unitDays(u) {
    const why = [];
    let base;
    if (u.kind === "chamber" || u.kind === "openface") { const face = u.w * u.h; base = face > 200 ? 2 : 1.5; why.push(`${u.label}: open-face/exhaust chamber (${Math.round(face)} sq ft face) ${base}d`); }
    else if (u.kind === "prep" || u.kind === "mixroom") { base = 2; why.push(`${u.label}: prep station / mixing room 2d`); }
    else if (u.kind === "oven") { const fl = u.w * u.l; base = fl <= 100 ? 3 : fl <= 300 ? 4 : 5; why.push(`${u.label}: oven (${Math.round(fl)} sq ft) ${base}d`); }
    else { const fl = u.w * u.l; base = !fl ? 4 : fl <= 400 ? 3.5 : fl <= 600 ? 5 : 5 + Math.ceil((fl - 600) / 150) * 0.5; why.push(`${u.label}: enclosed booth (${Math.round(fl)} sq ft floor) ${base}d`); }
    let d = base;
    if (u.ibeam) { d += 1; why.push("I-beam structure +1d"); }
    if (u.pit) { d += 1; why.push("downdraft pit/basement +1d"); }
    if (u.insulated) { d += 1; why.push("double-skin insulated panels +1d"); }
    if (u.supply) { d += u.supply; why.push(`supply chamber +${u.supply}d`); }
    if (u.amu) { d += 2 * u.amu; why.push(`${u.amu} AMU set + duct through roof +${2 * u.amu}d`); }
    if (u.stacks) { d += u.stacks; why.push(`${u.stacks} exhaust stack(s) through roof +${u.stacks}d`); }
    if (u.roof > 30 && (u.stacks || u.amu)) { d += 1; why.push(`roof ${Math.round(u.roof)}' (over 30') +1d`); }
    if (u.recirc) { d += 0.5 * u.recirc; why.push(`${u.recirc} recirc fan/duct +${0.5 * u.recirc}d`); }
    if (u.doors) { d += 0.5 * u.doors; why.push(`${u.doors} bi-fold/tri-fold door(s) +${0.5 * u.doors}d`); }
    let w = { chamber: 1, openface: 1, prep: 1.5, mixroom: 1.5, oven: 3 }[u.kind] ?? 2;
    w += 1.5 * (u.amu || 0) + 0.5 * ((u.fans || 0) + (u.recirc || 0)) + (u.lel ? 1 : 0) + (u.autobalance ? 0.5 : 0) + (u.doorSwitches ? 0.5 : 0) + ((u.lights || 0) > 24 ? 0.5 : 0);
    return { install: half(d), wiring: half(w), why: why.join(", ") };
  }

  // ---------- GFS ----------
  function parseGFS(text) {
    const lines = text.split("\n");
    const starts = lines.map((l, i) => (/^Equipment Operation Type:/i.test(l) ? i : -1)).filter((i) => i >= 0);
    if (!starts.length) starts.push(0);
    const segs = starts.map((s, k) => lines.slice(s, starts[k + 1] ?? lines.length));
    const kvAll = (ls) => ls.map((l) => l.match(/^([^|]{3,90}?):\s*\|\s*(.+)$/)).filter(Boolean).map((m) => [m[1].trim(), m[2].trim()]);
    const globalKV = kvAll(lines);
    const g = (kv, re) => { const hit = kv.find(([k]) => re.test(k)); return hit ? hit[1] : ""; };
    const counts = { lights: 0, amu: 0, rollup_doors: 0, solenoid: 0, door_switches: 0, dust_collector: 0, panels: 0, exhaust_fans: 0, recirc_fans: 0, probes: 0, air_seals: 0 };
    const scope = [], flags = [], reasoning = [];
    let inst = 0, wir = 0, small = true;
    const roof = feet(g(globalKV, /^Roof Height/i));
    segs.forEach((seg, idx) => {
      const kv = kvAll(seg);
      const type = g(kv, /Equipment Operation Type/i), model = g(kv, /Model Number/i), d = dims(g(kv, /Clear Internal Working Dimensions/i));
      const kind = /oven/i.test(type) ? "oven" : /open\s*face|bench/i.test(type) ? "openface" : /prep/i.test(type) ? "prep" : /mix/i.test(type) ? "mixroom" : /exhaust chamber/i.test(type) ? "chamber" : "enclosed";
      const lights = n(g(kv, /Included Light Quantity/i));
      const fanTxt = g(kv, /Exhaust Fan Framework/i); const fans = fanTxt ? (paren(fanTxt) || 1) : 0;
      const amuTxt = g(kv, /Pressurization Provided Through/i); let amu = /AMU/i.test(amuTxt) ? (paren(amuTxt) || 1) : 0;
      if (!amu && g(kv, /Air Make-?up Unit Type/i)) amu = 1;
      const productDoors = kv.filter(([k, v]) => /Product Door Access/i.test(k) && !/none|not provided|solid back|open/i.test(v)).length;
      const personnel = paren(g(kv, /Personnel Door Access/i));
      const switches = /included/i.test(g(kv, /Door Limit Switches/i)) ? productDoors + personnel : 0;
      const solenoid = (() => { const v = g(kv, /Solenoid Valve/i); return v && !/not|none/i.test(v) ? 1 : 0; })();
      const panel = (() => { const v = g(kv, /Electrical Controls Operation/i); return v && !/not provided|none|by others/i.test(v) ? 1 : 0; })();
      const autobalance = /auto\s*-?balance/i.test(g(kv, /Pressure Control System/i)) ? 1 : 0;
      const exRoof = /roof/i.test(g(kv, /Exhaust Duct Building Penetration/i)), amuRoof = /roof/i.test(g(kv, /AMU Duct Building Penetration/i));
      const stacks = exRoof ? fans : 0;
      Object.assign(counts, { lights: counts.lights + lights, amu: counts.amu + amu, exhaust_fans: counts.exhaust_fans + fans, door_switches: counts.door_switches + switches,
        solenoid: counts.solenoid + solenoid, panels: counts.panels + panel, probes: counts.probes + autobalance });
      const label = `Item ${String.fromCharCode(65 + idx)}`;
      const u = unitDays({ label, kind, ...d, ibeam: /I-?Beam/i.test(g(kv, /Support Structure/i)), pit: /down\s*draft|pit|basement/i.test(type) && /pit|basement/i.test(seg.join(" ")),
        amu: amuRoof || amu ? amu : 0, stacks, roof, fans, autobalance, doorSwitches: switches, lights });
      inst += u.install; wir += u.wiring; reasoning.push(`${u.why} = ${u.install} install days; wiring ${u.wiring}d`);
      if (kind !== "openface" && kind !== "prep") small = false;
      scope.push(`${label}: GFS ${model || type}${type ? ` — ${type}` : ""}${fmtDims(d) ? `, ${fmtDims(d)} clear` : ""}`);
      if (lights || fans) scope.push(`${label}: ${lights} lights; ${fans} exhaust fan(s)${fanTxt ? ` (${fanTxt.replace(/^\(\d+\)\s*/, "")})` : ""}`);
      if (amu) scope.push(`${label}: ${amu} AMU ${g(kv, /Air Make-?up Unit Type/i)} ${g(kv, /MBTU/i)}`.trim());
      if (productDoors || personnel) scope.push(`${label}: ${productDoors} product door opening(s), ${personnel} personnel door(s)${switches ? `, ${switches} limit switches` : ""}`);
      const wt = n(g(kv, /Unit Weight/i)); if (wt >= 2000) flags.push(`${label}: AMU about ${wt.toLocaleString()} lb${/equipment mounted/i.test(g(kv, /Unit Stand/i)) ? ", mounted on the booth" : ""} — lift/crane needed (not in calculator)`);
    });
    const loc = g(globalKV, /Installation Site Location/i);
    const zip = (loc.match(/\b(\d{5})\b/) || [])[1] || "";
    if (/seismic/i.test(loc)) flags.push(`Site note from GFS: ${loc}`);
    if (/included/i.test(g(globalKV, /Provided Start-?Up/i))) flags.push("GFS start-up is included in the equipment price — remove the ZPar AMU startup trip if our crew isn't needed");
    if (/supports? not provided/i.test(text)) flags.push("GFS does not supply duct supports" + (/anchor bolts are not provided/i.test(text) ? " or anchor bolts" : "") + " — confirm who furnishes");
    if (roof) flags.push(`Roof ${Math.round(roof)}' above floor — confirm lift for stack/roof work`);
    if (segs.length > 1) flags.push(`${segs.length} equipment items found — confirm each item's quantity`);
    flags.push("Read with the free rule-based reader: check every count and day estimate");
    return { vendor: "GFS", counts, scope, flags, reasoning, zip, siteText: loc, install: inst, wiring: wir, helper: small ? 0 : 1,
      project: segs.length === 1 ? `(1) ${scope[0].replace(/^Item A: /, "")}` : `${segs.length} GFS items`, roof };
  }

  // ---------- RTT ----------
  // RTT quotes can hold several equipment sections, each starting with "RTT is pleased to offer..."
  // and each with its own line-item table, total, quantity ("Total x2" / "-(3) Booth Required") and upgrades.
  function parseRTT(text) {
    const all = text.split("\n");
    const starts = all.map((l, i) => (/RTT is pleased to offer/i.test(l) ? i : -1)).filter((i) => i >= 0);
    if (!starts.length) starts.push(0);
    const counts = { lights: 0, amu: 0, rollup_doors: 0, solenoid: 0, door_switches: 0, dust_collector: 0, panels: 0, exhaust_fans: 0, recirc_fans: 0, probes: 0, air_seals: 0 };
    const scope = [], flags = [], reasoning = [], names = [];
    let inst = 0, wir = 0, amuStartup = 0, helper = 0, roofAny = 0;
    const sumN = (re, s) => [...String(s).matchAll(re)].reduce((a, m) => a + Number(m[1]), 0);
    starts.forEach((st, k) => {
      const from = k === 0 ? 0 : st - 1, to = k + 1 < starts.length ? starts[k + 1] - 1 : all.length;
      const lines = all.slice(Math.max(0, from), to), narr = lines.join("\n");
      let title = ""; for (let i = st - 1; i >= Math.max(0, st - 3); i--) if (all[i] && all[i].trim()) { title = all[i].trim(); break; }
      const totalAt = lines.findIndex((l) => /^\s*(Sub-?\s*Total|Total)\b[^\n]*\|/i.test(l));
      const rows = [];
      lines.forEach((l, i) => { const m = l.match(/^\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/); if (m) rows.push({ qty: Number(m[1]), part: m[2].trim(), desc: m[3].trim(), base: totalAt < 0 || i < totalAt }); });
      const mm = narr.match(/Total\s*x\s*(\d+)/i) || narr.match(/-?\s*\((\d+)\)\s*Booths?\s+Required/i);
      const mult = mm ? Number(mm[1]) : 1;
      const perBoothUpg = /Equipment Upgrades:\s*\(Per Booth\)/i.test(narr);
      const q = (r) => r.qty * (r.base || perBoothUpg ? 1 : 1); // quantity as listed
      const sum = (re, onlyBase) => rows.filter((r) => (!onlyBase || r.base) && re.test(r.part + " " + r.desc)).reduce((a, r) => a + q(r), 0);
      const sumUp = (re) => rows.filter((r) => !r.base && re.test(r.part + " " + r.desc)).reduce((a, r) => a + r.qty, 0);
      const boothRow = rows.find((r) => r.base && /booth|chamber|mix room|mixing room|prep station|oven|shell|sanding|grinding/i.test(r.desc) && !/supply chamber|upgrade/i.test(r.part + " " + r.desc)) || rows[0] || { part: title, desc: title };
      const label = (boothRow.part || "").replace(/\s+/g, " ");
      const kindSrc = title + " " + boothRow.desc;
      const kind = /oven/i.test(kindSrc) ? "oven" : /exhaust chamber/i.test(kindSrc) ? "chamber" : /mix(ing)? room/i.test(kindSrc) ? "mixroom" : /prep/i.test(kindSrc) ? "prep" : "enclosed";
      const d = dims((narr.match(/Interior working dimensions of:\s*([^.]+?long)/i) || [])[1]);
      const lightSentence = (narr.match(/A total of[^\n]*?light fixtures/i) || [""])[0];
      const lights = sumN(/\((\d+)\)/g, lightSentence) || sum(/light fixture|LED fixture/i, true);
      const fans = sumN(/\((\d+)\)[^\n(]{0,60}?exhaust fan/gi, narr) || sum(/exhaust fan|fan kit/i, true);
      const recirc = sumN(/\((\d+)\)[^\n(]{0,60}?recirc(?:ulation)? fan/gi, narr);
      const personnel = sumN(/\((\d+)\)\s*-\s*Personnel Access Door/gi, narr);
      const isAmu = (r) => /\bAMU|make-?up|dump unit|^CTC?-\d/i.test(r.part + " " + r.desc) && !/duct|start\s*-?\s*up|mixing box|recirc|upgrade/i.test(r.part + " " + r.desc);
      const amu = rows.filter((r) => r.base && isAmu(r)).reduce((a, r) => a + r.qty, 0);
      const rttStartup = rows.some((r) => /start\s*-?\s*up/i.test(r.part + " " + r.desc) && /\$\s*[1-9]/.test(lines.find((l) => l.includes(r.part)) || ""));
      const upgMult = perBoothUpg ? 1 : 1 / mult; // upgrade lines not marked "per booth" are for the whole section
      const switchesBase = sum(/limit switch/i, true), switchesUp = sumUp(/limit switch/i);
      const switches = switchesBase + switchesUp * upgMult;
      const solenoid = sumUp(/solenoid/i) * upgMult + sum(/solenoid/i, true);
      const panelRows = rows.filter((r) => /control panel/i.test(r.part + " " + r.desc) && !/upgrade/i.test(r.part)).reduce((a, r) => a + r.qty, 0);
      const lel = rows.filter((r) => /\bLEL\b/i.test(r.part + " " + r.desc) && !/upgrade/i.test(r.part)).reduce((a, r) => a + r.qty, 0);
      const autobalance = /pressure balancing|auto(matic)?\s*-?\s*balanc/i.test(narr) ? 1 : 0;
      const proving = /filter proving switch/i.test(narr) ? 1 : 0;
      let panels = panelRows + amu;
      const assumedPanel = !panelRows && !amu && fans > 0;
      if (assumedPanel) panels = 1;
      const stacks = sum(/automatic roof vent|^ARV/i, true) || sum(/roof flange/i, true);
      const doors = rows.filter((r) => /bi-?\s*fold|tri-?\s*fold/i.test(r.part + " " + r.desc)).reduce((a, r) => a + r.qty, 0) * (perBoothUpg ? 1 : 1 / mult);
      const insulated = rows.some((r) => /double skin|insulated/i.test(r.desc) && /booth|panel|skin/i.test(r.desc)) ? 1 : 0;
      const roof = n((narr.match(/typical\s+(\d+)\s*'/i) || [])[1]);
      if (roof) roofAny = Math.max(roofAny, roof);
      const supply = sum(/supply chamber|^ISC/i, true);
      const u = unitDays({ label, kind, ...d, amu, stacks, supply, roof, fans, recirc, insulated, doors, lel, autobalance, doorSwitches: switches, lights });
      inst += u.install * mult; wir += u.wiring * mult;
      reasoning.push(`${u.why} = ${u.install} install days; wiring ${u.wiring}d${mult > 1 ? ` (x${mult} = ${u.install * mult} / ${u.wiring * mult})` : ""}`);
      const per = (x) => x * mult;
      counts.lights += per(lights); counts.amu += per(amu); counts.exhaust_fans += per(fans); counts.recirc_fans += per(recirc);
      counts.door_switches += Math.round(per(switches)); counts.solenoid += Math.round(per(solenoid)); counts.panels += per(panels); counts.probes += per(lel + autobalance + proving);
      if (kind !== "prep" && kind !== "mixroom") helper = 1;
      amuStartup += rttStartup ? 0 : per(amu);
      const dimTxt = fmtDims(d);
      names.push(`${mult > 1 ? `(${mult}) ` : ""}${label}`);
      scope.push(`${mult > 1 ? `(${mult}) ` : ""}RTT ${label} — ${title || boothRow.desc}${dimTxt ? `, ${dimTxt}` : ""}: ${[lights && `${lights} lights`, fans && `${fans} exhaust fan(s)`, recirc && `${recirc} recirc fan(s)`, amu && `${amu} AMU`, personnel && `${personnel} personnel door(s)`, switches && `${Math.round(switches)} limit switches`, panels && `${panels} panel(s)`, lel && "LEL sensors", stacks && `${stacks} roof stack(s)`, doors && `${doors} folding door(s)`].filter(Boolean).join(", ")}${mult > 1 ? " — each" : ""}`);
      if (rttStartup) flags.push(`${label}: RTT start-up is in the equipment price — no ZPar AMU startup trip budgeted for it`);
      else if (amu) flags.push(`${label}: AMU start-up not in RTT's price — ZPar AMU startup trip budgeted`);
      if (assumedPanel) flags.push(`${label}: no control panel line — assumed 1 panel`);
      if (!switches && kind === "enclosed" && personnel) flags.push(`${label}: no limit switches listed — check doors`);
      if (/dust collectors? by others/i.test(narr)) flags.push(`${label}: dust collectors by others — not wired or installed by ZPar unless added`);
      if (/sharing common walls|share a common wall/i.test(narr)) flags.push(`${label}: shares common walls with other booths — install may go faster than estimated`);
      if (lel) flags.push(`${label}: LEL sensor system with its own control panel — counted as a panel and a probe`);
      if (/climate controlled|cooling|chilled|\bCW\b/i.test(narr)) flags.push(`${label}: climate-controlled AMU (cooling) — confirm who handles refrigeration/chilled-water piping`);
      if (mult > 1 && !perBoothUpg && rows.some((r) => !r.base)) flags.push(`${label}: upgrade lines aren't marked "per booth" — treated as for all ${mult} units; verify`);
    });
    if (/duct support by others/i.test(text)) flags.push("Duct supports by others (RTT)");
    if (/cutting, sealing, or framing of roof/i.test(text)) flags.push("Roof cutting/sealing/framing excluded by RTT — confirm who does it");
    if (/seismic/i.test(text)) flags.push("RTT equipment not designed for seismic/wind loads unless noted");
    if (roofAny) flags.push(`Duct quoted for a ~${roofAny}' roof — confirm actual roof height and lift`);
    flags.push("RTT quotes don't state the job site — enter it to calculate miles");
    if (starts.length > 1) flags.push(`${starts.length} equipment sections found in this quote — check each one`);
    flags.push("Read with the free rule-based reader: check every count and day estimate");
    if (starts.length > 1) reasoning.push(`Total: ${inst} install days, ${wir} wiring days`);
    return { vendor: "RTT", counts, scope, flags, reasoning, zip: "", siteText: "", install: inst, wiring: wir, helper,
      project: names.join(" + "), roof: roofAny, amuStartup };
  }

  function parse(text) {
    const t = String(text || "");
    const r = /Global Finishing Solutions|GFS Product Based Model/i.test(t) ? parseGFS(t) : /\bRTT\b/.test(t) ? parseRTT(t) : null;
    if (!r) return null;
    const amuUnits = r.amuStartup ?? r.counts.amu;
    return {
      vendor: r.vendor, project: r.project, site: r.siteText ? (r.zip ? r.zip : "") : "", zip: r.zip,
      one_way_miles_from_dfw: 0, scope: r.scope, install_working_days: r.install, wiring_working_days: r.wiring, helper: r.helper, include_wiring: true,
      counts: r.counts, extras: { welding_days: 0, overhead_door_sqft: 0, amu_startup_units: amuUnits }, day_reasoning: r.reasoning, flags: r.flags,
    };
  }

  // Miles from DFW by zip (free lookup; straight-line distance x road factor).
  async function milesFromZip(zip) {
    if (!/^\d{5}$/.test(zip || "")) return null;
    try {
      const res = await fetch(`https://api.zippopotam.us/us/${zip}`);
      if (!res.ok) return null;
      const j = await res.json(), p = j.places && j.places[0]; if (!p) return null;
      const lat = Number(p.latitude), lon = Number(p.longitude), R = 3958.8, rad = Math.PI / 180;
      const a = Math.sin((lat - DFW[0]) * rad / 2) ** 2 + Math.cos(DFW[0] * rad) * Math.cos(lat * rad) * Math.sin((lon - DFW[1]) * rad / 2) ** 2;
      const straight = 2 * R * Math.asin(Math.sqrt(a));
      return { miles: Math.round(straight * ROAD_FACTOR), place: `${p["place name"]}, ${p["state abbreviation"]} ${zip}` };
    } catch (_) { return null; }
  }

  const api = { parse, milesFromZip, unitDays };
  if (typeof module !== "undefined") module.exports = api; else window.ZPQR = api;
})();
