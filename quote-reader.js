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
    if (u.supply) { d += u.supply; why.push(`supply chamber +${u.supply}d`); }
    if (u.amu) { d += 2 * u.amu; why.push(`${u.amu} AMU set + duct through roof +${2 * u.amu}d`); }
    if (u.stacks) { d += u.stacks; why.push(`${u.stacks} exhaust stack(s) through roof +${u.stacks}d`); }
    if (u.roof > 30 && (u.stacks || u.amu)) { d += 1; why.push(`roof ${Math.round(u.roof)}' (over 30') +1d`); }
    let w = { chamber: 1, openface: 1, prep: 1.5, mixroom: 1.5, oven: 3 }[u.kind] ?? 2;
    w += 1.5 * (u.amu || 0) + 0.5 * (u.fans || 0) + (u.autobalance ? 0.5 : 0) + (u.doorSwitches ? 0.5 : 0) + ((u.lights || 0) > 24 ? 0.5 : 0);
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
  function parseRTT(text) {
    const lines = text.split("\n");
    const counts = { lights: 0, amu: 0, rollup_doors: 0, solenoid: 0, door_switches: 0, dust_collector: 0, panels: 0, exhaust_fans: 0, recirc_fans: 0, probes: 0, air_seals: 0 };
    const scope = [], flags = [], reasoning = [];
    const multLine = lines.findIndex((l) => /Total\s*x\s*\d+/i.test(l));
    const mult = multLine >= 0 ? n(lines[multLine].match(/Total\s*x\s*(\d+)/i)[1]) : 1;
    const totalLine = lines.findIndex((l) => /^\s*Total\s*\|/i.test(l));
    const items = []; // {qty, part, desc, base}
    lines.forEach((l, i) => { const m = l.match(/^\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/); if (m) items.push({ qty: Number(m[1]), part: m[2].trim(), desc: m[3].trim(), base: totalLine < 0 || i < totalLine }); });
    const sum = (re, base = true) => items.filter((it) => (!base || it.base) && (re.test(it.part) || re.test(it.desc))).reduce((a, it) => a + it.qty, 0);
    const boothRe = /booth|exhaust chamber|prep station|mixing room|oven|sanding|grinding/i;
    const booths = items.filter((it) => it.base && boothRe.test(it.desc) && !/supply chamber/i.test(it.desc));
    const supply = sum(/supply chamber|^ISC/i);
    const amu = sum(/make-?up|dump unit|\bAMU\b|^CT-\d/i) - sum(/duct/i);
    const narrFans = [...text.matchAll(/\((\d+)\)\s*[\d.]+\s*(?:in|")[^\n]{0,40}?Exhaust Fan/gi)].reduce((a, m) => a + Number(m[1]), 0);
    const fans = narrFans || sum(/exhaust fan|fan kit/i);
    const lights = sum(/light|LED fixture/i) || [...text.matchAll(/\((\d+)\)[^\n.]{0,60}light fixture/gi)].reduce((a, m) => a + Number(m[1]), 0);
    const stacks = sum(/automatic roof vent|^ARV/i) || sum(/roof flange|^PRF/i) || (/roof/i.test(text) ? fans : 0);
    const switches = sum(/door switch|limit switch/i);
    const solenoid = sum(/solenoid/i, false);
    const panelsListed = sum(/control panel/i, false);
    const roof = n((text.match(/typical\s+(\d+)\s*'/i) || [])[1]);
    const d = dims((text.match(/Interior working dimensions of:\s*([^.]+?long)/i) || [])[1]);
    const perBooth = Math.max(1, booths.reduce((a, b) => a + b.qty, 0));
    const kindOf = (s) => /oven/i.test(s) ? "oven" : /exhaust chamber|open face/i.test(s) ? "chamber" : /prep/i.test(s) ? "prep" : /mixing/i.test(s) ? "mixroom" : "enclosed";
    let inst = 0, wir = 0;
    (booths.length ? booths : [{ qty: 1, part: "booth", desc: "booth" }]).forEach((b, k) => {
      const share = (x) => (k === 0 ? x : 0); // attach AMU/stacks/supply to the first booth line
      const u = unitDays({ label: `${b.part}`, kind: kindOf(b.desc), ...d, amu: share(amu), stacks: share(stacks), supply: share(supply), roof, fans: share(fans), doorSwitches: share(switches), lights: share(lights) });
      inst += u.install * b.qty; wir += u.wiring * b.qty; reasoning.push(`${u.why} = ${u.install} install days; wiring ${u.wiring}d${b.qty > 1 ? ` (x${b.qty})` : ""}`);
      scope.push(`RTT ${b.part}: ${b.desc}${fmtDims(d) ? ` — ${fmtDims(d)} interior` : ""}`);
    });
    if (supply) scope.push(`${supply} supply chamber(s)`);
    if (amu) scope.push(`${amu} AMU: ${(items.find((it) => /^CT-|make-?up|dump unit/i.test(it.part + " " + it.desc)) || {}).desc || ""}`.trim());
    if (fans) scope.push(`${fans} exhaust fan(s)${stacks ? `, ${stacks} roof stack(s)` : ""}${roof ? `, ~${roof}' roof` : ""}`);
    if (lights) scope.push(`${lights} light fixture(s)`);
    const panels = panelsListed || amu || (fans ? perBooth : 0);
    Object.assign(counts, { lights, amu, exhaust_fans: fans, door_switches: switches, solenoid, panels });
    if (mult > 1) {
      for (const k of Object.keys(counts)) if (k !== "solenoid") counts[k] *= mult;
      inst *= mult; wir *= mult;
      scope.unshift(`Quote is for ${mult} identical systems ("Total x${mult}")`);
      reasoning.push(`x${mult} systems = ${inst} install days, ${wir} wiring days`);
      flags.push(`RTT quote shows "Total x${mult}": counts and days were multiplied by ${mult}. Upgrade lines (solenoid qty ${solenoid}) were not — verify.`);
    }
    if (!panelsListed && panels) flags.push(`No control panel line found: assumed ${counts.panels} panel(s) (one per AMU / fan system${mult > 1 ? `, x${mult} systems` : ""})`);
    if (!switches && booths.some((b) => kindOf(b.desc) === "enclosed")) flags.push("Enclosed booth but no door switches listed — check doors and limit switches");
    if (/duct support by others/i.test(text)) flags.push("Duct supports by others (RTT)");
    if (/cutting, sealing, or framing of roof/i.test(text)) flags.push("Roof cutting/sealing/framing excluded by RTT — confirm who does it");
    if (/seismic/i.test(text)) flags.push("RTT equipment not designed for seismic/wind loads unless noted");
    if (amu) flags.push("AMU start-up is not included in RTT's price — ZPar AMU startup trip budgeted");
    if (roof) flags.push(`Duct quoted for a ~${roof}' roof — confirm actual roof height and lift`);
    flags.push("RTT quotes don't state the job site — enter it to calculate miles");
    flags.push("Read with the free rule-based reader: check every count and day estimate");
    return { vendor: "RTT", counts, scope, flags, reasoning, zip: "", siteText: "", install: inst, wiring: wir, helper: booths.every((b) => /prep|mixing/i.test(b.desc)) ? 0 : 1,
      project: `${mult > 1 ? `(${mult}) ` : ""}${booths.map((b) => `${b.qty > 1 ? b.qty + "x " : ""}${b.desc.replace(/\s+/g, " ")}`).join(" + ") || "RTT equipment"}${supply ? " + supply chamber" : ""}${amu ? " + AMU" : ""}`, roof };
  }

  function parse(text) {
    const t = String(text || "");
    const r = /Global Finishing Solutions|GFS Product Based Model/i.test(t) ? parseGFS(t) : /\bRTT\b/.test(t) ? parseRTT(t) : null;
    if (!r) return null;
    const amuUnits = r.counts.amu;
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
