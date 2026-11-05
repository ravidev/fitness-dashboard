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
  const rangeLabel = () => state.days ? `last ${state.days} days` : "all data";
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
  function renderOverview() {
    const d = state.data, end = lastDate();
    // Period follows the range buttons; "All" spans the full Garmin/food-log era with no comparison
    const firstDay = [d.sleep[0]?.date, d.nutrition[0]?.date, d.workouts[0]?.date].filter(Boolean).sort()[0] || end;
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
    const n7 = window_(d.nutrition, end, N).filter(x => x.kcal > 1000), n7p = P(d.nutrition).filter(x => x.kcal > 1000);
    const w7 = window_(d.workouts, end, N), w7p = P(d.workouts);
    const orNull = v => (v == null || isNaN(v)) ? null : v;
    const sleepAvg = avg(s7.map(x => x.sleepMin)), sleepPrev = orNull(avg(s7p.map(x => x.sleepMin)));
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
    const nights7 = s7.filter(x => x.sleepMin >= T.sleepHours * 60).length;
    const st7 = window_(d.steps, end, N), stepAvg = avg(st7.map(x => x.steps)), stepPrev = orNull(avg(P(d.steps).map(x => x.steps)));
    const burnWk = sum(w7.map(x => x.kcal)) / weeks;
    const title = N === 7 ? "This week" : state.days ? `Last ${N} days` : "All data";
    const periodWord = state.days ? `over ${N} days` : `since ${fmtDay(firstDay)}`;
    const joinD = (...parts) => parts.filter(Boolean).join(" · ");

    const upcoming = d.races.filter(r => r.d >= today() && r.registered).slice(0, 4);

    let html = `<h2>${title} <span class="sub" style="font-weight:400">· ${state.days ? `${N} days ending ${fmtLong(end)}${cmp ? `; arrows compare with the ${N} days before when both periods have data` : ""}` : `${fmtLong(firstDay)} – ${fmtLong(end)}`}</span></h2>
    <div class="grid">
      ${tile("Avg sleep", hhmm(sleepAvg), "", deltaText(sleepAvg && sleepAvg / 60, sleepPrev && sleepPrev / 60, " h", true, 1), sleepAvg / (T.sleepHours * 60) * 100)}
      ${tile("Avg sleep score", round(scoreAvg), "/100", deltaText(scoreAvg, scorePrev, " pts", true))}
      ${tile("Avg protein", round(prot), "g", joinD(`${protDays} of ${n7.length} days ≥ ${T.protein} g`, deltaText(prot, protPrev, " g", true)), prot / T.protein * 100)}
      ${tile("Avg intake", round(kcal), "kcal", deltaText(kcal, kcalPrev, " kcal", null))}
      ${tile("Training", round(hrs, 1), "h/week", joinD(`${w7.length} sessions`, deltaText(hrs, hrsPrev, " h", true, 1)))}
      ${tile("Weight", wt ? round(wt.weight, 1) : "–", "lb", wt && wStart && wStart.date !== wt.date ? `<span class="${wt.weight <= wStart.weight ? "down-good" : "up-bad"}">${wt.weight <= wStart.weight ? "▼" : "▲"} ${round(Math.abs(wt.weight - wStart.weight), 1)} lb</span> ${periodWord} · goal ${T.weightGoal}` : `goal ${T.weightGoal}`)}
      ${tile("Nights ≥ 7 h", nights7, ` of ${s7.length}`, `HRV avg ${round(avg(s7.map(x => x.hrv)))} ms · ${round(burnWk)} kcal exercise/week`)}
      ${tile("Avg steps", round(stepAvg), "/day", joinD(`${st7.filter(x => x.steps >= T.steps).length} of ${st7.length} days ≥ ${T.steps.toLocaleString()}`, deltaText(stepAvg, stepPrev, "", true)), stepAvg / T.steps * 100)}
    </div>
    <div class="grid">
      ${card("c7", "What the data says", `Patterns across ${rangeLabel()}`, `<ul class="insights">${insights().join("")}</ul>`)}
      ${card("c5", "Upcoming races", "Registered entries", `<div class="race-list">${upcoming.map(raceRow).join("") || "<p class='sub'>None</p>"}</div>`)}
    </div>
    <div class="grid">
      ${card("c6", "Sleep score", rangeLabel(), canvas("ov-sleep", "short"))}
      ${card("c6", "Protein per day", `${rangeLabel()} · dashed = ${T.protein} g goal`, canvas("ov-prot", "short"))}
    </div>`;
    $("#page-overview").innerHTML = html;

    const sl = inRange(d.sleep);
    chart("ov-sleep", { type: "bar", data: { labels: sl.map(x => fmtDay(x.date)), datasets: [bar("Score", sl.map(x => x.score), sl.map(x => scoreColor(x.score)))] }, options: baseOpts({ plugins: { ...baseOpts().plugins, legend: { display: false } }, scales: { ...baseOpts().scales, y: { ...baseOpts().scales.y, max: 100 } } }) });
    const nu = inRange(d.nutrition);
    chart("ov-prot", { data: { labels: nu.map(x => fmtDay(x.date)), datasets: [bar("Protein (g)", nu.map(x => x.protein), css("--s3")), goal("Goal", nu.length, T.protein)] }, options: baseOpts({ plugins: { ...baseOpts().plugins, legend: { display: false } } }) });
  }

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
    const d = state.data, out = [];
    const sl = inRange(d.sleep), nu = inRange(d.nutrition);
    // bedtime vs score
    const early = sl.filter(x => x.bedRel != null && x.bedRel < 6), late = sl.filter(x => x.bedRel != null && x.bedRel >= 6);
    if (early.length >= 3 && late.length >= 3) {
      const a = avg(early.map(x => x.score)), b = avg(late.map(x => x.score));
      const ma = avg(early.map(x => x.sleepMin)), mb = avg(late.map(x => x.sleepMin));
      out.push(li(a > b ? "good" : "info", "◐", `Nights in bed <b>before midnight</b> average a score of <b>${round(a)}</b> and ${hhmm(ma)} asleep, vs <b>${round(b)}</b> and ${hhmm(mb)} after midnight (${early.length} vs ${late.length} nights).`));
    }
    const short = sl.filter(x => x.sleepMin < T.sleepHours * 60).length;
    if (sl.length) out.push(li(short / sl.length > 0.5 ? "bad" : "warn", "z", `<b>${short} of ${sl.length}</b> nights were under ${T.sleepHours} h. Average ${hhmm(avg(sl.map(x => x.sleepMin)))}, ${hhmm(T.sleepHours * 60 - avg(sl.map(x => x.sleepMin)))} short of target.`));
    const full = nu.filter(x => x.kcal > 1000);
    if (full.length) {
      const hit = full.filter(x => x.protein >= T.protein).length;
      const pAvg = avg(full.map(x => x.protein));
      out.push(li(hit / full.length >= 0.5 ? "good" : "warn", "P", `Protein hit ${T.protein} g on <b>${hit} of ${full.length}</b> days (avg ${round(pAvg)} g). Closing the gap is about <b>${round(Math.max(0, T.protein - pAvg))} g/day</b>, roughly one protein shake.`));
      const kAvg = avg(full.map(x => x.kcal)), bAvg = avg(full.map(x => x.burn));
      out.push(li("info", "k", `Average intake <b>${round(kAvg)} kcal</b> vs FITTR's ${T.kcal.toLocaleString()} target; with ~${round(bAvg)} kcal of logged exercise, net is about <b>${round(kAvg - bAvg)}</b>.`));
    }
    // late-night eating
    const items = inRange(d.foodItems);
    const night = sum(items.filter(i => i.meal === "night").map(i => i.kcal)), tot = sum(items.map(i => i.kcal));
    if (tot) out.push(li(night / tot > 0.1 ? "warn" : "good", "☾", `Late-night eating is <b>${round(night / tot * 100)}%</b> of logged calories (${round(night)} kcal across ${new Set(items.filter(i => i.meal === "night").map(i => i.date)).size} nights).`));
    // training load vs next night's sleep
    const burnByDay = {}; for (const w of d.workouts) burnByDay[w.date] = (burnByDay[w.date] || 0) + (w.kcal || 0);
    const pairs = sl.map(s => ({ burn: burnByDay[iso(addDays(parse(s.date), -1))] || 0, score: s.score }));
    const big = pairs.filter(p => p.burn >= 600), small = pairs.filter(p => p.burn < 600);
    if (big.length >= 3 && small.length >= 3) out.push(li("info", "↯", `After big training days (≥600 kcal) the next night scores <b>${round(avg(big.map(p => p.score)))}</b> vs <b>${round(avg(small.map(p => p.score)))}</b> after lighter days.`));
    return out;
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
      ${card("c8", "Protein", `dashed = ${T.protein} g goal (Mohana) · dotted = ${T.proteinFittr} g (FITTR)`, canvas("nu-prot"))}
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
  function renderTraining() {
    const d = state.data, wo = inRange(d.workouts);
    const bySport = Object.fromEntries(SPORTS.map(s => [s, wo.filter(w => w.sport === s)]));
    const present = SPORTS.filter(s => bySport[s].length);
    const totals = s => ({ n: bySport[s].length, min: sum(bySport[s].map(w => w.min)), mi: sum(bySport[s].map(w => w.mi)), kcal: sum(bySport[s].map(w => w.kcal)) });
    // weeks
    const weeks = [...new Set(wo.map(w => weekStart(w.date)))].sort();
    const rowsFor = () => trainFilter === "All" ? wo : wo.filter(w => w.sport === trainFilter);

    $("#page-training").innerHTML = `<h2>Training</h2>
    <div class="grid">
      ${tile("Sessions", wo.length, "", `${new Set(wo.map(w => w.date)).size} active days · ${rangeLabel()}`)}
      ${tile("Time", round(sum(wo.map(w => w.min)) / 60, 1), "h", `${round(sum(wo.map(w => w.min)) / 60 / Math.max(1, weeks.length), 1)} h per week`)}
      ${tile("Activity burn", round(sum(wo.map(w => w.kcal))), "kcal", `${wo.filter(w => w.estimated).length} sessions estimated, rest from watch`)}
      ${tile("Swim · Bike · Run", `${round(totals("Swim").mi, 1)} · ${round(totals("Bike").mi)} · ${round(totals("Run").mi, 1)}`, "mi", "distance logged")}
    </div>
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
        { key: "sport", label: "Sport", fmt: (v, r) => `<span class="swatch" style="background:${sportColor(v)}"></span>${esc(r.type)}${r.race ? ' <span class="pill">race</span>' : ""}` },
        { key: "desc", label: "Description", cls: "wrap" },
        { key: "min", label: "Time", num: 1, fmt: v => v ? hhmm(v) : "–" },
        { key: "mi", label: "Miles", num: 1, fmt: v => v ? round(v, 2) : "–" },
        { key: "hr", label: "Avg HR", num: 1, fmt: v => v || "–" },
        { key: "kcal", label: "kcal", num: 1, fmt: (v, r) => `${round(v)}${r.estimated ? "*" : ""}` },
      ], rowsFor());
    };
    drawLog();
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

  function renderBody() {
    const d = state.data, wtAll = inRange(d.weights), s = d.summary;
    // long ranges: weekly averages keep the chart readable
    const weekly = wtAll.length > 150;
    const wt = weekly ? groupBy(wtAll, "week", "weight").map(g => ({ date: g.key, weight: +g.avg.toFixed(1) })) : wtAll;
    const last = d.weights.at(-1);
    const years = groupBy(d.weights, "year", "weight");
    $("#page-body").innerHTML = `<h2>Body</h2>
    <div class="grid">
      ${tile("Latest weight", round(last?.weight, 1), "lb", last ? fmtLong(last.date) : "")}
      ${tile(`Change (${rangeLabel()})`, wtAll.length > 1 ? (wtAll.at(-1).weight - wtAll[0].weight > 0 ? "+" : "") + round(wtAll.at(-1).weight - wtAll[0].weight, 1) : "–", "lb", wtAll.length > 1 ? `from ${round(wtAll[0].weight, 1)} on ${fmtDay(wtAll[0].date)}` : "")}
      ${tile("To goal", last ? round(last.weight - T.weightGoal, 1) : "–", "lb", `goal ~${T.weightGoal} lb by Jul 2027`)}
      ${tile("Range", wtAll.length ? `${round(Math.min(...wtAll.map(x => x.weight)), 1)}–${round(Math.max(...wtAll.map(x => x.weight)), 1)}` : "–", "lb", `${wtAll.length.toLocaleString()} weigh-ins`)}
    </div>
    <div class="grid">
      ${card("c8", "Weight", `${rangeLabel()} · ${weekly ? "weekly averages" : "line = 7-reading average"} · dashed = goal`, canvas("bd-wt", "tall"))}
      ${card("c4", "Profile & goals", "From the Summary tab", `<dl class="kv">${["Goal", "Targets", "Body composition (Kalos DEXA Oct 5, 2026)", "Height", "Age"].filter(k => s[k]).map(k => `<dt>${esc(k.replace(/\s*\(.*\)/, ""))}</dt><dd>${esc(s[k])}${/DEXA/.test(k) ? '<br><span class="sub">DEXA Oct 5, 2026</span>' : ""}</dd>`).join("")}</dl>`)}
    </div>
    <div class="grid">
      ${card("c12", `Weight by year, ${years[0]?.key}–${years.at(-1)?.key}`, "Daily weigh-ins · bar spans lightest to heaviest, dot = average · see History for more", canvas("bd-years", "tall"))}
    </div>`;

    const wOpts = baseOpts(); wOpts.scales.y.beginAtZero = false;
    chart("bd-wt", { data: { labels: wt.map(x => weekly ? `wk ${fmtDay(x.date)}${state.days ? "" : " " + x.date.slice(2, 4)}` : fmtDay(x.date)), datasets: weekly ? [
      line("Weekly avg", wt.map(x => x.weight), css("--s1"), { tension: 0.2 }),
      goal("Goal", wt.length, T.weightGoal, css("--good")),
    ] : [
      line("Weigh-in", wt.map(x => x.weight), css("--s1") + "88", { pointRadius: 3, tension: 0, borderWidth: 1 }),
      line("7-reading avg", rolling(wt.map(x => x.weight), 7), css("--s1")),
      goal("Goal", wt.length, T.weightGoal, css("--good")),
    ] }, options: wOpts });

    const yOpts = baseOpts(); yOpts.scales.y.beginAtZero = false;
    yOpts.plugins.tooltip = { ...yOpts.plugins.tooltip, callbacks: { label: c => c.datasetIndex === 0 ? `Range: ${round(c.raw[0], 1)}–${round(c.raw[1], 1)} lb` : `Average: ${round(c.parsed.y, 1)} lb (${years[c.dataIndex].values.length} days)` } };
    chart("bd-years", { data: { labels: years.map(y => y.key), datasets: [
      bar("Lightest–heaviest", years.map(y => [y.min, y.max]), css("--s1") + "44", { borderSkipped: false, maxBarThickness: 28 }),
      line("Average", years.map(y => +y.avg.toFixed(1)), css("--s1"), { pointRadius: 4, tension: 0 }),
    ] }, options: yOpts });
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
    const yrKeys = [...new Set([...d.weights, ...d.steps, ...d.sleepHistory].map(x => x.date.slice(0, 4)))].sort().reverse();
    const yrRows = yrKeys.map(y => {
      const w = d.weights.filter(x => x.date.startsWith(y)), st = d.steps.filter(x => x.date.startsWith(y)), z = d.sleepHistory.filter(x => x.date.startsWith(y));
      const best = st.reduce((a, b) => (b.steps > (a?.steps || 0) ? b : a), null);
      return { year: y, wAvg: avg(w.map(x => x.weight)), wMin: w.length ? Math.min(...w.map(x => x.weight)) : null, wMax: w.length ? Math.max(...w.map(x => x.weight)) : null,
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
      ${tile("Weigh-ins", W.length.toLocaleString(), "", W.length ? `avg ${round(avg(W.map(x => x.weight)), 1)} lb · ${round(Math.min(...W.map(x => x.weight)), 1)}–${round(Math.max(...W.map(x => x.weight)), 1)}` : "")}
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
    <div class="grid">${card("c12", "Year by year", "All years · click a column to sort", sortableTable("hi-years", [
      { key: "year", label: "Year" },
      { key: "wAvg", label: "Avg lb", num: 1, fmt: v => v ? round(v, 1) : "–" }, { key: "wMin", label: "Min lb", num: 1, fmt: v => v ? round(v, 1) : "–" }, { key: "wMax", label: "Max lb", num: 1, fmt: v => v ? round(v, 1) : "–" },
      { key: "stAvg", label: "Steps/day", num: 1, fmt: v => v ? round(v) : "–" }, { key: "st10k", label: "10k+ days", num: 1, fmt: (v, r) => r.stDays ? `${v} of ${r.stDays}` : "–" },
      { key: "mi", label: "Miles", num: 1, fmt: v => v ? round(v) : "–" },
      { key: "zAvg", label: "Sleep/night", num: 1, fmt: v => v ? hhmm(v * 60) : "–" }, { key: "z7", label: "7h+ nights", num: 1, fmt: (v, r) => r.zN ? `${v} of ${r.zN}` : "–" },
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
    chart("hi-sleep", { data: { labels: lbl(zM), datasets: [goal("7 h", zM.length, T.sleepHours, css("--good")), bar("Hours", zM.map(g => +g.avg.toFixed(2)), css("--s7"), { maxBarThickness: 14 })] }, options: o3 });
  }

  let raceFilter = "real";
  function renderRaces() {
    const d = state.data, now = today();
    const races = d.races;
    const upcoming = races.filter(r => r.d >= now);
    const done = races.filter(r => r.completed && !r.possible);
    const years = [...new Set(done.map(r => r.d.getFullYear()))].sort();
    const cats = ["Half marathon", "Marathon", "Triathlon", "70.3", "Other"].filter(c => done.some(r => r.category === c));
    const catColor = { "Half marathon": css("--s1"), Marathon: css("--s2"), Triathlon: css("--s3"), "70.3": css("--s7"), Other: css("--other") };

    $("#page-races").innerHTML = `<h2>Races</h2>
    <div class="grid">
      ${tile("Upcoming (registered)", upcoming.filter(r => r.registered).length, "", upcoming.filter(r => r.registered)[0] ? `next: ${esc(upcoming.filter(r => r.registered)[0].name)}` : "")}
      ${tile("Completed races", done.length, "", `since ${years[0] || "–"}`)}
      ${tile("Marathons", done.filter(r => r.category === "Marathon").length, "", "completed")}
      ${tile("Triathlons", done.filter(r => /Triathlon|70\.3/.test(r.category)).length, "", "completed or partial")}
    </div>
    <div class="grid">
      ${card("c6", "Coming up", "Everything on the race list from today", `<div class="race-list">${upcoming.map(r => raceRow(r).replace('<div class="meta">', `<div class="meta"><span class="pill">${esc(r.status)}</span> `)).join("")}</div>`)}
      ${card("c6", "Completed races per year", "", canvas("rc-years", "tall"))}
    </div>
    <div class="grid">${card("c12", "Race history", "", `<div class="filters" id="rc-filters">
      <button class="chip ${raceFilter === "real" ? "on" : ""}" data-f="real">Races</button>
      <button class="chip ${raceFilter === "done" ? "on" : ""}" data-f="done">Completed</button>
      <button class="chip ${raceFilter === "all" ? "on" : ""}" data-f="all">Include possible (Fitbit) days</button></div><div id="rc-table"></div>`)}</div>`;

    const drawTable = () => {
      const rows = races.filter(r => raceFilter === "all" ? true : raceFilter === "done" ? r.completed && !r.possible : !r.possible).map(r => ({ ...r, _cls: r.completed ? "done" : "" }));
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
    chart("rc-years", { type: "bar", data: { labels: years, datasets: cats.map(c => bar(c, years.map(y => done.filter(r => r.category === c && r.d.getFullYear() === y).length), catColor[c], { borderRadius: 0, borderColor: css("--surface"), borderWidth: { top: 2 }, maxBarThickness: 36 })) }, options: o });
  }

  // ── shell ───────────────────────────────────────────────────
  const PAGES = { overview: renderOverview, sleep: renderSleep, nutrition: renderNutrition, training: renderTraining, body: renderBody, history: renderHistory, races: renderRaces };

  function render() {
    state.charts.forEach(c => c.destroy()); state.charts = [];
    state.page = PAGES[location.hash.slice(1)] ? location.hash.slice(1) : "overview";
    document.querySelectorAll("#tabs a").forEach(a => a.classList.toggle("on", a.getAttribute("href") === "#" + state.page));
    document.querySelectorAll("#range button").forEach(b => b.classList.toggle("on", +b.dataset.days === state.days));
    $("#range").style.display = state.page === "history" || state.page === "races" ? "none" : "";
    document.querySelectorAll("section.page").forEach(s => s.classList.toggle("on", s.id === "page-" + state.page));
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
    $("#foot-note").textContent = `Data through ${fmtLong(lastDate())}. Food values are estimates; * = estimated workout calories.`;
    render();
  }

  // theme
  try { const t = localStorage.getItem("fd-theme"); if (t) document.documentElement.dataset.theme = t; } catch {}
  $("#theme").onclick = () => {
    const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("fd-theme", document.documentElement.dataset.theme); } catch {}
    render();
  };
  try { const r = localStorage.getItem("fd-range"); if (r != null) state.days = +r; } catch {}
  $("#range").onclick = e => { const b = e.target.closest("button"); if (!b) return; state.days = +b.dataset.days; try { localStorage.setItem("fd-range", state.days); } catch {} render(); };
  $("#reload").onclick = load;
  $("#sheet-link").href = CFG.sheetUrl;
  addEventListener("hashchange", render);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", render);
  load();
})();
