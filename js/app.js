(function () {
  const CFG = window.FD_CONFIG, T = CFG.targets;
  const SPORTS = ["Swim", "Bike", "Run", "Strength", "Dance", "Walk", "Cardio", "Other"];
  const SPORT_VAR = { Swim: "--s1", Bike: "--s2", Run: "--s3", Strength: "--s4", Dance: "--s5", Walk: "--s6", Cardio: "--s7", Other: "--other" };
  const state = { data: null, days: 30, page: "overview", charts: [] };
  const $ = (s, el = document) => el.querySelector(s);
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const sportColor = s => css(SPORT_VAR[s] || "--other");

  // ── date helpers ────────────────────────────────────────────
  const parse = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const iso = FD_DATA.util.iso;
  const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const fmtDay = s => parse(s).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const fmtLong = s => parse(s).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const weekStart = s => { const d = parse(s); const dow = (d.getDay() + 6) % 7; return iso(addDays(d, -dow)); };
  const daysBetween = (a, b) => Math.round((b - a) / 86400000);

  function lastDate() {
    const d = state.data;
    const all = [d.sleep.at(-1)?.date, d.nutrition.at(-1)?.date, d.workouts.at(-1)?.date].filter(Boolean).sort();
    return all.at(-1) || iso(today());
  }
  function inRange(list) {
    if (!state.days) return list;
    const from = iso(addDays(parse(lastDate()), -(state.days - 1)));
    return list.filter(r => r.date >= from);
  }
  function window_(list, endIso, n) { // n days ending at endIso (inclusive)
    const from = iso(addDays(parse(endIso), -(n - 1)));
    return list.filter(r => r.date >= from && r.date <= endIso);
  }

  // ── math helpers ────────────────────────────────────────────
  const avg = a => { const v = a.filter(x => x != null && !isNaN(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
  const sum = a => a.reduce((s, x) => s + (x || 0), 0);
  const round = (x, d = 0) => x == null ? "–" : (+x).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });
  const hhmm = m => m == null ? "–" : `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, "0")}m`;
  function rolling(values, n) {
    return values.map((_, i) => { const w = values.slice(Math.max(0, i - n + 1), i + 1).filter(v => v != null); return w.length ? w.reduce((a, b) => a + b, 0) / w.length : null; });
  }
  function corr(xs, ys) {
    const p = xs.map((x, i) => [x, ys[i]]).filter(([x, y]) => x != null && y != null);
    if (p.length < 5) return null;
    const mx = avg(p.map(q => q[0])), my = avg(p.map(q => q[1]));
    let n = 0, dx = 0, dy = 0;
    for (const [x, y] of p) { n += (x - mx) * (y - my); dx += (x - mx) ** 2; dy += (y - my) ** 2; }
    return n / Math.sqrt(dx * dy);
  }

  // ── chart helpers ───────────────────────────────────────────
  function baseOpts(extra = {}) {
    const ink2 = css("--ink-2"), grid = css("--grid"), muted = css("--muted");
    return Object.assign({
      responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { labels: { color: ink2, boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: "rectRounded", font: { size: 12 } } },
        tooltip: { backgroundColor: css("--ink"), titleColor: css("--page"), bodyColor: css("--page"), padding: 8, cornerRadius: 6, boxPadding: 4 },
      },
      scales: {
        x: { grid: { display: false }, border: { color: css("--axis") }, ticks: { color: muted, maxRotation: 0, autoSkip: true, autoSkipPadding: 12, font: { size: 11 } } },
        y: { grid: { color: grid }, border: { display: false }, ticks: { color: muted, font: { size: 11 } }, beginAtZero: true },
      },
    }, extra);
  }
  function chart(canvasId, config) {
    const el = document.getElementById(canvasId);
    if (!el) return;
    const c = new Chart(el, config);
    state.charts.push(c);
    return c;
  }
  const bar = (label, data, color, extra = {}) => Object.assign({ type: "bar", label, data, backgroundColor: color, borderRadius: 4, borderSkipped: "start", maxBarThickness: 22, categoryPercentage: 0.85, barPercentage: 0.9 }, extra);
  const line = (label, data, color, extra = {}) => Object.assign({ type: "line", label, data, borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.3, spanGaps: true }, extra);
  const goal = (label, n, value, color) => line(label, Array(n).fill(value), color || css("--ink-2"), { borderDash: [5, 4], borderWidth: 1.5, tension: 0, pointHoverRadius: 0 });

  // ── shared UI pieces ────────────────────────────────────────
  function tile(label, value, unit, delta, progress, isLimit) {
    return `<div class="card tile c3">
      <div class="label">${label}</div>
      <div class="value">${value}${unit ? `<small>${unit}</small>` : ""}</div>
      <div class="delta">${delta || "&nbsp;"}</div>
      ${progress != null ? `<div class="bar-track"><div class="bar-fill" style="width:${Math.max(0, Math.min(100, progress))}%${isLimit && progress > 100 ? ";background:var(--serious)" : ""}"></div></div>` : ""}
    </div>`;
  }
  function deltaText(cur, prev, unit, higherIsGood, digits = 0) {
    if (cur == null || prev == null) return "";
    const d = cur - prev;
    if (Math.abs(d) < Math.pow(10, -digits) / 2) return `same as ${cmpLabel}`;
    const good = higherIsGood == null ? null : (d > 0) === higherIsGood;
    const cls = good == null ? "" : good ? "up-good" : "up-bad";
    return `<span class="${cls}">${d > 0 ? "▲" : "▼"} ${round(Math.abs(d), digits)}${unit}</span> vs ${cmpLabel}`;
  }
  let cmpLabel = "prior 7 days";
  const card = (cls, title, sub, body) => `<div class="card ${cls}"><h3>${title}</h3>${sub ? `<p class="sub">${sub}</p>` : ""}${body}</div>`;
  const canvas = (id, size = "") => `<div class="chart ${size}"><canvas id="${id}"></canvas></div>`;
  const rangeLabel = () => state.days === 365 ? "last 12 months" : state.days ? `last ${state.days} days` : "all data";
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function sortableTable(id, cols, rows, sortKey) {
    // cols: [{key,label,num,fmt,cls}]
    const html = `<div class="table-wrap"><table id="${id}"><thead><tr>${cols.map((c, i) => `<th data-i="${i}" class="${c.num ? "n" : ""}">${c.label}</th>`).join("")}</tr></thead><tbody></tbody></table></div>`;
    setTimeout(() => {
      const tbl = document.getElementById(id); if (!tbl) return;
      let sortI = Math.max(0, cols.findIndex(c => c.key === sortKey)), dir = -1;
      const draw = () => {
        const c = cols[sortI];
        const sorted = [...rows].sort((a, b) => { const x = a[c.key], y = b[c.key]; return (x == null) - (y == null) || (x > y ? 1 : x < y ? -1 : 0) * dir; });
        tbl.tBodies[0].innerHTML = sorted.map(r => `<tr class="${r._cls || ""}">${cols.map(c => `<td class="${c.num ? "n" : ""} ${c.cls || ""}">${c.fmt ? c.fmt(r[c.key], r) : esc(r[c.key] ?? "")}</td>`).join("")}</tr>`).join("");
      };
      tbl.tHead.onclick = e => { const th = e.target.closest("th"); if (!th) return; const i = +th.dataset.i; dir = i === sortI ? -dir : -1; sortI = i; draw(); };
      draw();
    });
    return html;
  }

  // ── pages ───────────────────────────────────────────────────
  function bpTile(list, prev, note, cls = "c3") {
    if (!list.length) return tile("Blood pressure", "–", "", "no readings");
    const sA = avg(list.map(x => x.sys)), dA = avg(list.map(x => x.dia)), c = bpCat(sA, dA);
    const pS = prev.length >= 3 ? avg(prev.map(x => x.sys)) : null;
    const latest = list.at(-1);
    return `<div class="card tile ${cls}">
      <div class="label">Avg blood pressure</div>
      <div class="value">${bpText(sA, dA)}<small>mmHg</small></div>
      <div class="delta"><span class="pill" style="border-color:var(${c.color})"><span class="swatch" style="background:var(${c.color})"></span>${c.key}</span> ${[`${list.length} reading days`, note, `latest ${bpText(latest.sys, latest.dia)} on ${fmtDay(latest.date)}`, pS != null ? deltaText(sA, pS, " systolic", false) : ""].filter(Boolean).join(" · ")}</div>
    </div>`;
  }

  function renderOverview() {
    const d = state.data, end = lastDate();
    // Period follows the range buttons; "All" reaches back to the oldest record in any tab (2013)
    const firstDay = [d.sleepHistory[0]?.date, d.weights[0]?.date, d.steps[0]?.date, d.nutrition[0]?.date, d.workouts[0]?.date].filter(Boolean).sort()[0] || end;
    const N = state.days || daysBetween(parse(firstDay), parse(end)) + 1;
    const prevEnd = iso(addDays(parse(end), -N));
    const cmp = !!state.days;
    cmpLabel = `prior ${N} days`;
    const startOf = iso(addDays(parse(end), -(N - 1))), prevStart = iso(addDays(parse(end), -(2 * N - 1)));
    // compare only when that log fully covers the earlier period, otherwise the change is misleading
    const covers = list => cmp && list.length && list[0].date <= prevStart;
    // daily logs: the earlier period must have at least 70% of its days filled in
    const P = (list) => { if (!cmp) return []; const w = window_(list, prevEnd, N); return w.length >= 0.7 * N ? w : []; };
    const s7 = window_(d.sleep, end, N), s7p = P(d.sleep);
    // sleep duration & 7h nights use the merged history (Garmin Sleep tab + Health Historical Daily)
    const h7 = window_(d.sleepHistory, end, N), h7p = P(d.sleepHistory);
    // note when a tile's log starts after the period begins
    const since = list => { const w = window_(list, end, N); const f = w[0]?.date; return f && f > iso(addDays(parse(startOf), 7)) ? `since ${fmtDay(f)}${f.slice(0, 4) !== end.slice(0, 4) ? ", " + f.slice(0, 4) : ""}` : ""; };
    const n7 = window_(d.nutrition, end, N).filter(x => x.kcal > 1000), n7p = P(d.nutrition).filter(x => x.kcal > 1000);
    const w7 = window_(d.workouts, end, N), w7p = P(d.workouts);
    const orNull = v => (v == null || isNaN(v)) ? null : v;
    const sleepAvg = avg(h7.map(x => x.hours * 60)), sleepPrev = orNull(avg(h7p.map(x => x.hours * 60)));
    const scoreAvg = avg(s7.map(x => x.score)), scorePrev = orNull(avg(s7p.map(x => x.score)));
    const prot = avg(n7.map(x => x.protein)), protPrev = orNull(avg(n7p.map(x => x.protein)));
    const kcal = avg(n7.map(x => x.kcal)), kcalPrev = orNull(avg(n7p.map(x => x.kcal)));
    // per-week rates use only the days the workout log actually covers
    const wFirst = d.workouts[0]?.date || end;
    const weeks = (daysBetween(parse(wFirst > startOf ? wFirst : startOf), parse(end)) + 1) / 7;
    const hrs = sum(w7.map(x => x.min)) / 60 / weeks, hrsPrev = covers(d.workouts) ? sum(w7p.map(x => x.min)) / 60 / (N / 7) : null;
    const protDays = n7.filter(x => x.protein >= T.protein).length;
    const wt = d.weights.at(-1);
    const wStart = d.weights.find(x => x.date >= iso(addDays(parse(end), -(N - 1))));
    const nights7 = h7.filter(x => x.hours >= T.sleepHours).length;
    const st7 = window_(d.steps, end, N), stepAvg = avg(st7.map(x => x.steps)), stepPrev = orNull(avg(P(d.steps).map(x => x.steps)));
    const burnWk = sum(w7.map(x => x.kcal)) / weeks;
    // BP: readings are sparse, so when the period has none, fall back to the latest 7 readings
    let bpW = window_(d.bp, end, N), bpP = P(d.bp).length ? window_(d.bp, prevEnd, N) : [];
    if (!bpW.length && d.bp.length) bpW = d.bp.slice(-7);
    const title = N === 7 ? "This week" : N === 365 ? "Last 12 months" : state.days ? `Last ${N} days` : "All data";
    const periodWord = state.days === 365 ? "over 12 months" : state.days ? `over ${N} days` : `since ${parse(firstDay).toLocaleDateString(undefined, { month: "short", year: "numeric" })}`;
    const joinD = (...parts) => parts.filter(Boolean).join(" · ");

    const upcoming = d.races.filter(r => r.d >= today() && r.registered).slice(0, 4);

    let html = `<h2>${title} <span class="sub" style="font-weight:400">· ${state.days ? `${N} days ending ${fmtLong(end)}${cmp ? `; arrows compare with the ${N} days before when both periods have data` : ""}` : `${fmtLong(firstDay)} – ${fmtLong(end)}`}</span></h2>
    <div class="grid">
      ${tile("Training", round(hrs, 1), "h/week", joinD(`${w7.length} sessions`, since(d.workouts) && `log ${since(d.workouts)}`, deltaText(hrs, hrsPrev, " h", true, 1)))}
      ${tile("Avg steps", round(stepAvg), "/day", joinD(`${st7.filter(x => x.steps >= T.steps).length.toLocaleString()} of ${st7.length.toLocaleString()} days ≥ ${T.steps.toLocaleString()}`, since(d.steps), deltaText(stepAvg, stepPrev, "", true)), stepAvg / T.steps * 100)}
      ${tile("Avg protein", round(prot), "g", joinD(`${protDays} of ${n7.length} days ≥ ${T.protein} g`, since(d.nutrition) && `food log ${since(d.nutrition)}`, deltaText(prot, protPrev, " g", true)), prot / T.protein * 100)}
      ${tile("Avg intake", round(kcal), "kcal", joinD(since(d.nutrition) && `food log ${since(d.nutrition)}`, deltaText(kcal, kcalPrev, " kcal", null)))}
      ${tile("Avg sleep", hhmm(sleepAvg), "", joinD(`${nights7.toLocaleString()} of ${h7.length.toLocaleString()} nights ≥ ${T.sleepHours} h`, since(d.sleepHistory), deltaText(sleepAvg && sleepAvg / 60, sleepPrev && sleepPrev / 60, " h", true, 1)), sleepAvg / (T.sleepHours * 60) * 100)}
      ${tile("Avg sleep score", round(scoreAvg), "/100", joinD(since(d.sleep) && `Garmin ${since(d.sleep)}`, deltaText(scoreAvg, scorePrev, " pts", true)))}
      ${tile("Weight", wt ? round(wt.weight, 1) : "–", "lb", wt && wStart && wStart.date !== wt.date ? `<span class="${wt.weight <= wStart.weight ? "down-good" : "up-bad"}">${wt.weight <= wStart.weight ? "▼" : "▲"} ${round(Math.abs(wt.weight - wStart.weight), 1)} lb</span> ${periodWord} · goal ${T.weightGoal}` : `goal ${T.weightGoal}`)}
      ${bpTile(bpW, bpP, since(d.bp))}
    </div>
    <div class="grid">
      ${card("c7", "What the data says", `Patterns across ${rangeLabel()}`, `<ul class="insights">${insights().join("")}</ul>`)}
      ${card("c5", "Upcoming races", "Registered entries", `<div class="race-list">${upcoming.map(raceRow).join("") || "<p class='sub'>None</p>"}</div>`)}
    </div>
    <div class="grid">
      ${card("c4", "Training per day", `${rangeLabel()} · minutes, by sport`, canvas("ov-train", "short"))}
      ${card("c4", "Protein per day", `${rangeLabel()} · dashed = ${T.protein} g goal`, canvas("ov-prot", "short"))}
      ${card("c4", "Sleep score", rangeLabel(), canvas("ov-sleep", "short"))}
    </div>`;
    $("#page-overview").innerHTML = html;

    const wo = inRange(d.workouts);
    const woDays = [...new Set(wo.map(w => w.date))].sort();
    if (woDays.length) {
      const days = []; for (let x = parse(woDays[0]); iso(x) <= lastDate(); x = addDays(x, 1)) days.push(iso(x));
      const sp = SPORTS.filter(s => wo.some(w => w.sport === s));
      const to = baseOpts(); to.scales.x.stacked = true; to.scales.y.stacked = true;
      to.plugins.legend = { display: false };
      to.plugins.tooltip = { ...to.plugins.tooltip, filter: i => i.parsed.y > 0, callbacks: { label: c => `${c.dataset.label}: ${Math.round(c.parsed.y)} min` } };
      chart("ov-train", { type: "bar", data: { labels: days.map(fmtDay), datasets: sp.map(s => bar(s, days.map(dd => sum(wo.filter(w => w.date === dd && w.sport === s).map(w => w.min))), sportColor(s), { borderRadius: 0, borderColor: css("--surface"), borderWidth: { top: 1 } })) }, options: to });
    }
    const sl = inRange(d.sleep);
    chart("ov-sleep", { type: "bar", data: { labels: sl.map(x => fmtDay(x.date)), datasets: [bar("Score", sl.map(x => x.score), sl.map(x => scoreColor(x.score)))] }, options: baseOpts({ plugins: { ...baseOpts().plugins, legend: { display: false } }, scales: { ...baseOpts().scales, y: { ...baseOpts().scales.y, max: 100 } } }) });
    const nu = inRange(d.nutrition);
    chart("ov-prot", { data: { labels: nu.map(x => fmtDay(x.date)), datasets: [bar("Protein (g)", nu.map(x => x.protein), css("--s3")), goal("Goal", nu.length, T.protein)] }, options: baseOpts({ plugins: { ...baseOpts().plugins, legend: { display: false } } }) });
  }

  // American Heart Association categories (applied to each day's average reading)
  const BP_CATS = [
    { key: "Normal",   test: (s, d) => s < 120 && d < 80,  color: "--good",     tip: "under 120 / 80" },
    { key: "Elevated", test: (s, d) => s < 130 && d < 80,  color: "--warn",     tip: "120–129 / under 80" },
    { key: "Stage 1",  test: (s, d) => s < 140 && d < 90,  color: "--serious",  tip: "130–139 or 80–89" },
    { key: "Stage 2",  test: (s, d) => s <= 180 && d <= 120, color: "--critical", tip: "140+ or 90+" },
    { key: "Very high", test: () => true,                  color: "--critical", tip: "over 180 or over 120" },
  ];
  const bpCat = (s, d) => BP_CATS.find(c => c.test(s, d));
  const bpText = (s, d) => s == null ? "–" : `${Math.round(s)}/${Math.round(d)}`;

  function scoreColor(s) {
    return s >= 80 ? css("--good") : s >= 60 ? css("--s1") : css("--serious");
  }

  function raceRow(r) {
    const days = daysBetween(today(), r.d);
    const main = /northern california/i.test(r.name);
    return `<div class="race">
      <div class="count"><b>${days >= 0 ? days : "–"}</b><span>days</span></div>
      <div><div class="name">${esc(r.name)} ${main ? '<span class="pill main">Goal race</span>' : ""}</div>
      <div class="meta">${[fmtLong(r.date), esc(r.location || ""), esc(r.category), Math.floor(days / 7) + " wks"].filter(Boolean).join(" · ")}</div></div>
    </div>`;
  }

  function insights() {
    const d = state.data, out = [], tag = { w: [], n: [], s: [] };
    const sl = inRange(d.sleep), nu = inRange(d.nutrition);
    // bedtime vs score
    const early = sl.filter(x => x.bedRel != null && x.bedRel < 6), late = sl.filter(x => x.bedRel != null && x.bedRel >= 6);
    if (early.length >= 3 && late.length >= 3) {
      const a = avg(early.map(x => x.score)), b = avg(late.map(x => x.score));
      const ma = avg(early.map(x => x.sleepMin)), mb = avg(late.map(x => x.sleepMin));
      tag.s.push(li(a > b ? "good" : "info", "◐", `Nights in bed <b>before midnight</b> average a score of <b>${round(a)}</b> and ${hhmm(ma)} asleep, vs <b>${round(b)}</b> and ${hhmm(mb)} after midnight (${early.length} vs ${late.length} nights).`));
    }
    const short = sl.filter(x => x.sleepMin < T.sleepHours * 60).length;
    if (sl.length) tag.s.push(li(short / sl.length > 0.5 ? "bad" : "warn", "z", `<b>${short} of ${sl.length}</b> nights were under ${T.sleepHours} h. Average ${hhmm(avg(sl.map(x => x.sleepMin)))}, ${hhmm(T.sleepHours * 60 - avg(sl.map(x => x.sleepMin)))} short of target.`));
    const full = nu.filter(x => x.kcal > 1000);
    if (full.length) {
      const hit = full.filter(x => x.protein >= T.protein).length;
      const pAvg = avg(full.map(x => x.protein));
      tag.n.push(li(hit / full.length >= 0.5 ? "good" : "warn", "P", `Protein hit ${T.protein} g on <b>${hit} of ${full.length}</b> days (avg ${round(pAvg)} g). Closing the gap is about <b>${round(Math.max(0, T.protein - pAvg))} g/day</b>, roughly one protein shake.`));
      const kAvg = avg(full.map(x => x.kcal)), bAvg = avg(full.map(x => x.burn));
      tag.n.push(li("info", "k", `Average intake <b>${round(kAvg)} kcal</b> vs FITTR's ${T.kcal.toLocaleString()} target; with ~${round(bAvg)} kcal of logged exercise, net is about <b>${round(kAvg - bAvg)}</b>.`));
    }
    // late-night eating
    const items = inRange(d.foodItems);
    const night = sum(items.filter(i => i.meal === "night").map(i => i.kcal)), tot = sum(items.map(i => i.kcal));
    if (tot) tag.n.push(li(night / tot > 0.1 ? "warn" : "good", "☾", `Late-night eating is <b>${round(night / tot * 100)}%</b> of logged calories (${round(night)} kcal across ${new Set(items.filter(i => i.meal === "night").map(i => i.date)).size} nights).`));
    // training load vs next night's sleep
    const burnByDay = {}; for (const w of d.workouts) burnByDay[w.date] = (burnByDay[w.date] || 0) + (w.kcal || 0);
    const pairs = sl.map(s => ({ burn: burnByDay[iso(addDays(parse(s.date), -1))] || 0, score: s.score }));
    const big = pairs.filter(p => p.burn >= 600), small = pairs.filter(p => p.burn < 600);
    if (big.length >= 3 && small.length >= 3) tag.w.push(li("info", "↯", `After big training days (≥600 kcal) the next night scores <b>${round(avg(big.map(p => p.score)))}</b> vs <b>${round(avg(small.map(p => p.score)))}</b> after lighter days.`));
    return [...tag.w, ...tag.n, ...tag.s];
  }
  const li = (cls, ico, text) => `<li><span class="ico ${cls}">${ico}</span><span>${text}</span></li>`;

  function renderSleep() {
    const d = state.data, sl = inRange(d.sleep);
    const labels = sl.map(x => fmtDay(x.date));
    const counts = ["EXCELLENT", "GOOD", "FAIR", "POOR"].map(l => sl.filter(x => x.label === l).length);
    $("#page-sleep").innerHTML = `<h2>Sleep</h2>
    <div class="grid">
      ${tile("Avg asleep", hhmm(avg(sl.map(x => x.sleepMin))), "", `target ${T.sleepHours} h`, avg(sl.map(x => x.sleepMin)) / (T.sleepHours * 60) * 100)}
      ${tile("Avg score", round(avg(sl.map(x => x.score))), "/100", `${counts[0]} excellent · ${counts[1]} good · ${counts[2]} fair · ${counts[3]} poor`)}
      ${tile("Avg overnight HRV", round(avg(sl.map(x => x.hrv)), 1), "ms", `range ${Math.min(...sl.map(x => x.hrv))}–${Math.max(...sl.map(x => x.hrv))} ms`)}
      ${tile("Avg bedtime", fmtBed(avg(sl.map(x => x.bedRel))), "", `${sl.filter(x => x.bedRel != null && x.bedRel < 6).length} of ${sl.length} nights before midnight`)}
    </div>
    <div class="grid">
      ${card("c12", "Time asleep", `${rangeLabel()} · dashed = ${T.sleepHours} h target · line = 7-night average`, canvas("sl-dur"))}
    </div>
    <div class="grid">
      ${card("c8", "Sleep stages", "Minutes per night", canvas("sl-stages"))}
      ${card("c4", "Score labels", rangeLabel(), canvas("sl-labels"))}
    </div>
    <div class="grid">
      ${card("c6", "Overnight HRV", "ms · line = 7-night average", canvas("sl-hrv"))}
      ${card("c6", "Bedtime vs sleep score", "Each dot is a night; later bedtimes to the right", canvas("sl-bed"))}
    </div>
    <div class="grid">${card("c12", "Nightly detail", "Click a column to sort", sortableTable("sl-table", [
      { key: "date", label: "Wake date", fmt: v => fmtLong(v) },
      { key: "bed", label: "Bed" }, { key: "wake", label: "Wake" },
      { key: "sleepMin", label: "Asleep", num: 1, fmt: hhmm },
      { key: "deep", label: "Deep", num: 1 }, { key: "rem", label: "REM", num: 1 }, { key: "light", label: "Light", num: 1 }, { key: "awake", label: "Awake", num: 1 },
      { key: "score", label: "Score", num: 1 }, { key: "label", label: "Label" }, { key: "hrv", label: "HRV", num: 1 }, { key: "nap", label: "Nap (min)", num: 1 },
    ], [...sl].reverse()))}</div>`;

    const hrs = sl.map(x => x.sleepMin / 60);
    chart("sl-dur", { data: { labels, datasets: [
      line("7-night avg", rolling(hrs, 7), css("--ink-2")),
      goal(`${T.sleepHours} h target`, sl.length, T.sleepHours, css("--good")),
      bar("Hours asleep", hrs, sl.map(x => x.sleepMin >= T.sleepHours * 60 ? css("--s1") : css("--s1") + "99")),
    ] }, options: baseOpts({ plugins: { ...baseOpts().plugins, tooltip: { ...baseOpts().plugins.tooltip, callbacks: { label: c => `${c.dataset.label}: ${hhmm(c.parsed.y * 60)}` } } } }) });

    const stageOpts = baseOpts(); stageOpts.scales.x.stacked = true; stageOpts.scales.y.stacked = true;
    chart("sl-stages", { type: "bar", data: { labels, datasets: [
      bar("Deep", sl.map(x => x.deep), css("--s7")), bar("REM", sl.map(x => x.rem), css("--s5")),
      bar("Light", sl.map(x => x.light), css("--s1") + "88"), bar("Awake", sl.map(x => x.awake), css("--other")),
    ].map(ds => ({ ...ds, borderRadius: 0, borderColor: css("--surface"), borderWidth: { top: 1 } })) }, options: stageOpts });

    chart("sl-labels", { type: "doughnut", data: { labels: ["Excellent", "Good", "Fair", "Poor"], datasets: [{ data: counts, backgroundColor: [css("--good"), css("--s3"), css("--s1"), css("--serious")], borderColor: css("--surface"), borderWidth: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: "62%", plugins: { legend: { position: "bottom", labels: { color: css("--ink-2"), boxWidth: 10, usePointStyle: true, pointStyle: "rectRounded" } }, tooltip: baseOpts().plugins.tooltip } } });

    const hrv = sl.map(x => x.hrv);
    const hrvOpts = baseOpts(); hrvOpts.scales.y.beginAtZero = false;
    chart("sl-hrv", { data: { labels, datasets: [line("Nightly HRV", hrv, css("--s3") + "77", { pointRadius: 2, tension: 0 }), line("7-night avg", rolling(hrv, 7), css("--s3"))] }, options: hrvOpts });

    const bedOpts = baseOpts({ interaction: { mode: "nearest", intersect: true } });
    bedOpts.scales.x = { ...bedOpts.scales.x, type: "linear", min: 3, max: 12, ticks: { ...bedOpts.scales.x.ticks, stepSize: 1, callback: v => fmtBed(v) } };
    bedOpts.scales.y.max = 100;
    bedOpts.plugins.legend = { display: false };
    bedOpts.plugins.tooltip = { ...bedOpts.plugins.tooltip, callbacks: { label: c => `${fmtDay(sl[c.dataIndex].date)}: bed ${sl[c.dataIndex].bed}, score ${c.parsed.y}, ${hhmm(sl[c.dataIndex].sleepMin)}` } };
    chart("sl-bed", { type: "scatter", data: { datasets: [{ data: sl.map(x => ({ x: x.bedRel, y: x.score })), backgroundColor: sl.map(x => scoreColor(x.score)), pointRadius: 5, pointHoverRadius: 7, borderColor: css("--surface"), borderWidth: 1.5 }] }, options: bedOpts });
  }
  function fmtBed(rel) {
    if (rel == null || isNaN(rel)) return "–";
    let h = (rel + 18) % 24, m = Math.round((h % 1) * 60); h = Math.floor(h); if (m === 60) { h = (h + 1) % 24; m = 0; }
    const ap = h >= 12 ? "pm" : "am"; const h12 = h % 12 || 12;
    return `${h12}:${String(m).padStart(2, "0")}${ap}`;
  }

  function renderNutrition() {
    const d = state.data, nu = inRange(d.nutrition), full = nu.filter(x => x.kcal > 1000);
    const labels = nu.map(x => fmtDay(x.date));
    const P = avg(full.map(x => x.protein)), C = avg(full.map(x => x.carbs)), F = avg(full.map(x => x.fat));
    const items = inRange(d.foodItems);
    const MEALS = ["breakfast", "morning", "lunch", "snacks", "evening", "dinner", "night"];
    const mealK = MEALS.map(m => sum(items.filter(i => i.meal === m).map(i => i.kcal)) / Math.max(1, new Set(items.map(i => i.date)).size));
    // top foods by total kcal (group by normalised name)
    const groups = {};
    for (const i of items) {
      const k = i.food.replace(/\(.*?\)/g, "").replace(/^(Usual breakfast).*/i, "$1").replace(/,.*$/, "").replace(/×\s*\d+|\d+\s*×/g, "").replace(/\s+/g, " ").trim();
      const name = k; const key = k.toLowerCase().replace(/(\w{3,})s\b/g, "$1");
      (groups[key] ||= { food: name, times: 0, kcal: 0, protein: 0 }); groups[key].times++; groups[key].kcal += i.kcal; groups[key].protein += i.protein;
    }
    const top = Object.values(groups).sort((a, b) => b.kcal - a.kcal).slice(0, 25).map(g => ({ ...g, pPer100: g.kcal ? g.protein / g.kcal * 100 : 0 }));

    $("#page-nutrition").innerHTML = `<h2>Nutrition</h2>
    <div class="grid">
      ${tile("Avg intake", round(avg(full.map(x => x.kcal))), "kcal", `FITTR target ${T.kcal.toLocaleString()} · ${full.filter(x => x.kcal <= T.kcal).length} of ${full.length} days at/under`)}
      ${tile("Avg protein", round(P), "g", `${full.filter(x => x.protein >= T.protein).length} of ${full.length} days ≥ ${T.protein} g`, P / T.protein * 100)}
      ${tile("Avg carbs", round(C), "g", `FITTR ${T.carbs} g · ${round((C / T.carbs - 1) * 100)}% ${C > T.carbs ? "over" : "under"}`, C / T.carbs * 100, true)}
      ${tile("Avg fat", round(F), "g", `FITTR ${T.fat} g · ${round(Math.abs(F / T.fat - 1) * 100)}% ${F > T.fat ? "over" : "under"}`, F / T.fat * 100, true)}
    </div>
    <p class="sub">Days under 1,000 kcal (partial logs, CT-prep day) are left out of averages. Values are estimates from the food log.</p>
    <div class="grid">${card("c12", "Calories in", `${rangeLabel()} · dashed = ${T.kcal.toLocaleString()} kcal FITTR target`, canvas("nu-kcal"))}</div>
    <div class="grid">
      ${card("c8", "Protein", `dashed = ${T.protein} g goal (Coach M) · dotted = ${T.proteinFittr} g (FITTR)`, canvas("nu-prot"))}
      ${card("c4", "Where calories come from", "Average share of calories by macro", canvas("nu-macro"))}
    </div>
    <div class="grid">
      ${card("c5", "Calories by time of day", "Average kcal per logged day", canvas("nu-meal"))}
      ${card("c7", "Weekly averages", "Mon–Sun weeks", weeklyNutritionTable(full))}
    </div>
    <div class="grid">${card("c12", "Top foods by calories", `${rangeLabel()} · grouped by name · click to sort`, sortableTable("nu-top", [
      { key: "food", label: "Food", cls: "wrap" }, { key: "times", label: "Times", num: 1 },
      { key: "kcal", label: "Total kcal", num: 1, fmt: v => round(v) }, { key: "protein", label: "Protein g", num: 1, fmt: v => round(v) },
      { key: "pPer100", label: "g protein / 100 kcal", num: 1, fmt: v => round(v, 1) },
    ], top, "kcal"))}</div>`;

    chart("nu-kcal", { data: { labels, datasets: [goal("Target", nu.length, T.kcal), bar("Intake (kcal)", nu.map(x => x.kcal), css("--s2"))] },
      options: baseOpts({ plugins: { ...baseOpts().plugins, legend: { display: false }, tooltip: { ...baseOpts().plugins.tooltip, callbacks: { afterBody: c => { const r = nu[c[0].dataIndex]; return r ? `Exercise: ${round(r.burn)} kcal\nNet: ${round(r.kcal - r.burn)} kcal` : ""; } } } } }) });
    chart("nu-prot", { data: { labels, datasets: [goal(`${T.protein} g`, nu.length, T.protein), goal(`${T.proteinFittr} g`, nu.length, T.proteinFittr, css("--muted")), bar("Protein (g)", nu.map(x => x.protein), nu.map(x => x.protein >= T.protein ? css("--s3") : css("--s3") + "88"))].map((ds, i) => i === 1 ? { ...ds, borderDash: [2, 3] } : ds) },
      options: baseOpts({ plugins: { ...baseOpts().plugins, legend: { display: false } } }) });
    const kc = [P * 4, C * 4, F * 9], tot = kc[0] + kc[1] + kc[2];
    chart("nu-macro", { type: "doughnut", data: { labels: ["Protein", "Carbs", "Fat"], datasets: [{ data: kc.map(k => Math.round(k / tot * 100)), backgroundColor: [css("--s3"), css("--s1"), css("--s4")], borderColor: css("--surface"), borderWidth: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: "62%", plugins: { legend: { position: "bottom", labels: { color: css("--ink-2"), boxWidth: 10, usePointStyle: true, pointStyle: "rectRounded", generateLabels: ch => ch.data.labels.map((l, i) => ({ text: `${l} ${ch.data.datasets[0].data[i]}%`, fillStyle: ch.data.datasets[0].backgroundColor[i], strokeStyle: "transparent", fontColor: css("--ink-2"), pointStyle: "rectRounded", index: i })) } }, tooltip: { ...baseOpts().plugins.tooltip, callbacks: { label: c => `${c.label}: ${c.parsed}% of calories` } } } } });
    const mealOpts = baseOpts({ indexAxis: "y", interaction: { mode: "nearest", axis: "y", intersect: false } });
    mealOpts.scales = { x: { ...mealOpts.scales.y }, y: { ...mealOpts.scales.x, ticks: { color: css("--ink-2") } } };
    mealOpts.plugins.legend = { display: false };
    chart("nu-meal", { type: "bar", data: { labels: MEALS.map(m => m[0].toUpperCase() + m.slice(1)), datasets: [bar("kcal / day", mealK.map(Math.round), MEALS.map(m => m === "night" ? css("--s7") : css("--s1")), { borderSkipped: "start" })] }, options: mealOpts });
  }

  function weeklyNutritionTable(full) {
    const wk = {};
    for (const r of full) (wk[weekStart(r.date)] ||= []).push(r);
    const rows = Object.entries(wk).sort((a, b) => b[0].localeCompare(a[0])).map(([w, rs]) => ({
      week: w, days: rs.length, kcal: avg(rs.map(x => x.kcal)), protein: avg(rs.map(x => x.protein)), carbs: avg(rs.map(x => x.carbs)), fat: avg(rs.map(x => x.fat)),
      hit: rs.filter(x => x.protein >= T.protein).length, burn: avg(rs.map(x => x.burn)),
    }));
    return sortableTable("nu-week", [
      { key: "week", label: "Week of", fmt: v => fmtDay(v) }, { key: "days", label: "Days", num: 1 },
      { key: "kcal", label: "kcal", num: 1, fmt: v => round(v) }, { key: "protein", label: "Protein", num: 1, fmt: v => round(v) },
      { key: "hit", label: `≥${T.protein} g`, num: 1 }, { key: "carbs", label: "Carbs", num: 1, fmt: v => round(v) }, { key: "fat", label: "Fat", num: 1, fmt: v => round(v) },
      { key: "burn", label: "Exercise kcal", num: 1, fmt: v => round(v) },
    ], rows);
  }

  let trainFilter = "All";
  // ── Workout highlights: animated sport cards (photo replaces the scene when one exists) ──
  const SCENES = {
    Swim: `<div class="scn swim"><i class="wave w1"></i><i class="wave w2"></i><i class="wave w3"></i>
      <b class="bub" style="--x:12%;--d:0s"></b><b class="bub" style="--x:28%;--d:1.2s"></b><b class="bub" style="--x:46%;--d:.6s"></b><b class="bub" style="--x:64%;--d:1.8s"></b><b class="bub" style="--x:82%;--d:.9s"></b>
      <svg class="ico" viewBox="0 0 64 64" aria-hidden="true"><circle cx="44" cy="18" r="6"/><path d="M8 40c6 0 6-4 12-4s6 4 12 4 6-4 12-4 6 4 12 4" /><path d="M14 30l14-8 10 6 8-4"/></svg></div>`,
    Bike: `<div class="scn bike"><i class="hills h1"></i><i class="hills h2"></i><i class="road"></i>
      <svg class="ico wheel-pair" viewBox="0 0 96 56" aria-hidden="true"><g class="wheel" style="transform-origin:22px 36px"><circle cx="22" cy="36" r="16"/><path d="M22 20v32M6 36h32M11 25l22 22M33 25L11 47"/></g><g class="wheel" style="transform-origin:74px 36px"><circle cx="74" cy="36" r="16"/><path d="M74 20v32M58 36h32M63 25l22 22M85 25L63 47"/></g><path d="M22 36l18-20h22l12 20M40 16l8 20h-26M58 10h8"/></svg></div>`,
    Run: `<div class="scn run"><i class="sun"></i><i class="hills h1"></i><i class="hills h2"></i><i class="track"></i>
      <svg class="ico runner" viewBox="0 0 64 64" aria-hidden="true"><circle cx="38" cy="10" r="6"/><path d="M34 20l-8 14 10 6-4 16M34 20l10 10 10-2M30 26l-12 2M26 34l-10 12"/></svg></div>`,
  };
  const pace = w => {
    if (!w.min || !w.mi) return "";
    if (w.sport === "Run") { const p = w.min / w.mi; return `${Math.floor(p)}:${String(Math.round((p % 1) * 60)).padStart(2, "0")} /mi`; }
    if (w.sport === "Bike") return `${round(w.mi / (w.min / 60), 1)} mph`;
    const p = w.min / (w.mi * 17.6); return `${Math.floor(p)}:${String(Math.round((p % 1) * 60)).padStart(2, "0")} /100yd`;
  };
  function highlights(list) {
    const photos = state.data.photos || [];
    const cards = list.map(w => {
      const ph = photos.filter(p => p.date === w.date && (!p.sport || p.sport === w.sport));
      const bg = ph.length ? `<div class="scn photo">${ph.map((p, i) => `<img src="${esc(p.src)}" alt="" loading="lazy"${i ? "" : ' class="on"'}>`).join("")}${ph.length > 1 ? `<span class="ph-n">📷 ${ph.length}</span>` : ""}</div>` : SCENES[w.sport];
      const stats = [w.mi ? `${round(w.mi, w.sport === "Bike" ? 1 : 2)} mi` : "", w.min ? (w.min < 60 ? `${Math.round(w.min)} min` : hhmm(w.min)) : "", pace(w), w.hr ? `${w.hr} bpm` : "", w.kcal ? `${round(w.kcal)} kcal` : ""].filter(Boolean);
      return `<article class="hl ${w.sport.toLowerCase()}">${bg}
        <div class="hl-body">
          <div class="hl-top"><span class="hl-sport">${w.sport}</span>${w.race || /\btri\b|half marathon|race leg|marathon/i.test(w.desc || "") ? '<span class="hl-race">Race</span>' : ""}</div>
          <div class="hl-title">${esc((w.desc || w.type).split(/[;(]/)[0].trim())}</div>
          <div class="hl-date">${fmtLong(w.date)}</div>
          <div class="hl-stats">${stats.map(x => `<span>${x}</span>`).join("")}</div>
        </div></article>`;
    }).join("");
    return `<div class="hl-wrap"><div class="hl-row" id="hl-row" tabindex="0" aria-label="Workout highlights">${cards}</div>
      <div class="hl-nav"><button class="chip" id="hl-prev" aria-label="Previous highlight">◀</button><span id="hl-dots"></span><button class="chip" id="hl-next" aria-label="Next highlight">▶</button><button class="chip" id="hl-play" aria-label="Pause auto-play">❚❚ Pause</button></div></div>`;
  }
  let hlTimer = null, phTimer = null;
  function startHighlights() {
    clearInterval(hlTimer);
    const row = $("#hl-row"); if (!row) return;
    const cards = [...row.children]; if (!cards.length) return;
    const dots = $("#hl-dots");
    dots.innerHTML = cards.map((_, i) => `<i data-i="${i}"></i>`).join("");
    let idx = 0, playing = !matchMedia("(prefers-reduced-motion: reduce)").matches, hover = false;
    const go = i => { idx = (i + cards.length) % cards.length; row.scrollTo({ left: cards[idx].offsetLeft - row.offsetLeft, behavior: "smooth" }); mark(); };
    const mark = () => dots.querySelectorAll("i").forEach((d, i) => d.classList.toggle("on", i === idx));
    row.addEventListener("scroll", () => { const w = cards[0].offsetWidth + 12; const i = Math.round(row.scrollLeft / w); if (i !== idx) { idx = Math.min(i, cards.length - 1); mark(); } }, { passive: true });
    $("#hl-prev").onclick = () => go(idx - 1); $("#hl-next").onclick = () => go(idx + 1);
    dots.onclick = e => { const t = e.target.closest("i"); if (t) go(+t.dataset.i); };
    const btn = $("#hl-play");
    const label = () => { btn.textContent = playing ? "❚❚ Pause" : "▶ Play"; btn.setAttribute("aria-label", playing ? "Pause auto-play" : "Start auto-play"); };
    btn.onclick = () => { playing = !playing; label(); };
    row.onmouseenter = () => hover = true; row.onmouseleave = () => hover = false;
    row.addEventListener("touchstart", () => { playing = false; label(); }, { passive: true });
    label(); mark();
    hlTimer = setInterval(() => { if (playing && !hover && document.visibilityState === "visible" && $("#hl-row") === row) go(idx + 1); }, 5000);
    // cards with several photos cross-fade through them
    clearInterval(phTimer);
    phTimer = setInterval(() => {
      if (!document.body.contains(row) || document.visibilityState !== "visible") return;
      row.querySelectorAll(".scn.photo").forEach(s => {
        const imgs = s.querySelectorAll("img"); if (imgs.length < 2) return;
        const i = [...imgs].findIndex(im => im.classList.contains("on"));
        imgs[i].classList.remove("on"); imgs[(i + 1) % imgs.length].classList.add("on");
      });
    }, 2500);
  }

  // weeks in the selected range that the workout log actually covers (used everywhere for "per week")
  function perWeekSpan() {
    const d = state.data, end = lastDate(), wFirst = d.workouts[0]?.date || end;
    const startOf = state.days ? iso(addDays(parse(end), -(state.days - 1))) : wFirst;
    return Math.max(1, daysBetween(parse(wFirst > startOf ? wFirst : startOf), parse(end)) + 1) / 7;
  }

  function renderTraining() {
    const d = state.data, wo = inRange(d.workouts);
    const bySport = Object.fromEntries(SPORTS.map(s => [s, wo.filter(w => w.sport === s)]));
    const present = SPORTS.filter(s => bySport[s].length);
    const totals = s => ({ n: bySport[s].length, min: sum(bySport[s].map(w => w.min)), mi: sum(bySport[s].map(w => w.mi)), kcal: sum(bySport[s].map(w => w.kcal)) });
    // weeks
    const weeks = [...new Set(wo.map(w => weekStart(w.date)))].sort();
    const woAll = inRange(d.allWorkouts), skipped = woAll.filter(w => !w.counted);
    const rowsFor = () => trainFilter === "All" ? woAll : woAll.filter(w => w.sport === trainFilter);

    const sbr = wo.filter(w => ["Swim", "Bike", "Run"].includes(w.sport)).slice().reverse();
    const hasPhoto = w => (d.photos || []).some(p => p.date === w.date && (!p.sport || p.sport === w.sport));
    // latest 12, plus any older ones in range that have photos
    let hlList = sbr.filter((w, i) => i < 12 || hasPhoto(w));
    const hlFallback = !hlList.length;
    if (hlFallback) hlList = d.workouts.filter(w => ["Swim", "Bike", "Run"].includes(w.sport)).slice(-6).reverse();
    $("#page-training").innerHTML = `<h2>Training</h2>
    ${hlList.length ? `<div class="grid">${card("c12", "Highlights", `${hlFallback ? "Latest swims, rides and runs (none in " + rangeLabel() + ")" : `Swims, rides and runs · ${rangeLabel()}`} · auto-plays, swipe or use the arrows`, highlights(hlList))}</div>` : ""}
    <div class="grid">
      ${tile("Sessions", wo.length, "", `${new Set(wo.map(w => w.date)).size} active days · ${rangeLabel()}`)}
      ${tile("Time", round(sum(wo.map(w => w.min)) / 60, 1), "h", `${round(sum(wo.map(w => w.min)) / 60 / perWeekSpan(), 1)} h per week`)}
      ${tile("Activity burn", round(sum(wo.map(w => w.kcal))), "kcal", `${wo.filter(w => w.estimated).length} of ${wo.length} sessions estimated, rest from watch`)}
      ${tile("Swim · Bike · Run", `${round(totals("Swim").mi, 1)} · ${round(totals("Bike").mi)} · ${round(totals("Run").mi, 1)}`, "mi", "distance logged")}
    </div>
    <p class="sub">Counting rule: every logged workout counts except chores and recovery (household tasks, sauna/hot tub)${skipped.length ? ` — ${skipped.length} such ${skipped.length === 1 ? "entry" : "entries"} in this range, shown in the log as "not counted"` : ""}. Per-week figures divide by the days in the range that the log covers.</p>
    <div class="grid">
      ${card("c8", "Weekly training hours by sport", "Mon–Sun weeks", canvas("tr-week", "tall"))}
      ${card("c4", "Mix by sport", "Hours", canvas("tr-mix", "tall"))}
    </div>
    <div class="grid">${card("c12", "Daily steps", `${rangeLabel()} · dashed = ${T.steps.toLocaleString()} · line = 7-day average`, canvas("tr-steps", "short"))}</div>
    <div class="grid">${card("c12", "Activity calendar", "Each square is a day, darker = more exercise calories", calendar())}</div>
    <div class="grid">${card("c12", "Sport totals", rangeLabel(), sortableTable("tr-tot", [
      { key: "sport", label: "Sport", fmt: v => `<span class="swatch" style="background:${sportColor(v)}"></span>${v}` },
      { key: "n", label: "Sessions", num: 1 }, { key: "hours", label: "Hours", num: 1, fmt: v => round(v, 1) },
      { key: "mi", label: "Miles", num: 1, fmt: v => v ? round(v, 1) : "–" }, { key: "kcal", label: "kcal", num: 1, fmt: v => round(v) },
      { key: "avgHr", label: "Avg HR", num: 1, fmt: v => v ? round(v) : "–" },
    ], present.map(s => ({ sport: s, ...totals(s), hours: totals(s).min / 60, avgHr: avg(bySport[s].map(w => w.hr)) })), "hours"))}</div>
    <div class="grid">${card("c12", "Workout log", "", `<div class="filters" id="tr-filters">${["All", ...present].map(s => `<button class="chip ${s === trainFilter ? "on" : ""}" data-s="${s}">${s}</button>`).join("")}</div><div id="tr-log"></div>`)}</div>`;

    const drawLog = () => {
      $("#tr-log").innerHTML = sortableTable("tr-log-t", [
        { key: "date", label: "Date", fmt: v => fmtLong(v) },
        { key: "sport", label: "Sport", fmt: (v, r) => `<span class="swatch" style="background:${sportColor(v)}"></span>${esc(r.type)}${r.race ? ' <span class="pill">race</span>' : ""}${r.counted ? "" : ' <span class="pill" title="Chores and recovery are logged but not counted as training">not counted</span>'}` },
        { key: "desc", label: "Description", cls: "wrap" },
        { key: "min", label: "Time", num: 1, fmt: v => v ? hhmm(v) : "–" },
        { key: "mi", label: "Miles", num: 1, fmt: v => v ? round(v, 2) : "–" },
        { key: "hr", label: "Avg HR", num: 1, fmt: v => v || "–" },
        { key: "kcal", label: "kcal", num: 1, fmt: (v, r) => `${round(v)}${r.estimated ? "*" : ""}` },
      ], rowsFor());
    };
    drawLog();
    startHighlights();
    $("#tr-filters").onclick = e => { const b = e.target.closest(".chip"); if (!b) return; trainFilter = b.dataset.s; $("#tr-filters").querySelectorAll(".chip").forEach(c => c.classList.toggle("on", c === b)); drawLog(); };

    const st = inRange(d.steps);
    chart("tr-steps", { data: { labels: st.map(x => fmtDay(x.date)), datasets: [
      line("7-day avg", rolling(st.map(x => x.steps), 7), css("--ink-2")),
      goal(`${T.steps.toLocaleString()} steps`, st.length, T.steps, css("--good")),
      bar("Steps", st.map(x => x.steps), st.map(x => x.steps >= T.steps ? css("--s6") : css("--s6") + "88")),
    ] }, options: baseOpts({ plugins: { ...baseOpts().plugins, legend: { display: false } } }) });
    const wkOpts = baseOpts(); wkOpts.scales.x.stacked = true; wkOpts.scales.y.stacked = true;
    wkOpts.plugins.tooltip = { ...wkOpts.plugins.tooltip, filter: i => i.parsed.y > 0, callbacks: { label: c => `${c.dataset.label}: ${round(c.parsed.y, 1)} h`, footer: items => `Total: ${round(sum(items.map(i => i.parsed.y)), 1)} h` } };
    chart("tr-week", { type: "bar", data: { labels: weeks.map(w => fmtDay(w)), datasets: present.map(s => bar(s, weeks.map(w => sum(bySport[s].filter(x => weekStart(x.date) === w).map(x => x.min)) / 60), sportColor(s), { borderRadius: 0, borderColor: css("--surface"), borderWidth: { top: 2 }, maxBarThickness: 40 })) }, options: wkOpts });
    chart("tr-mix", { type: "doughnut", data: { labels: present, datasets: [{ data: present.map(s => +(totals(s).min / 60).toFixed(1)), backgroundColor: present.map(sportColor), borderColor: css("--surface"), borderWidth: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: "62%", plugins: { legend: { position: "bottom", labels: { color: css("--ink-2"), boxWidth: 10, usePointStyle: true, pointStyle: "rectRounded" } }, tooltip: { ...baseOpts().plugins.tooltip, callbacks: { label: c => `${c.label}: ${c.parsed} h` } } } } });
  }

  function calendar() {
    const d = state.data;
    const burn = {}; for (const w of d.workouts) burn[w.date] = (burn[w.date] || 0) + (w.kcal || 0);
    const end = parse(lastDate());
    const span = state.days ? Math.max(state.days, 35) : daysBetween(parse(d.workouts[0]?.date || lastDate()), end) + 1;
    let start = addDays(end, -(span - 1)); start = addDays(start, -((start.getDay() + 6) % 7));
    const steps = ["--grid", "#b7d3f6", "#6da7ec", "#2a78d6", "#184f95"];
    const lvl = k => !k ? 0 : k < 300 ? 1 : k < 600 ? 2 : k < 1000 ? 3 : 4;
    let cells = "";
    for (let x = new Date(start); x <= end; x = addDays(x, 1)) {
      const k = burn[iso(x)] || 0, l = lvl(k);
      cells += `<div title="${fmtLong(iso(x))}: ${k ? round(k) + " kcal" : "rest"}" style="background:${l ? steps[l] : "var(--grid)"}"></div>`;
    }
    return `<div class="cal">${cells}</div><div class="cal-legend"><i style="background:var(--grid)"></i> Rest ${steps.slice(1).map(c => `<i style="background:${c}"></i>`).join("")} 1,000+ kcal</div>`;
  }

  // group daily records into periods ("week" | "month" | "year") -> [{key, values}]
  function groupBy(list, period, field) {
    const m = new Map();
    for (const r of list) {
      const v = r[field]; if (v == null || isNaN(v)) continue;
      const k = period === "year" ? r.date.slice(0, 4) : period === "month" ? r.date.slice(0, 7) : weekStart(r.date);
      (m.get(k) || m.set(k, []).get(k)).push(v);
    }
    return [...m].sort((a, b) => a[0].localeCompare(b[0])).map(([key, values]) => ({ key, values, avg: avg(values), min: Math.min(...values), max: Math.max(...values) }));
  }
  const fmtMonth = k => new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, 1).toLocaleDateString(undefined, { month: "short", year: "numeric" });

  // Vertical year / quarter / month lines and holiday shading for category-axis charts.
  // options.plugins.periodMarks = { dates: [iso per label], show: {year, quarter, month, holidays} }
  const periodMarks = {
    id: "periodMarks",
    beforeDatasetsDraw(ch, _a, o) {
      if (!o || !o.dates || o.dates.length < 2) return;
      const { ctx, chartArea: A, scales: { x } } = ch, D = o.dates, S = o.show || {};
      const px = i => x.getPixelForValue(i), mid = i => (px(i - 1) + px(i)) / 2;
      ctx.save();
      if (S.holidays) { // Thanksgiving week through New Year (Nov 20 – Jan 5)
        const hol = dt => { const m = +dt.slice(5, 7), dd = +dt.slice(8, 10); return (m === 11 && dd >= 20) || m === 12 || (m === 1 && dd <= 5); };
        ctx.fillStyle = css("--warn") + "26";
        let st = null;
        for (let i = 0; i <= D.length; i++) {
          const on = i < D.length && hol(D[i]);
          if (on && st == null) st = i;
          if (!on && st != null) { const x0 = st ? mid(st) : A.left, x1 = i < D.length ? mid(i) : A.right; ctx.fillRect(x0, A.top, x1 - x0, A.bottom - A.top); st = null; }
        }
      }
      let lastLabelX = -1e9;
      for (let i = 1; i < D.length; i++) {
        const a = D[i - 1], b = D[i];
        const kind = a.slice(0, 4) !== b.slice(0, 4) ? "year" : Math.floor((+a.slice(5, 7) - 1) / 3) !== Math.floor((+b.slice(5, 7) - 1) / 3) ? "quarter" : a.slice(5, 7) !== b.slice(5, 7) ? "month" : null;
        if (!kind || !S[kind] && !(kind === "year" && (S.quarter || S.month)) && !(kind === "quarter" && S.month)) continue;
        // a year boundary is also a quarter and month boundary; draw the strongest one that's switched on
        const k = S[kind] ? kind : S.quarter && kind === "year" ? "quarter" : "month";
        const xx = mid(i);
        ctx.beginPath(); ctx.moveTo(xx, A.top); ctx.lineTo(xx, A.bottom);
        ctx.lineWidth = k === "year" ? 1.5 : 1;
        ctx.strokeStyle = k === "year" ? css("--ink-2") : k === "quarter" ? css("--muted") : css("--axis");
        ctx.setLineDash(k === "year" ? [] : k === "quarter" ? [4, 3] : [2, 3]);
        ctx.stroke();
        const lbl = k === "year" ? b.slice(0, 4) : k === "quarter" ? `Q${Math.floor((+b.slice(5, 7) - 1) / 3) + 1}` : parse(b).toLocaleDateString(undefined, { month: "short" });
        ctx.font = `${k === "year" ? 600 : 400} 10.5px system-ui, sans-serif`;
        const w = ctx.measureText(lbl).width;
        if (xx - lastLabelX > w + 8 || k === "year") {
          ctx.fillStyle = k === "year" ? css("--ink-2") : css("--muted");
          ctx.fillText(lbl, xx + 3, A.top + 11);
          lastLabelX = xx + w;
        }
      }
      ctx.restore();
    },
  };

  let bodyMarks = null;            // user's marker toggles; reset when the range changes
  function defaultMarks() {
    return state.days === 0 ? { year: true, quarter: true, month: false, holidays: true }
      : state.days === 365 ? { year: true, quarter: true, month: true, holidays: true }
      : { year: true, quarter: false, month: true, holidays: state.days >= 90 };
  }

  function renderBody() {
    const d = state.data, s = d.summary, all = d.weights;
    const N = state.days, end = lastDate(), first = all[0]?.date || end;
    // sliding window: offset 0 = the latest N days, 1 = the N days before that, …
    const maxOff = N ? Math.max(0, Math.floor(daysBetween(parse(first), parse(end)) / N)) : 0;
    state.bodyOffset = Math.min(state.bodyOffset || 0, maxOff);
    const off = N ? state.bodyOffset : 0;
    const winEnd = iso(addDays(parse(end), -off * N)), winStart = N ? iso(addDays(parse(winEnd), -(N - 1))) : first;
    const wtAll = all.filter(x => x.date >= winStart && x.date <= winEnd);
    const weekly = wtAll.length > 150;
    const wt = weekly ? groupBy(wtAll, "week", "weight").map(g => ({ date: g.key, weight: +g.avg.toFixed(1) })) : wtAll;
    const last = all.at(-1);
    const years = groupBy(all, "year", "weight");
    const marks = bodyMarks || defaultMarks();
    const winLabel = N ? `${fmtLong(winStart)} – ${fmtLong(winEnd)}` : `${fmtLong(first)} – ${fmtLong(end)}`;
    const chg = wtAll.length > 1 ? wtAll.at(-1).weight - wtAll[0].weight : null;

    // typical year: each month's average minus that year's average, averaged over years with ≥ 8 months of weigh-ins
    const byYM = groupBy(all, "month", "weight");
    const yrAvg = Object.fromEntries(years.map(y => [y.key, y.avg]));
    const monthsPerYear = {}; byYM.forEach(g => monthsPerYear[g.key.slice(0, 4)] = (monthsPerYear[g.key.slice(0, 4)] || 0) + 1);
    const season = Array.from({ length: 12 }, (_, m) => {
      const v = byYM.filter(g => +g.key.slice(5, 7) === m + 1 && monthsPerYear[g.key.slice(0, 4)] >= 8).map(g => g.avg - yrAvg[g.key.slice(0, 4)]);
      return { m, dev: v.length ? avg(v) : null, n: v.length };
    });
    const seasonYears = Object.values(monthsPerYear).filter(n => n >= 8).length;
    const hi = season.filter(x => x.dev != null).reduce((a, b) => b.dev > a.dev ? b : a, { dev: -1e9 });
    const lo = season.filter(x => x.dev != null).reduce((a, b) => b.dev < a.dev ? b : a, { dev: 1e9 });
    const mName = m => new Date(2000, m, 1).toLocaleDateString(undefined, { month: "long" });

    $("#page-body").innerHTML = `<h2>Body</h2>
    <div class="grid">
      ${tile("Latest weight", round(last?.weight, 1), "lb", last ? fmtLong(last.date) : "")}
      ${tile(off ? "Change (this window)" : `Change (${rangeLabel()})`, chg != null ? (chg > 0 ? "+" : "") + round(chg, 1) : "–", "lb", chg != null ? `${round(wtAll[0].weight, 1)} on ${fmtDay(wtAll[0].date)} → ${round(wtAll.at(-1).weight, 1)} on ${fmtDay(wtAll.at(-1).date)}` : "no weigh-ins in this window")}
      ${tile("To goal", last ? round(last.weight - T.weightGoal, 1) : "–", "lb", `goal ~${T.weightGoal} lb by Jul 2027`)}
      ${tile(off ? "Range (this window)" : "Range", wtAll.length ? `${round(Math.min(...wtAll.map(x => x.weight)), 1)}–${round(Math.max(...wtAll.map(x => x.weight)), 1)}` : "–", "lb", `${wtAll.length.toLocaleString()} weigh-ins`)}
    </div>
    <div class="grid">
      <div class="card c12">
        <h3>Weight</h3>
        <p class="sub">${winLabel} · ${weekly ? "weekly averages" : "line = 7-reading average"} · dashed = goal${marks.holidays ? " · shaded = holidays (Nov 20 – Jan 5)" : ""}</p>
        <div class="win-bar">
          ${N ? `<button class="chip" id="win-prev" ${off >= maxOff ? "disabled" : ""} aria-label="Earlier window">◀ Earlier</button>
          <input type="range" id="win-slider" min="0" max="${maxOff}" value="${maxOff - off}" aria-label="Slide through ${N}-day windows">
          <button class="chip" id="win-next" ${off === 0 ? "disabled" : ""} aria-label="Later window">Later ▶</button>
          ${off ? `<button class="chip" id="win-latest">Latest</button>` : ""}` : ""}
          <span class="win-marks">Lines:
            ${["year", "quarter", "month", "holidays"].map(k => `<button class="chip ${marks[k] ? "on" : ""}" data-mark="${k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join("")}
          </span>
        </div>
        ${wt.length ? canvas("bd-wt", "tall") : `<p class="sub">No weigh-ins between ${fmtDay(winStart)} and ${fmtDay(winEnd)}. Slide to another window.</p>`}
      </div>
    </div>
    <div class="grid">
      ${card("c8", "Your typical year", `How each month compares with that year's average · ${seasonYears} years with 8+ months of weigh-ins${hi.n ? ` · heaviest in <b>${mName(hi.m)}</b> (+${round(hi.dev, 1)} lb), lightest in <b>${mName(lo.m)}</b> (${round(lo.dev, 1)} lb)` : ""}`, canvas("bd-season"))}
      ${card("c4", "Profile & goals", "From the Summary tab", `<dl class="kv">${["Goal", "Targets", "Body composition (Kalos DEXA Oct 5, 2026)", "Height", "Age"].filter(k => s[k]).map(k => `<dt>${esc(k.replace(/\s*\(.*\)/, ""))}</dt><dd>${esc(s[k])}${/DEXA/.test(k) ? '<br><span class="sub">DEXA Oct 5, 2026</span>' : ""}</dd>`).join("")}</dl>`)}
    </div>
    <div class="grid">
      ${card("c12", `Weight by year, ${years[0]?.key}–${years.at(-1)?.key}`, "Daily weigh-ins · bar spans lightest to heaviest, dot = average · see History for more", canvas("bd-years", "tall"))}
    </div>`;

    // window controls
    const go = o => { state.bodyOffset = Math.max(0, Math.min(maxOff, o)); render(); };
    if (N) {
      $("#win-prev").onclick = () => go(off + 1);
      $("#win-next").onclick = () => go(off - 1);
      if ($("#win-latest")) $("#win-latest").onclick = () => go(0);
      $("#win-slider").onchange = e => go(maxOff - +e.target.value);
      $("#win-slider").oninput = e => { const o = maxOff - +e.target.value, we = iso(addDays(parse(end), -o * N)); $(".win-bar").title = `${fmtLong(iso(addDays(parse(we), -(N - 1))))} – ${fmtLong(we)}`; };
    }
    document.querySelectorAll("[data-mark]").forEach(b => b.onclick = () => { bodyMarks = { ...marks, [b.dataset.mark]: !marks[b.dataset.mark] }; render(); });

    if (wt.length) {
      const wOpts = baseOpts(); wOpts.scales.y.beginAtZero = false;
      wOpts.plugins.periodMarks = { dates: wt.map(x => x.date), show: marks };
      wOpts.layout = { padding: { top: 14 } };
      chart("bd-wt", { plugins: [periodMarks], data: { labels: wt.map(x => weekly ? `wk ${fmtDay(x.date)} ${x.date.slice(2, 4)}` : fmtDay(x.date) + (N > 90 ? " " + x.date.slice(2, 4) : "")), datasets: weekly ? [
        line("Weekly avg", wt.map(x => x.weight), css("--s1"), { tension: 0.2 }),
        goal("Goal", wt.length, T.weightGoal, css("--good")),
      ] : [
        line("Weigh-in", wt.map(x => x.weight), css("--s1") + "88", { pointRadius: wt.length > 120 ? 1.5 : 3, tension: 0, borderWidth: 1 }),
        line("7-reading avg", rolling(wt.map(x => x.weight), 7), css("--s1")),
        goal("Goal", wt.length, T.weightGoal, css("--good")),
      ] }, options: wOpts });
    }

    const so = baseOpts({ plugins: { ...baseOpts().plugins, legend: { display: false }, tooltip: { ...baseOpts().plugins.tooltip, callbacks: { label: c => season[c.dataIndex].dev == null ? "no data" : `${c.parsed.y > 0 ? "+" : ""}${round(c.parsed.y, 1)} lb vs that year's average (${season[c.dataIndex].n} years)` } } } });
    so.scales.y.beginAtZero = true; so.scales.y.ticks = { ...so.scales.y.ticks, callback: v => (v > 0 ? "+" : "") + v };
    chart("bd-season", { type: "bar", data: { labels: season.map(x => new Date(2000, x.m, 1).toLocaleDateString(undefined, { month: "short" })), datasets: [bar("vs year average", season.map(x => x.dev == null ? null : +x.dev.toFixed(2)), season.map(x => x.dev > 0 ? css("--s2") : css("--s1")), { borderSkipped: "start", maxBarThickness: 32 })] }, options: so });

    const yOpts = baseOpts(); yOpts.scales.y.beginAtZero = false;
    yOpts.plugins.tooltip = { ...yOpts.plugins.tooltip, callbacks: { label: c => c.datasetIndex === 0 ? `Range: ${round(c.raw[0], 1)}–${round(c.raw[1], 1)} lb` : `Average: ${round(c.parsed.y, 1)} lb (${years[c.dataIndex].values.length} days)` } };
    chart("bd-years", { data: { labels: years.map(y => y.key), datasets: [
      bar("Lightest–heaviest", years.map(y => [y.min, y.max]), css("--s1") + "44", { borderSkipped: false, maxBarThickness: 28 }),
      line("Average", years.map(y => +y.avg.toFixed(1)), css("--s1"), { pointRadius: 4, tension: 0 }),
    ] }, options: yOpts });
  }

  // ── Blood pressure (Health Historical Daily: daily average of the day's readings) ──
  function renderBP() {
    const d = state.data, all = d.bp, list = inRange(all);
    const end = lastDate(), N = state.days;
    const prev = N ? window_(all, iso(addDays(parse(end), -N)), N) : [];
    cmpLabel = `prior ${N} days`;
    const sA = avg(list.map(x => x.sys)), dA = avg(list.map(x => x.dia));
    const counts = BP_CATS.map(c => list.filter(x => bpCat(x.sys, x.dia) === c).length);
    const under = list.filter(x => x.sys < 130 && x.dia < 80).length;
    const monthly = list.length > 120;
    const sM = monthly ? groupBy(list, "month", "sys") : null, dM = monthly ? groupBy(list, "month", "dia") : null;
    const years = groupBy(all, "year", "sys").map(g => {
      const rows = all.filter(x => x.date.startsWith(g.key));
      const dd = avg(rows.map(x => x.dia));
      return { year: g.key, n: rows.length, sys: g.avg, dia: dd, cat: bpCat(g.avg, dd).key, maxS: g.max, maxD: Math.max(...rows.map(x => x.dia)), normal: rows.filter(x => bpCat(x.sys, x.dia).key === "Normal").length };
    });
    // weight vs BP: months with both
    const wMo = new Map(groupBy(d.weights, "month", "weight").map(g => [g.key, g.avg]));
    const pairs = groupBy(all, "month", "sys").filter(g => wMo.has(g.key)).map(g => ({ k: g.key, w: wMo.get(g.key), s: g.avg }));
    const r = corr(pairs.map(p => p.w), pairs.map(p => p.s));

    $("#page-bp").innerHTML = `<h2>Blood pressure</h2>
    <p class="sub">Daily averages from the Health Historical Daily tab (${all.length} days with readings, ${fmtLong(all[0]?.date || end)} – ${fmtLong(all.at(-1)?.date || end)}). Categories follow the American Heart Association ranges and are applied to each day's average.</p>
    ${list.length ? `<div class="grid">
      ${bpTile(list, prev, "", "c3")}
      ${tile("Reading days", list.length.toLocaleString(), "", `${rangeLabel()}${list.length ? ` · since ${fmtDay(list[0].date)}${list[0].date.slice(0, 4) !== end.slice(0, 4) ? ", " + list[0].date.slice(0, 4) : ""}` : ""}`)}
      ${tile("Under 130/80", round(under / list.length * 100), "%", `${under} of ${list.length} days in Normal or Elevated`, under / list.length * 100)}
      ${tile("Highest day", bpText(Math.max(...list.map(x => x.sys)), list.find(x => x.sys === Math.max(...list.map(y => y.sys))).dia), "mmHg", fmtLong(list.find(x => x.sys === Math.max(...list.map(y => y.sys))).date))}
    </div>
    <div class="grid">
      ${card("c8", "Systolic and diastolic", `${rangeLabel()} · ${monthly ? "monthly averages" : "each day's average, line = 7-reading average"} · dashed = 130 and 80`, canvas("bp-trend", "tall"))}
      ${card("c4", "Days by category", rangeLabel(), `${canvas("bp-cats", "tall")}`)}
    </div>` : `<p class="sub">No readings in ${rangeLabel()}. Try a longer range.</p>`}
    <div class="grid">
      ${card("c12", "Year by year", "All readings", sortableTable("bp-years", [
        { key: "year", label: "Year" }, { key: "n", label: "Reading days", num: 1 },
        { key: "sys", label: "Avg", num: 1, fmt: (v, r) => bpText(v, r.dia) },
        { key: "cat", label: "Category", fmt: v => { const c = BP_CATS.find(x => x.key === v); return `<span class="swatch" style="background:var(${c.color})"></span>${v}`; } },
        { key: "normal", label: "Normal days", num: 1, fmt: (v, r) => `${v} of ${r.n}` },
        { key: "maxS", label: "Highest", num: 1, fmt: (v, r) => `${Math.round(v)}/${Math.round(r.maxD)}` },
      ], years, "year"))}
    </div>
    ${pairs.length >= 8 && r != null ? `<div class="grid">${card("c12", "Weight and blood pressure", `Monthly averages for ${pairs.length} months with both · correlation ${round(r, 2)} (${Math.abs(r) < 0.3 ? "weak" : Math.abs(r) < 0.6 ? "moderate" : "strong"}${r > 0 ? ", heavier months tend to run higher" : r < 0 ? ", heavier months tend to run lower" : ""})`, canvas("bp-wt", ""))}</div>` : ""}`;

    if (!list.length) return;
    const lbls = monthly ? sM.map(g => fmtMonth(g.key)) : list.map(x => fmtDay(x.date));
    const S = monthly ? sM.map(g => +g.avg.toFixed(1)) : list.map(x => x.sys), D = monthly ? dM.map(g => +g.avg.toFixed(1)) : list.map(x => x.dia);
    const o = baseOpts(); o.scales.y.beginAtZero = false; o.scales.y.suggestedMin = 60; o.scales.y.suggestedMax = 160;
    o.plugins.tooltip = { ...o.plugins.tooltip, filter: i => i.datasetIndex < 2 || !monthly && i.datasetIndex < 4, callbacks: { afterBody: items => { const i = items[0].dataIndex; const c = bpCat(S[i], D[i]); return `${bpText(S[i], D[i])} · ${c.key}${monthly ? ` · ${sM[i].values.length} days` : ""}`; } } };
    chart("bp-trend", { data: { labels: lbls, datasets: [
      ...(monthly ? [
        line("Systolic", S, css("--s2"), { pointRadius: S.length < 40 ? 3 : 0, tension: 0.2 }),
        line("Diastolic", D, css("--s1"), { pointRadius: D.length < 40 ? 3 : 0, tension: 0.2 }),
      ] : [
        line("Systolic (7-reading avg)", rolling(S, 7), css("--s2")),
        line("Diastolic (7-reading avg)", rolling(D, 7), css("--s1")),
        line("Systolic", S, css("--s2") + "66", { showLine: false, pointRadius: 3, pointHoverRadius: 5 }),
        line("Diastolic", D, css("--s1") + "66", { showLine: false, pointRadius: 3, pointHoverRadius: 5 }),
      ]),
      goal("130", lbls.length, 130, css("--muted")), goal("80", lbls.length, 80, css("--muted")),
    ] }, options: { ...o, plugins: { ...o.plugins, legend: { ...o.plugins.legend, labels: { ...o.plugins.legend.labels, filter: it => !/^\d+$/.test(it.text) && !(!monthly && !/avg/.test(it.text)) } } } } });

    const shown = BP_CATS.map((c, i) => ({ c, n: counts[i] })).filter(x => x.n);
    const co = baseOpts({ indexAxis: "y", interaction: { mode: "nearest", axis: "y", intersect: false } });
    co.scales = { x: { ...co.scales.y }, y: { ...co.scales.x, ticks: { color: css("--ink-2") } } };
    co.plugins.legend = { display: false };
    co.plugins.tooltip = { ...co.plugins.tooltip, callbacks: { label: c => `${c.parsed.x} days (${round(c.parsed.x / list.length * 100)}%) · ${shown[c.dataIndex].c.tip}` } };
    chart("bp-cats", { type: "bar", data: { labels: shown.map(x => x.c.key), datasets: [bar("Days", shown.map(x => x.n), shown.map(x => css(x.c.color)), { maxBarThickness: 28 })] }, options: co });

    if (pairs.length >= 8 && r != null) {
      const po = baseOpts({ interaction: { mode: "nearest", intersect: true } });
      po.scales.x = { ...po.scales.x, type: "linear", title: { display: true, text: "Weight (lb, monthly avg)", color: css("--muted") } };
      po.scales.y = { ...po.scales.y, beginAtZero: false, title: { display: true, text: "Systolic (monthly avg)", color: css("--muted") } };
      po.plugins.legend = { display: false };
      po.plugins.tooltip = { ...po.plugins.tooltip, callbacks: { label: c => `${fmtMonth(pairs[c.dataIndex].k)}: ${round(pairs[c.dataIndex].w, 1)} lb, ${Math.round(pairs[c.dataIndex].s)} systolic` } };
      chart("bp-wt", { type: "scatter", data: { datasets: [{ data: pairs.map(p => ({ x: p.w, y: p.s })), backgroundColor: css("--s2"), pointRadius: 5, pointHoverRadius: 7, borderColor: css("--surface"), borderWidth: 1.5 }] }, options: po });
    }
  }

  // ── Insights: the "so what?" layer ─────────────────────────
  // Every metric gets a status (on track / needs work / off track) and an action bucket.
  const STATUS = {
    green: { label: "On track", icon: "✓", color: "--good" },
    amber: { label: "Needs work", icon: "!", color: "--warn" },
    red:   { label: "Off track", icon: "✕", color: "--critical" },
  };
  function renderInsights() {
    const d = state.data, end = lastDate();
    const N = state.days || 30, endD = parse(end);
    const start = iso(addDays(endD, -(N - 1))), prevEnd = iso(addDays(endD, -N));
    const W = list => window_(list, end, N), P = list => { const w = window_(list, prevEnd, N); return w.length >= 0.7 * N ? w : null; };
    const PW = list => list.length && list[0].date <= iso(addDays(endD, -(2 * N - 1))) ? window_(list, prevEnd, N) : null; // event logs (workouts)
    const wFirst0 = d.workouts[0]?.date || end;
    const weeks = (daysBetween(parse(wFirst0 > start ? wFirst0 : start), endD) + 1) / 7; // same per-week rule as Overview/Training
    const goalTxt = d.summary["Goal"] || "";
    const races = d.races.filter(r => r.d >= today() && r.registered && !r.considering);
    const bigSur = races.find(r => /big sur/i.test(r.name)) || races[0];
    const wksToRace = bigSur ? Math.max(0, Math.floor(daysBetween(today(), bigSur.d) / 7)) : null;
    const rows = [];
    const add = r => rows.push(r);
    const trend = (cur, prev, digits, unit, goodUp) => {
      if (cur == null || prev == null) return "";
      const dlt = cur - prev; if (Math.abs(dlt) < Math.pow(10, -digits) / 2) return "flat";
      const good = goodUp == null ? null : (dlt > 0) === goodUp;
      return `<span class="${good == null ? "" : good ? "up-good" : "up-bad"}">${dlt > 0 ? "▲" : "▼"} ${round(Math.abs(dlt), digits)}${unit}</span>`;
    };

    // 1. Sleep
    const sh = W(d.sleepHistory), shp = P(d.sleepHistory);
    const sAvg = avg(sh.map(x => x.hours)), sPrev = shp && avg(shp.map(x => x.hours));
    const gs = W(d.sleep), poor = gs.filter(x => x.label === "POOR").length;
    const bedAvg = avg(gs.map(x => x.bedRel).filter(x => x != null));
    if (sAvg != null) add({ key: "sleep", name: "Sleep", more: true, prio: 1,
      status: sAvg >= T.sleepHours ? "green" : sAvg >= T.sleepHours - 0.5 ? "amber" : "red",
      value: hhmm(sAvg * 60), target: `${T.sleepHours} h`, trend: trend(sAvg && sAvg * 60, sPrev && sPrev * 60, 0, " min", true),
      detail: `${sh.filter(x => x.hours >= T.sleepHours).length} of ${sh.length} nights ≥ ${T.sleepHours} h · ${poor} POOR nights · avg bedtime ${fmtBed(bedAvg)}`,
      action: `Lights out by 10:30 PM. Your average bedtime is ${fmtBed(bedAvg)}; you need about ${Math.max(0, Math.round((T.sleepHours - sAvg) * 60))} more minutes a night.` });

    // 2. Protein
    const nu = W(d.nutrition).filter(x => x.kcal > 1000), nup = (P(d.nutrition) || []).filter(x => x.kcal > 1000);
    const pAvg = avg(nu.map(x => x.protein)), pPrev = nup.length ? avg(nup.map(x => x.protein)) : null;
    const best = nu.filter(x => x.protein >= T.protein).sort((a, b) => Math.abs(a.kcal - T.kcal) - Math.abs(b.kcal - T.kcal))[0];
    if (pAvg != null) add({ key: "protein", name: "Protein", more: true, prio: 2,
      status: pAvg >= T.protein ? "green" : pAvg >= T.protein - 15 ? "amber" : "red",
      value: `${round(pAvg)} g`, target: `${T.protein} g`, trend: trend(pAvg, pPrev, 0, " g", true),
      detail: `${nu.filter(x => x.protein >= T.protein).length} of ${nu.length} days ≥ ${T.protein} g${best ? ` · best balance ${fmtDay(best.date)}: ${round(best.kcal)} kcal, ${round(best.protein)} g` : ""}`,
      action: `Add about ${round(Math.max(0, T.protein - pAvg))} g of protein a day — one shake or Greek yogurt at breakfast closes it.` });

    // 3. Calories (maintenance phase: net intake = food − exercise vs ${T.kcal})
    const net = avg(nu.map(x => x.kcal - (x.burn || 0))), netPrev = nup.length ? avg(nup.map(x => x.kcal - (x.burn || 0))) : null;
    const gross = avg(nu.map(x => x.kcal)), diff = net - T.kcal;
    if (net != null) add({ key: "calories", name: "Calories (net of exercise)", more: diff < 0, prio: 4,
      status: Math.abs(diff) <= 150 ? "green" : Math.abs(diff) <= 350 ? "amber" : "red",
      value: `${round(net)} kcal`, target: `${T.kcal.toLocaleString()} (maintenance)`, trend: trend(net, netPrev, 0, " kcal", null),
      detail: `${diff >= 0 ? "+" : ""}${round(diff)} kcal/day vs target · gross intake ${round(gross)} kcal`,
      action: diff > 0 ? `Trim about ${round(diff)} kcal a day — late-night snacks are the easiest place to start.` : `You're ${round(-diff)} kcal a day under maintenance; add a snack on training days so you can build muscle.` });

    // 4. Weight (build phase: stay steady near goal). Smoothed: first vs last 5 weigh-ins, so one odd reading can't swing it.
    const wt = W(d.weights), k5 = Math.min(5, Math.floor(wt.length / 2));
    const wA = k5 ? avg(wt.slice(0, k5).map(x => x.weight)) : null, wB = k5 ? avg(wt.slice(-k5).map(x => x.weight)) : null;
    const chg = wA != null ? wB - wA : null, allow = 1.5 * N / 30;
    if (chg != null) add({ key: "weight", name: "Weight trend", more: false, prio: 6,
      status: Math.abs(chg) <= allow ? "green" : "amber",
      value: `${round(wt.at(-1).weight, 1)} lb`, target: `steady · ~${T.weightGoal} lb by Jul 2027`, trend: `<span>${chg > 0 ? "▲" : chg < 0 ? "▼" : ""} ${round(Math.abs(chg), 1)} lb</span>`,
      detail: `average of first 5 weigh-ins ${round(wA, 1)} → last 5 ${round(wB, 1)} lb · ${wt.length} weigh-ins · ${round(wt.at(-1).weight - T.weightGoal, 1)} lb from goal`,
      action: chg > allow ? "Weight is creeping up; bring net calories back to maintenance." : chg < -allow ? `Dropping faster than a build phase wants, and you're already ${round(wt.at(-1).weight - T.weightGoal, 1)} lb from goal. Hold here: eat a little more on big training days.` : "Holding steady, which is what a build phase wants." });

    // 5. Training volume
    const wo = W(d.workouts), wop = PW(d.workouts);
    const hrs = sum(wo.map(w => w.min)) / 60 / weeks, hrsPrev = wop ? sum(wop.map(w => w.min)) / 60 / weeks : null;
    add({ key: "training", name: "Training volume", more: true, prio: 5,
      status: hrs >= 5 ? "green" : hrs >= 3 ? "amber" : "red",
      value: `${round(hrs, 1)} h/week`, target: "5+ h/week", trend: trend(hrs, hrsPrev, 1, " h", true),
      detail: `${wo.length} sessions on ${new Set(wo.map(w => w.date)).size} days · ${round(sum(wo.map(w => w.kcal)))} kcal`,
      action: "Keep the weekly rhythm; it's your strongest habit." });

    // 6. Run volume for the next marathon
    const runs = wo.filter(w => w.sport === "Run"), runMi = sum(runs.map(w => w.mi)), runWk = runMi / weeks;
    const runTarget = wksToRace == null ? 15 : wksToRace > 16 ? 15 : wksToRace > 8 ? 25 : 30;
    const longest = runs.reduce((a, b) => (b.min || 0) > (a?.min || 0) ? b : a, null);
    if (bigSur) add({ key: "run", name: `Run volume (${bigSur.name.replace(/ Marathon$/i, "")})`, more: true, prio: 3,
      status: runWk >= runTarget ? "green" : runWk >= 0.6 * runTarget ? "amber" : "red",
      value: `${round(runWk, 1)} mi/week`, target: `${runTarget}+ mi/week now`,
      trend: "", detail: `${runs.length} runs, ${round(runMi, 1)} mi in ${N} days · longest ${longest ? `${hhmm(longest.min)} (${fmtDay(longest.date)})` : "–"} · ${wksToRace} weeks to race day`,
      action: `Add one easy run a week and a Sunday long run, building toward ${runTarget} mi/week. Swims and rides count for the 70.3, but the marathon needs miles on your feet.` });

    // 7. Strength
    const str = wo.filter(w => w.sport === "Strength"), perWk = str.length / weeks;
    add({ key: "strength", name: "Strength sessions", more: true, prio: 4,
      status: perWk >= 2 ? "green" : perWk >= 1 ? "amber" : "red",
      value: `${round(perWk, 1)}/week`, target: "2+/week (Coach M plan)", trend: "",
      detail: `${str.length} sessions in ${N} days`,
      action: "Lock in two Coach M strength days a week; that's what builds lean mass in Phase 1." });

    // 8. Steps
    const st = W(d.steps); const stAvg = avg(st.map(x => x.steps)), stp = P(d.steps), stPrev = stp && avg(stp.map(x => x.steps));
    const notes = [];
    if (st.length && st.length < 0.5 * N) notes.push(`Steps left out: only ${st.length} of ${N} days are in the sheet so far (latest ${fmtDay(st.at(-1).date)}).`);
    if (st.length >= 0.5 * N) add({ key: "steps", name: "Steps", more: true, prio: 7,
      status: stAvg >= T.steps ? "green" : stAvg >= 7500 ? "amber" : "red",
      value: round(stAvg), target: T.steps.toLocaleString(), trend: trend(stAvg, stPrev, 0, "", true),
      detail: `${st.filter(x => x.steps >= T.steps).length} of ${st.length} days ≥ ${T.steps.toLocaleString()} · latest ${fmtDay(st.at(-1).date)}`,
      action: "Add a 15-minute walk after dinner on rest days." });

    // 9. Blood pressure
    const bp = W(d.bp);
    if (bp.length) { const bs = avg(bp.map(x => x.sys)), bd = avg(bp.map(x => x.dia)), c = bpCat(bs, bd);
      add({ key: "bp", name: "Blood pressure", more: false, prio: 8,
        status: c.key === "Normal" ? "green" : c.key === "Elevated" || c.key === "Stage 1" ? "amber" : "red",
        value: bpText(bs, bd), target: "under 120/80", trend: "",
        detail: `${c.key} on average · ${bp.filter(x => bpCat(x.sys, x.dia).key === "Normal").length} of ${bp.length} reading days in the Normal range · latest ${bpText(bp.at(-1).sys, bp.at(-1).dia)} on ${fmtDay(bp.at(-1).date)} · ${bp.filter(x => x.sys >= 140 || x.dia >= 90).length} days at 140/90+`,
        action: "Keep measuring a few mornings a week; share the BP page with your doctor at your next visit." }); }

    // 10. Late-night eating
    const items = W(d.foodItems), nightK = sum(items.filter(i => i.meal === "night").map(i => i.kcal)), totK = sum(items.map(i => i.kcal));
    if (totK) { const share = nightK / totK * 100;
      add({ key: "night", name: "Late-night eating", more: false, prio: 5,
        status: share <= 5 ? "green" : share <= 10 ? "amber" : "red",
        value: `${round(share)}%`, target: "under 5% of calories", trend: "",
        detail: `${round(nightK)} kcal across ${new Set(items.filter(i => i.meal === "night").map(i => i.date)).size} nights`,
        action: "Kitchen closes at 9 PM; it helps both sleep and calories." }); }

    rows.forEach(r => r.bucket = r.status === "green" ? "Keep" : r.status === "amber" ? "Improve" : r.more ? "Accelerate" : "Ease off");
    const rank = { red: 0, amber: 1, green: 2 };
    const top = rows.filter(r => r.status !== "green").sort((a, b) => rank[a.status] - rank[b.status] || a.prio - b.prio).slice(0, 3);
    const bucketOrder = ["Accelerate", "Improve", "Ease off", "Keep"];

    // cross-links (use all Garmin-era data so there are enough nights)
    const minsBy = {}; for (const w of d.workouts) minsBy[w.date] = (minsBy[w.date] || 0) + (w.min || 0);
    const firstW = d.workouts[0]?.date;
    const nights = d.sleep.filter(s => firstW && s.date >= firstW && s.date < end);
    const shortN = nights.filter(s => s.sleepMin < 360), goodN = nights.filter(s => s.sleepMin >= 390);
    const after = list => avg(list.map(s => minsBy[s.date] || 0));
    const shortMin = after(shortN), goodMin = after(goodN);
    const surplus = sum(nu.map(x => x.kcal - (x.burn || 0) - T.kcal));
    const expect = surplus / 3500;

    const pill = s => `<span class="rag ${s}"><b>${STATUS[s].icon}</b>${STATUS[s].label}</span>`;
    $("#page-insights").innerHTML = `<h2>Insights</h2>
    <p class="sub">${state.days ? `Last ${N} days (${fmtDay(start)} – ${fmtDay(end)})` : `Last 30 days (pick 7d / 90d / 1y above to change)`}, compared with the period before where there's enough data. ${goalTxt ? `Goal: ${esc(goalTxt)}.` : ""} ${bigSur ? `Next race: <b>${esc(bigSur.name)}</b>, ${fmtLong(bigSur.date)} (${wksToRace} weeks).` : ""}</p>
    <div class="grid">
      ${card("c12", "Top 3 actions", "What would move the needle most right now", top.length ? `<ol class="actions">${top.map(r => `<li>${pill(r.status)} <b>${esc(r.name)}:</b> ${r.action}</li>`).join("")}</ol>` : "<p>Everything is on track. Keep doing what you're doing.</p>")}
    </div>
    <div class="grid">
      ${card("c12", "Scorecard", "Green = keep, amber = improve, red = accelerate or ease off", `<div class="table-wrap"><table class="scorecard"><thead><tr><th>Status</th><th>Metric</th><th class="n">Now</th><th>Target</th><th>vs before</th><th>Do</th><th>Detail</th></tr></thead><tbody>
        ${rows.slice().sort((a, b) => bucketOrder.indexOf(a.bucket) - bucketOrder.indexOf(b.bucket) || a.prio - b.prio).map(r => `<tr><td>${pill(r.status)}</td><td><b>${esc(r.name)}</b></td><td class="n">${r.value}</td><td>${esc(r.target)}</td><td>${r.trend || "–"}</td><td><span class="pill">${r.bucket}</span></td><td class="wrap">${r.detail}</td></tr>`).join("")}
      </tbody></table></div>`)}
    </div>
    ${notes.length ? `<p class="sub">${notes.join(" ")}</p>` : ""}
    <div class="grid">
      ${card("c6", "Sleep → training", `${nights.length} nights since ${firstW ? fmtDay(firstW) : "–"}`, shortN.length >= 3 && goodN.length >= 3 ? `<p class="big">After short nights (under 6 h) you trained <b>${round(shortMin)} min</b> the next day on average, vs <b>${round(goodMin)} min</b> after 6½ h or more.</p><p class="sub">${shortN.length} short nights, ${goodN.length} longer nights. ${goodMin > shortMin ? "More sleep goes with more training." : "Training holds up even after short nights, but recovery and strength still pay the price."}</p>` : `<p class="sub">Not enough nights yet.</p>`)}
      ${card("c6", "Calories → weight", rangeLabel(), chg != null && nu.length ? `<p class="big">Your logged net calories add up to <b>${expect >= 0 ? "+" : ""}${round(expect, 1)} lb</b> over these ${N} days; the scale moved <b>${chg >= 0 ? "+" : ""}${round(chg, 1)} lb</b>.</p><p class="sub">${Math.abs(expect - chg) <= 1.5 ? "They roughly agree, so your food log is a good guide." : "They don't match closely; your true maintenance may differ from the 2,004 kcal plan, or some food or exercise isn't logged."} Based on 3,500 kcal ≈ 1 lb.</p>` : `<p class="sub">Not enough data yet.</p>`)}
    </div>`;
  }

  // ── History: every day since 2013 from the Health Historical Daily tab ──
  let histYears = 0; // 0 = all
  function renderHistory() {
    const d = state.data;
    const lastD = d.weights.at(-1)?.date > d.steps.at(-1)?.date ? d.weights.at(-1).date : d.steps.at(-1)?.date || lastDate();
    const from = histYears ? iso(addDays(parse(lastD), -365 * histYears)) : "0000";
    const W = d.weights.filter(x => x.date >= from), S = d.steps.filter(x => x.date >= from), Z = d.sleepHistory.filter(x => x.date >= from);
    const period = "month";
    const wM = groupBy(W, period, "weight"), sM = groupBy(S, period, "steps"), zM = groupBy(Z, period, "hours");
    const B = d.bp.filter(x => x.date >= from), bpS = groupBy(B, "month", "sys"), bpD = groupBy(B, "month", "dia");
    const yrKeys = [...new Set([...d.weights, ...d.steps, ...d.sleepHistory].map(x => x.date.slice(0, 4)))].sort().reverse();
    const yrRows = yrKeys.map(y => {
      const w = d.weights.filter(x => x.date.startsWith(y)), st = d.steps.filter(x => x.date.startsWith(y)), z = d.sleepHistory.filter(x => x.date.startsWith(y));
      const best = st.reduce((a, b) => (b.steps > (a?.steps || 0) ? b : a), null);
      const b = d.bp.filter(x => x.date.startsWith(y));
      return { year: y, bpS: avg(b.map(x => x.sys)), bpD: avg(b.map(x => x.dia)), bpN: b.length, wAvg: avg(w.map(x => x.weight)), wMin: w.length ? Math.min(...w.map(x => x.weight)) : null, wMax: w.length ? Math.max(...w.map(x => x.weight)) : null,
        stAvg: avg(st.map(x => x.steps)), st10k: st.filter(x => x.steps >= T.steps).length, stDays: st.length, mi: sum(st.map(x => x.mi)),
        zAvg: avg(z.map(x => x.hours)), z7: z.filter(x => x.hours >= T.sleepHours).length, zN: z.length, bestDay: best?.date, bestSteps: best?.steps };
    });
    const yrsWithSteps = yrRows.filter(r => r.stDays >= 200), yrsWithSleep = yrRows.filter(r => r.zN >= 150);
    const bestStepYr = yrsWithSteps.reduce((a, b) => (b.stAvg > (a?.stAvg || 0) ? b : a), null);
    const bestSleepYr = yrsWithSleep.reduce((a, b) => (b.zAvg > (a?.zAvg || 0) ? b : a), null);
    const thisYr = yrRows[0];
    const span = `${fmtLong(W[0]?.date || S[0]?.date || lastD)} – ${fmtLong(lastD)}`;

    $("#page-history").innerHTML = `<h2>History</h2>
    <div class="filters" id="hist-range">${[[1, "1 year"], [3, "3 years"], [5, "5 years"], [0, "All since 2013"]].map(([y, l]) => `<button class="chip ${y === histYears ? "on" : ""}" data-y="${y}">${l}</button>`).join("")}</div>
    <p class="sub">${span} · Google Health (Fitbit/Aria) history merged with your Garmin and DailyStats data; where both have a day, DailyStats and the Sleep tab win.</p>
    <div class="grid">
      ${tile("Avg weight", W.length ? round(avg(W.map(x => x.weight)), 1) : "–", "lb", W.length ? `${W.length.toLocaleString()} weigh-ins · range ${round(Math.min(...W.map(x => x.weight)), 1)}–${round(Math.max(...W.map(x => x.weight)), 1)} lb` : "")}
      ${tile("Avg steps", round(avg(S.map(x => x.steps))), "/day", `${S.filter(x => x.steps >= T.steps).length.toLocaleString()} of ${S.length.toLocaleString()} days ≥ ${T.steps.toLocaleString()}`)}
      ${tile("Avg sleep", hhmm(avg(Z.map(x => x.hours)) * 60), "", `${Z.filter(x => x.hours >= T.sleepHours).length.toLocaleString()} of ${Z.length.toLocaleString()} nights ≥ ${T.sleepHours} h`)}
      ${tile("Distance walked/run", round(sum(S.map(x => x.mi))), "mi", "from step tracking")}
    </div>
    <div class="grid">${card("c12", "Long-term patterns", "", `<ul class="insights">
      ${bestStepYr ? li("info", "★", `Most active year: <b>${bestStepYr.year}</b>, averaging <b>${round(bestStepYr.stAvg)}</b> steps/day${thisYr?.stAvg ? ` (this year: ${round(thisYr.stAvg)})` : ""}.`) : ""}
      ${bestSleepYr ? li("info", "z", `Best sleep year: <b>${bestSleepYr.year}</b> at <b>${hhmm(bestSleepYr.zAvg * 60)}</b> a night.${yrsWithSleep.some(r => r.zAvg >= T.sleepHours) ? "" : ` No year has averaged ${T.sleepHours} h`}${thisYr?.zAvg ? `; this year is ${hhmm(thisYr.zAvg * 60)}` : ""}.`) : ""}
      ${(() => { const r = yrRows.filter(x => x.wAvg); if (r.length < 2) return ""; const lo = r.reduce((a, b) => b.wAvg < a.wAvg ? b : a), hi = r.reduce((a, b) => b.wAvg > a.wAvg ? b : a); return li("info", "lb", `Lightest year on average: <b>${lo.year}</b> (${round(lo.wAvg, 1)} lb); heaviest: <b>${hi.year}</b> (${round(hi.wAvg, 1)} lb). Your ${T.weightGoal} lb goal is ${T.weightGoal < lo.wAvg ? "below every yearly average so far" : "within your historical range"}.`); })()}
    </ul>`)}</div>
    <div class="grid">${card("c12", "Weight by month", "Monthly average · dashed = goal", canvas("hi-wt", "tall"))}</div>
    <div class="grid">
      ${card("c6", "Steps by month", `Average per day · dashed = ${T.steps.toLocaleString()}`, canvas("hi-steps"))}
      ${card("c6", "Sleep by month", `Average hours asleep · dashed = ${T.sleepHours} h`, canvas("hi-sleep"))}
    </div>
    ${bpS.length ? `<div class="grid">${card("c12", "Blood pressure by month", "Monthly average · dashed = 130 / 80 · details on the BP page", canvas("hi-bp"))}</div>` : ""}
    <div class="grid">${card("c12", "Year by year", "All years · click a column to sort", sortableTable("hi-years", [
      { key: "year", label: "Year" },
      { key: "wAvg", label: "Avg lb", num: 1, fmt: v => v ? round(v, 1) : "–" }, { key: "wMin", label: "Min lb", num: 1, fmt: v => v ? round(v, 1) : "–" }, { key: "wMax", label: "Max lb", num: 1, fmt: v => v ? round(v, 1) : "–" },
      { key: "stAvg", label: "Steps/day", num: 1, fmt: v => v ? round(v) : "–" }, { key: "st10k", label: "10k+ days", num: 1, fmt: (v, r) => r.stDays ? `${v} of ${r.stDays}` : "–" },
      { key: "mi", label: "Miles", num: 1, fmt: v => v ? round(v) : "–" },
      { key: "zAvg", label: "Sleep/night", num: 1, fmt: v => v ? hhmm(v * 60) : "–" }, { key: "z7", label: "7h+ nights", num: 1, fmt: (v, r) => r.zN ? `${v} of ${r.zN}` : "–" },
      { key: "bpS", label: "Avg BP", num: 1, fmt: (v, r) => v ? `${bpText(v, r.bpD)} <span class="sub">${r.bpN} d</span>` : "–" },
      { key: "bestSteps", label: "Biggest day", num: 1, fmt: (v, r) => v ? `${round(v)} <span class="sub">${fmtDay(r.bestDay)}</span>` : "–" },
    ], yrRows, "year"))}</div>`;

    $("#hist-range").onclick = e => { const b = e.target.closest(".chip"); if (!b) return; histYears = +b.dataset.y; render(); };

    const lbl = arr => arr.map(g => fmtMonth(g.key));
    const o1 = baseOpts(); o1.scales.y.beginAtZero = false;
    o1.plugins.tooltip = { ...o1.plugins.tooltip, callbacks: { label: c => c.datasetIndex === 0 ? `Avg ${round(c.parsed.y, 1)} lb (${wM[c.dataIndex].values.length} weigh-ins, ${round(wM[c.dataIndex].min, 1)}–${round(wM[c.dataIndex].max, 1)})` : `Goal ${T.weightGoal} lb` } };
    o1.plugins.legend = { display: false };
    chart("hi-wt", { data: { labels: lbl(wM), datasets: [line("Weight", wM.map(g => +g.avg.toFixed(1)), css("--s1"), { tension: 0.2, pointRadius: wM.length < 40 ? 3 : 0 }), goal("Goal", wM.length, T.weightGoal, css("--good"))] }, options: o1 });
    const o2 = baseOpts({ plugins: { ...baseOpts().plugins, legend: { display: false } } });
    chart("hi-steps", { data: { labels: lbl(sM), datasets: [goal("10k", sM.length, T.steps, css("--good")), bar("Steps/day", sM.map(g => Math.round(g.avg)), sM.map(g => g.avg >= T.steps ? css("--s6") : css("--s6") + "88"), { maxBarThickness: 14 })] }, options: o2 });
    const o3 = baseOpts({ plugins: { ...baseOpts().plugins, legend: { display: false }, tooltip: { ...baseOpts().plugins.tooltip, callbacks: { label: c => c.datasetIndex === 1 ? `${hhmm(c.parsed.y * 60)} avg (${zM[c.dataIndex].values.length} nights)` : `${T.sleepHours} h target` } } } });
    o3.scales.y.suggestedMax = 8;
    if (bpS.length) {
      const ob = baseOpts(); ob.scales.y.beginAtZero = false; ob.scales.y.suggestedMin = 60;
      ob.plugins.legend.labels = { ...ob.plugins.legend.labels, filter: it => !/^\d+$/.test(it.text) };
      chart("hi-bp", { data: { labels: bpS.map(g => fmtMonth(g.key)), datasets: [
        line("Systolic", bpS.map(g => +g.avg.toFixed(1)), css("--s2"), { pointRadius: bpS.length < 40 ? 3 : 0, tension: 0.2 }),
        line("Diastolic", bpD.map(g => +g.avg.toFixed(1)), css("--s1"), { pointRadius: bpD.length < 40 ? 3 : 0, tension: 0.2 }),
        goal("130", bpS.length, 130, css("--muted")), goal("80", bpS.length, 80, css("--muted")),
      ] }, options: ob });
    }
    chart("hi-sleep", { data: { labels: lbl(zM), datasets: [goal("7 h", zM.length, T.sleepHours, css("--good")), bar("Hours", zM.map(g => +g.avg.toFixed(2)), css("--s7"), { maxBarThickness: 14 })] }, options: o3 });
  }

  let raceFilter = "real";
  function renderRaces() {
    const d = state.data, now = today();
    const races = d.races;
    const upcoming = races.filter(r => r.d >= now);
    // "Run" = confirmed finishes + races registered for with the result not yet checked
    const done = races.filter(r => !r.possible && r.d < now && (r.completed || r.likely));
    const conf = done.filter(r => r.completed), likely = done.filter(r => !r.completed);
    const years = [...new Set(done.map(r => r.d.getFullYear()))].sort();
    const cats = ["Half marathon", "Marathon", "Triathlon", "70.3", "Other"].filter(c => done.some(r => r.category === c));
    const catColor = { "Half marathon": css("--s1"), Marathon: css("--s2"), Triathlon: css("--s3"), "70.3": css("--s7"), Other: css("--other") };
    const cnt = (list, f) => list.filter(f).length;
    const split = f => { const a = cnt(conf, f), b = cnt(likely, f); return b ? `${a} confirmed + ${b} likely` : `${a} confirmed`; };
    const isTri = r => /Triathlon|70\.3/.test(r.category) || /aquathon/i.test(r.kind || "");
    const reg = upcoming.filter(r => r.registered && !r.considering), cons = upcoming.filter(r => r.considering);

    $("#page-races").innerHTML = `<h2>Races</h2>
    <p class="sub">Counts include races marked <b>Completed</b> or <b>Partial</b> plus <b>likely</b> finishes (status "Check result" or "finish not confirmed"). Races marked "likely did not run", "Did not start" and Fitbit-only possible days are left out.</p>
    <div class="grid">
      ${tile("Races run", done.length, "", `${conf.length} confirmed + ${likely.length} likely · since ${years[0] || "–"}`)}
      ${tile("Half marathons", cnt(done, r => r.category === "Half marathon"), "", split(r => r.category === "Half marathon"))}
      ${tile("Triathlons & aquathons", cnt(done, isTri), "", split(isTri))}
      ${tile("Coming up", reg.length + cons.length, "", `${reg.length} registered${cons.length ? ` · ${cons.length} considering / in drawing` : ""}${reg[0] ? ` · next: ${esc(reg[0].name)}` : ""}`)}
    </div>
    <div class="grid">
      ${card("c6", "Coming up", "Everything on the race list from today, including ones you're considering", `<div class="race-list">${upcoming.map(r => raceRow(r).replace('<div class="meta">', `<div class="meta"><span class="pill">${esc(r.status)}</span> `)).join("")}</div>`)}
      ${card("c6", "Races run per year", "Solid = confirmed, light = likely (result not checked)", canvas("rc-years", "tall"))}
    </div>
    <div class="grid">${card("c12", "Race history", "", `<div class="filters" id="rc-filters">
      <button class="chip ${raceFilter === "real" ? "on" : ""}" data-f="real">All races</button>
      <button class="chip ${raceFilter === "done" ? "on" : ""}" data-f="done">Run (confirmed + likely)</button>
      <button class="chip ${raceFilter === "all" ? "on" : ""}" data-f="all">Include possible (Fitbit) days</button></div><div id="rc-table"></div>`)}</div>`;

    const drawTable = () => {
      const rows = races.filter(r => raceFilter === "all" ? true : raceFilter === "done" ? done.includes(r) : !r.possible).map(r => ({ ...r, _cls: r.completed || (r.likely && r.d < now) ? "done" : "" }));
      $("#rc-table").innerHTML = sortableTable("rc-t", [
        { key: "date", label: "Date", fmt: v => fmtLong(v) }, { key: "name", label: "Race", cls: "wrap" },
        { key: "location", label: "Location" }, { key: "category", label: "Type" }, { key: "status", label: "Status", cls: "wrap" },
        { key: "finish", label: "Finish", cls: "wrap" },
      ], rows);
    };
    drawTable();
    $("#rc-filters").onclick = e => { const b = e.target.closest(".chip"); if (!b) return; raceFilter = b.dataset.f; $("#rc-filters").querySelectorAll(".chip").forEach(c => c.classList.toggle("on", c === b)); drawTable(); };

    const o = baseOpts(); o.scales.x.stacked = true; o.scales.y.stacked = true; o.scales.y.ticks.stepSize = 1;
    o.plugins.tooltip = { ...o.plugins.tooltip, filter: i => i.parsed.y > 0 };
    o.plugins.legend.labels = { ...o.plugins.legend.labels, filter: it => !/likely/.test(it.text) };
    const ds = [];
    for (const c of cats) {
      ds.push(bar(c, years.map(y => conf.filter(r => r.category === c && r.d.getFullYear() === y).length), catColor[c], { borderRadius: 0, borderColor: css("--surface"), borderWidth: { top: 2 }, maxBarThickness: 36 }));
      if (likely.some(r => r.category === c)) ds.push(bar(`${c} (likely)`, years.map(y => likely.filter(r => r.category === c && r.d.getFullYear() === y).length), catColor[c] + "66", { borderRadius: 0, borderColor: css("--surface"), borderWidth: { top: 2 }, maxBarThickness: 36 }));
    }
    chart("rc-years", { type: "bar", data: { labels: years, datasets: ds }, options: o });
  }

  // ── analytics (GoatCounter: no cookies, no personal data) ────
  const GC = CFG.goatcounter;
  const gcQueue = [];
  function track(path, title, event) {
    if (!GC) return;
    const send = () => window.goatcounter.count({ path, title: title || path, event: !!event });
    window.goatcounter && window.goatcounter.count ? send() : gcQueue.push(send);
  }
  if (GC) {
    window.goatcounter = { no_onload: true, allow_local: false };
    const sc = document.createElement("script");
    sc.async = true; sc.src = "https://gc.zgo.at/count.js";
    sc.dataset.goatcounter = `https://${GC}.goatcounter.com/count`;
    sc.onload = () => { while (gcQueue.length) gcQueue.shift()(); };
    document.head.appendChild(sc);
    // one listener for every button/chip/tab click: "click: <section> / <label>"
    document.addEventListener("click", e => {
      const el = e.target.closest("button, .chip, #tabs a, a[href]");
      if (!el) return;
      const label = (el.dataset.days != null ? (+el.dataset.days ? el.textContent : "All") : el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40);
      const where = el.closest("#tabs") ? "tab" : el.closest("#range") ? "range" : el.id === "theme" ? "theme" : el.id === "reload" ? "reload" : el.id === "sheet-link" ? "sheet-link" : state.page;
      track(`click: ${where} / ${label}`, null, true);
    }, true);
  }
  let lastTracked = null;

  // ── shell ───────────────────────────────────────────────────
  const PAGES = { training: renderTraining, overview: renderOverview, nutrition: renderNutrition, sleep: renderSleep, body: renderBody, bp: renderBP, history: renderHistory, races: renderRaces, insights: renderInsights };

  function render() {
    state.charts.forEach(c => c.destroy()); state.charts = []; clearInterval(hlTimer);
    state.page = PAGES[location.hash.slice(1)] ? location.hash.slice(1) : "training"; // landing page
    document.querySelectorAll("#tabs a").forEach(a => a.classList.toggle("on", a.getAttribute("href") === "#" + state.page));
    document.querySelectorAll("#range button").forEach(b => b.classList.toggle("on", +b.dataset.days === state.days));
    $("#range").style.display = state.page === "history" || state.page === "races" ? "none" : "";
    document.querySelectorAll("section.page").forEach(s => s.classList.toggle("on", s.id === "page-" + state.page));
    if (lastTracked !== state.page) { lastTracked = state.page; track(`/${state.page}`, `${state.page[0].toUpperCase()}${state.page.slice(1)} · Fitness Dashboard`); }
    try { PAGES[state.page](); } catch (e) { console.error(e); $("#page-" + state.page).innerHTML = `<p class="sub">Couldn't draw this page: ${esc(e.message)}</p>`; }
  }

  async function load() {
    $("#app").innerHTML = '<p class="loading">Loading your data…</p>';
    state.data = await FD_DATA.loadAll();
    $("#app").innerHTML = Object.keys(PAGES).map(p => `<section class="page" id="page-${p}"></section>`).join("");
    const src = Object.values(state.data.sources);
    const live = src.filter(s => s === "live").length;
    $("#source").innerHTML = live === src.length
      ? `<span class="dot" style="background:var(--good)"></span>Live from Google Sheet`
      : live ? `<span class="dot" style="background:var(--warn)"></span>${live}/${src.length} tabs live, rest from snapshot`
      : `<span class="dot" style="background:var(--muted)"></span>Snapshot · data through ${fmtLong(lastDate())}`;
    const lastOf = l => l.length ? fmtDay(l.at(-1).date) : "–", D0 = state.data;
    $("#source").title = `Latest per source — sleep ${lastOf(D0.sleep)}, food ${lastOf(D0.nutrition)}, workouts ${lastOf(D0.workouts)}, weight ${lastOf(D0.weights)}, steps ${lastOf(D0.steps)}, BP ${lastOf(D0.bp)}`;
    $("#source").innerHTML += ` <span class="fresh">· weight ${lastOf(D0.weights)} · steps ${lastOf(D0.steps)} · BP ${lastOf(D0.bp)}</span>`;
    $("#foot-note").textContent = `Data through ${fmtLong(lastDate())}. Food values are estimates; * = estimated workout calories.`;
    render();
  }

  // festive banner (dates in config, visitor's local date)
  (function festive() {
    const f = CFG.festive, el = $("#festive");
    if (!f || !el) return;
    const today = iso(new Date());
    if (today < f.start || today > f.end) return;
    el.hidden = false;
    // "×" hides it for this visit only; it shows again on every new visit during the festive week
    $("#festive-close").onclick = () => { el.hidden = true; };
  })();

  // theme
  try { const t = localStorage.getItem("fd-theme"); if (t) document.documentElement.dataset.theme = t; } catch {}
  $("#theme").onclick = () => {
    const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("fd-theme", document.documentElement.dataset.theme); } catch {}
    render();
  };
  try { const r = localStorage.getItem("fd-range"); if (r != null) state.days = +r; } catch {}
  $("#range").onclick = e => { const b = e.target.closest("button"); if (!b) return; state.days = +b.dataset.days; state.bodyOffset = 0; bodyMarks = null; try { localStorage.setItem("fd-range", state.days); } catch {} render(); };
  $("#reload").onclick = load;
  $("#sheet-link").href = CFG.sheetUrl;
  addEventListener("hashchange", render);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", render);
  load();
})();
