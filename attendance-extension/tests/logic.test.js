const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadLogic() {
  const logicPath = path.resolve(__dirname, "../logic.js");
  const source = fs.readFileSync(logicPath, "utf8");
  const sandbox = { console, globalThis: {} };
  sandbox.window = sandbox.globalThis;
  vm.runInNewContext(source, sandbox, { filename: logicPath });
  return sandbox.globalThis.AttendanceLogic;
}

const Logic = loadLogic();

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function policy(overrides = {}) {
  return Logic.resolveWorkPolicy(overrides);
}

{
  const valid = Logic.parseDateStrict("22/05/2026");
  assert.equal(Logic.toISODate(valid), "2026-05-22");
  assert.equal(Logic.parseDateStrict("31/02/2026"), null);
  assert.equal(Logic.parseDateStrict("2026-02-31"), null);
}

{
  assert.equal(Logic.convertWorkedTime("24:15:45"), "24:15");
  assert.equal(Logic.convertWorkedTime("09:75"), null);
  assert.equal(Logic.convertWorkedTime("00:00:00"), null);
}

{
  const context = Logic.buildWeekContext({
    policy: policy({
      dailyWorkHours: 8,
      workingDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    }),
    today: new Date(2026, 4, 1),
  });

  assert.deepEqual(plain(context.validDates.map((d) => Logic.toISODate(d))), [
    "2026-05-01",
    "2026-05-02",
  ]);
  assert.equal(context.isMonthBoundary, true);
}

{
  const context = Logic.buildWeekContext({
    policy: policy(),
    today: new Date(2026, 4, 20),
  });

  const extracted = Logic.normalizeAttendanceRows([
    { date: null, day: "Wed", time: "08:30:00" },
  ], context);

  assert.deepEqual(plain(Object.keys(extracted.entries)), ["2026-05-20"]);
  assert.deepEqual(plain(extracted.data), { Wed: "08:30" });

  const summary = Logic.computeAttendanceSummary({
    entries: extracted.entries,
    data: extracted.data,
    todayLogin: { found: true, time24: "09:30", raw: "09:30 AM" },
    context,
  });

  assert.equal(summary.totalWorked, "08:30");
  assert.equal(summary.required, "45:00");
  assert.equal(summary.todayRemainingFormatted, "18:30");
  assert.equal(summary.logoutTime, "28:00");
}

{
  const existing = {
    Mon: { type: "worked", hours: 8 },
    Tue: { type: "worked", hours: 10 },
    Sat: { type: "worked", hours: 6 },
  };

  const merged = Logic.mergeTrackerWeekData({
    existing,
    attendanceData: { Mon: "09:30" },
    refreshDays: ["Mon", "Tue", "Wed", "Thu", "Fri"],
  });

  assert.deepEqual(plain(merged), {
    Mon: { type: "worked", hours: 9.5 },
    Sat: { type: "worked", hours: 6 },
  });
}

console.log("attendance-extension logic tests passed");
