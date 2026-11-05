// ─────────────────────────────────────────────────────────────
// Fitness Dashboard configuration
// ─────────────────────────────────────────────────────────────
// LIVE DATA: In Google Sheets choose File → Share → Publish to web,
// pick "Entire document" + "Comma-separated values (.csv)", publish,
// and paste the link's ID (the part after /d/e/ and before /pub) below.
// Then fill in each tab's gid (click the tab; the URL ends in #gid=NNNN).
// Any tab left null is read from the snapshot in /data instead.
// ─────────────────────────────────────────────────────────────
window.FD_CONFIG = {
  // The ID from the "Publish to web" link: https://docs.google.com/spreadsheets/d/e/<PUBLISHED_ID>/pub?output=csv
  publishedId: null,

  // Your sheet (used for the "Open sheet" link only)
  sheetUrl: "https://docs.google.com/spreadsheets/d/1MLtoN2pkTAJv7D6osOBqUXlF9D48U0sztjvwiLI9e3Q/edit",

  // gid of each tab. Snapshot file in /data is used when live fetch fails or gid is null.
  tabs: {
    summary:      { name: "Summary",          gid: null, file: "data/summary.csv" },
    workouts:     { name: "Workouts",         gid: null, file: "data/workouts.csv" },
    dailystats:   { name: "DailyStats",       gid: null, file: "data/dailystats.csv" },
    foodlog:      { name: "Food Log (items)", gid: null, file: "data/foodlog.csv" },
    sleep:        { name: "Sleep",            gid: null, file: "data/sleep.csv" },
    naps:         { name: "Naps",             gid: null, file: "data/naps.csv" },
    racelist:     { name: "racelist",         gid: null, file: "data/racelist.csv" },
    googleHealth: { name: "Google Health",    gid: null, file: "data/google-health.csv" },
    healthDaily:  { name: "Health Historical Daily", gid: null, file: "data/health-daily.csv" },
  },

  // Targets used for goal lines and "days on target" counts
  targets: {
    kcal: 2004,          // FITTR plan
    protein: 140,        // Coach Mohana's goal (g/day)
    proteinFittr: 120,   // FITTR plan protein
    carbs: 248,
    fat: 60,
    sleepHours: 7,
    steps: 10000,
    weightGoal: 160,     // lb, by Jul 2027
    lateNightHour: 21,   // food logged as "night"/"late night" counts as late-night eating
  },
};
