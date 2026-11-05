// Loads each sheet tab (live published CSV first, /data snapshot as fallback)
// and turns the raw grid into clean records.
(function () {
  const CFG = window.FD_CONFIG;

  // ── fetching ────────────────────────────────────────────────
  function liveUrl(tab) {
    if (!CFG.publishedId || tab.gid == null) return null;
    return `https://docs.google.com/spreadsheets/d/e/${CFG.publishedId}/pub?gid=${tab.gid}&single=true&output=csv&_=${Date.now()}`;
  }

  async function fetchText(url) {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    const t = await r.text();
    if (/^\s*<(!doctype|html)/i.test(t)) throw new Error("got HTML, not CSV");
    return t;
  }

  async function loadTab(key) {
    const tab = CFG.tabs[key];
    const url = liveUrl(tab);
    if (url) {
      try { return { rows: grid(await fetchText(url)), source: "live" }; }
      catch (e) { console.warn(`Live fetch failed for ${tab.name}, using snapshot`, e); }
    }
    try { return { rows: grid(await fetchText(tab.file)), source: "snapshot" }; }
    catch (e) { console.warn(`No data for ${tab.name}`, e); return { rows: [], source: "missing" }; }
  }

  function grid(text) {
    return Papa.parse(text, { skipEmptyLines: false }).data.map(r => r.map(c => (c ?? "").trim()));
  }

  // ── value helpers ───────────────────────────────────────────
  const MONTHS = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
  const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  const isIsoDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s);

  function num(s) {
    if (s == null) return null;
    const m = String(s).replace(/,/g, "").match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  }

  // "1:14:36 (Strava)", "45:29 (moving)", "60 min", "~4 hr", "27.7 min", "11:08"
  function minutes(s) {
    if (!s) return null;
    s = String(s);
    let m = s.match(/(\d+):(\d{2}):(\d{2})/);
    if (m) return +m[1]*60 + +m[2] + +m[3]/60;
    m = s.match(/(\d+):(\d{2})/);
    if (m) return +m[1] + +m[2]/60;
    m = s.match(/([\d.]+)\s*(hr|hour|h)\b/i);
    if (m) return parseFloat(m[1]) * 60;
    m = s.match(/([\d.]+)\s*min/i);
    if (m) return parseFloat(m[1]);
    return null;
  }

  // "6.68 mi (10.75 km)", "2,221 yd", "1,250 yd", "10.05 km"
  function miles(s) {
    if (!s) return null;
    s = String(s).replace(/,/g, "");
    let m = s.match(/([\d.]+)\s*mi\b/i);   if (m) return parseFloat(m[1]);
    m = s.match(/([\d.]+)\s*yd/i);          if (m) return parseFloat(m[1]) / 1760;
    m = s.match(/([\d.]+)\s*km/i);          if (m) return parseFloat(m[1]) * 0.621371;
    m = s.match(/([\d.]+)\s*m\b/i);         if (m) return parseFloat(m[1]) / 1609.34;
    return null;
  }

  // "5h 14m" -> minutes
  function hm(s) {
    const m = String(s || "").match(/(\d+)h\s*(\d+)m/);
    return m ? +m[1]*60 + +m[2] : null;
  }

  // "Oct 24, 2027" -> Date
  function longDate(s) {
    const m = String(s || "").match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s*(\d{4})/);
    if (!m || MONTHS[m[1].toLowerCase()] == null) return null;
    return new Date(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
  }

  function sport(type) {
    const t = (type || "").toLowerCase();
    if (/swim/.test(t)) return "Swim";
    if (/bike|ride|cycl/.test(t)) return "Bike";
    if (/run|marathon/.test(t)) return "Run";
    if (/strength|hiit|weights/.test(t)) return "Strength";
    if (/dance/.test(t)) return "Dance";
    if (/walk|hike/.test(t)) return "Walk";
    if (/stair|int2|cardio|elliptical|row/.test(t)) return "Cardio";
    return "Other";
  }

  function findHeader(rows, firstCell) {
    return rows.findIndex(r => (r[0] || "").toLowerCase() === firstCell.toLowerCase());
  }

  // ── parsers ─────────────────────────────────────────────────
  function parseSleep(rows) {
    const h = findHeader(rows, "Date");
    const out = [];
    for (const r of rows.slice(h + 1)) {
      if (!isIsoDate(r[0])) continue;
      const bed = r[1], [bh, bm] = (bed || "").split(":").map(Number);
      // bedtime as hours after 6 PM so midnight-crossing sorts correctly
      let bedRel = null;
      if (!isNaN(bh)) { bedRel = bh + bm/60 - 18; if (bedRel < 0) bedRel += 24; }
      out.push({
        date: r[0], bed, wake: r[2], sleepMin: hm(r[3]),
        deep: num(r[4]), light: num(r[5]), rem: num(r[6]), awake: num(r[7]),
        score: num(r[8]), label: r[9], hrv: num(r[10]), nap: num(r[11]) || 0,
        bedRel,
      });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }

  function parseWorkouts(rows) {
    const h = findHeader(rows, "Date");
    const out = []; let cur = null;
    for (const r of rows.slice(h + 1)) {
      if (isIsoDate(r[0])) cur = r[0];
      else if (r[0]) continue;
      if (!cur || !r[2]) continue;
      out.push({
        date: cur, type: r[2], sport: sport(r[2]), race: /^race/i.test(r[2]),
        kcal: num(r[3]), desc: r[4], min: minutes(r[5]), mi: miles(r[6]), hr: num(r[7]),
        estimated: /est\./i.test(r[3]), source: r[9],
      });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }

  // Food log "Daily total" rows carry nutrition with real ISO dates; items give meal detail.
  function parseFood(rows) {
    const days = {}, items = [];
    let cur = null, meal = "";
    for (const r of rows) {
      if (isIsoDate(r[0])) { cur = r[0]; meal = ""; }
      else if (r[0]) continue;
      if (!cur) continue;
      if (r[2]) meal = normMeal(r[2]);
      if (/^daily total$/i.test(r[3])) {
        days[cur] = { date: cur, kcal: num(r[4]), protein: num(r[5]), carbs: num(r[6]), fat: num(r[7]), burn: num(r[10]) || 0 };
      } else if (r[3] && num(r[4]) != null) {
        items.push({ date: cur, meal: meal || "other", food: r[3], kcal: num(r[4]), protein: num(r[5]) || 0 });
      }
    }
    return { days, items };
  }

  function normMeal(m) {
    const s = String(m).toLowerCase().trim();
    const f = parseFloat(s);
    if (!isNaN(f) && f < 1) { // spreadsheet time fraction
      const hr = f * 24;
      return hr < 11 ? "breakfast" : hr < 15 ? "lunch" : hr < 18 ? "afternoon" : hr < 21 ? "dinner" : "night";
    }
    if (/late|night/.test(s)) return "night";
    if (/break|pre-|morning|~11|~12/.test(s)) return /break|pre-/.test(s) ? "breakfast" : "morning";
    if (/lunch|meal/.test(s)) return "lunch";
    if (/after|snack|ride|race|picnic|drink|through|evening/.test(s)) return /evening/.test(s) ? "evening" : "snacks";
    if (/dinner/.test(s)) return "dinner";
    return "snacks";
  }

  // DailyStats dates have no year ("Wed Nov 4"): walk newest→oldest and roll the year back at Jan→Dec.
  function parseWeights(rows) {
    const out = [];
    let year = new Date().getFullYear(), lastMonth = null;
    for (const r of rows) {
      const m = (r[0] || "").match(/^[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})$/);
      if (!m) continue;
      const mo = MONTHS[m[1].toLowerCase()];
      if (lastMonth != null && mo > lastMonth) year--;
      lastMonth = mo;
      const w = num(r[11]);
      const d = new Date(year, mo, +m[2]);
      if (d > new Date()) { year--; d.setFullYear(year); }
      if (w) out.push({ date: iso(d), weight: w });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }

  function parseRaces(rows) {
    const h = findHeader(rows, "Date");
    const out = [];
    for (const r of rows.slice(h + 1)) {
      const d = longDate(r[0]);
      if (!d || !r[1]) continue;
      out.push({
        date: iso(d), d, name: r[1], location: r[2], kind: r[3], status: r[4],
        finish: r[5], confirmation: r[6], cost: r[7], notes: r[8],
        possible: /^possible race/i.test(r[1]),
        completed: /^completed/i.test(r[4]) || /^partial/i.test(r[4]),
        registered: /registered|entered/i.test(r[4]) && !/not registered|likely did not/i.test(r[4]),
        category: raceCat(r[3]),
      });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }

  function raceCat(k) {
    const s = (k || "").toLowerCase();
    if (/triathlon|aquathon/.test(s)) return /70\.3/.test(s) ? "70.3" : /full/.test(s) ? "Full IRONMAN" : "Triathlon";
    if (/half/.test(s)) return "Half marathon";
    if (/marathon/.test(s)) return "Marathon";
    return "Other";
  }

  // Google Health tab: several titled sections, each followed by a header row.
  function parseHealth(rows) {
    const sections = {};
    let title = null, header = null;
    for (const r of rows) {
      const first = r[0] || "", rest = r.slice(1).some(c => c);
      if (!first && !rest) { header = null; continue; }
      if (/BY YEAR/.test(first) && !rest) { title = first.split(" BY")[0].toLowerCase(); header = null; continue; }
      if (title && !header && first === "Year") { header = r; sections[title] = []; continue; }
      if (title && header && /^\d{4}$/.test(first)) {
        const o = {}; header.forEach((k, i) => k && (o[k] = r[i])); sections[title].push(o);
      }
    }
    return sections;
  }

  function parseSummary(rows) {
    const kv = {};
    for (const r of rows) if (r[0] && r[1]) kv[r[0]] = r[1];
    return kv;
  }

  // ── public ──────────────────────────────────────────────────
  window.FD_DATA = {
    async loadAll() {
      const keys = Object.keys(CFG.tabs);
      const res = await Promise.all(keys.map(loadTab));
      const raw = Object.fromEntries(keys.map((k, i) => [k, res[i]]));
      const food = parseFood(raw.foodlog.rows);
      const weights = parseWeights(raw.dailystats.rows);
      const sources = Object.fromEntries(keys.map(k => [k, raw[k].source]));
      return {
        sources,
        summary: parseSummary(raw.summary.rows),
        sleep: parseSleep(raw.sleep.rows),
        workouts: parseWorkouts(raw.workouts.rows),
        nutrition: Object.values(food.days).sort((a, b) => a.date.localeCompare(b.date)),
        foodItems: food.items,
        weights,
        races: parseRaces(raw.racelist.rows),
        health: parseHealth(raw.googleHealth.rows),
      };
    },
    util: { iso, num },
  };
})();
