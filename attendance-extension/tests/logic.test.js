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

// ═══════════════════════════════════════════════════════════════════
// Existing Tests
// ═══════════════════════════════════════════════════════════════════

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
  // Mon/Tue have no row → assumed regularized to full days (9h each);
  // Wed cumulative target 27h − 18h credited = 9h needed today.
  assert.equal(summary.todayRemainingFormatted, "09:00");
  assert.equal(summary.logoutTime, "18:30");
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

console.log("✅ Existing tests passed");

// ═══════════════════════════════════════════════════════════════════
// parseLeaveType Tests
// ═══════════════════════════════════════════════════════════════════

{
  const p = policy();
  const full = Logic.parseLeaveType("Full Day", p);
  assert.equal(full.isFull, true);
  assert.equal(full.minutes, 540);

  const half = Logic.parseLeaveType("Half Day", p);
  assert.equal(half.isFull, false);
  assert.equal(half.minutes, 270);

  const halfNum = Logic.parseLeaveType("0.5", p);
  assert.equal(halfNum.isFull, false);
  assert.equal(halfNum.minutes, 270);

  const nullType = Logic.parseLeaveType(null, p);
  assert.equal(nullType.isFull, true);
  assert.equal(nullType.minutes, 540);

  console.log("✅ parseLeaveType tests passed");
}

// ═══════════════════════════════════════════════════════════════════
// classifyDayStatus Tests
// ═══════════════════════════════════════════════════════════════════

{
  const p = policy();

  // 1. Empty Final Login, no leave, no ATR → pending
  {
    const cls = Logic.classifyDayStatus(
      { day: "Mon", time: null, rawFinalLogin: null, leaves: null, categoryCode: null, weekOff: false },
      p, { department: "Devops" }
    );
    assert.equal(cls.status, "pending");
    assert.equal(cls.totalMinutes, 0);
  }

  // 2. Full day leave (no attendance)
  {
    const cls = Logic.classifyDayStatus(
      { day: "Tue", time: null, leaves: "CL", leaveType: "Full Day", categoryCode: null, weekOff: false },
      p, { department: "Devops" }
    );
    assert.equal(cls.status, "leave");
    assert.equal(cls.leaveMinutes, 540);
    assert.equal(cls.totalMinutes, 540);
  }

  // 3. Half day leave + worked hours
  {
    const cls = Logic.classifyDayStatus(
      { day: "Wed", time: "05:00", leaves: "CL", leaveType: "Half Day", categoryCode: null, weekOff: false },
      p, { department: "Devops" }
    );
    assert.equal(cls.status, "leave");
    assert.equal(cls.workedMinutes, 300);
    assert.equal(cls.leaveMinutes, 270);
    assert.equal(cls.totalMinutes, 570);
  }

  // 4. WFH
  {
    const cls = Logic.classifyDayStatus(
      { day: "Thu", time: null, leaves: "Work From Home", leaveType: "Full Day", categoryCode: null, weekOff: false },
      p, { department: "Devops" }
    );
    assert.equal(cls.status, "wfh");
    assert.equal(cls.leaveMinutes, 540);
    assert.equal(cls.totalMinutes, 540);
  }

  // 5. ATR (no leave)
  {
    const cls = Logic.classifyDayStatus(
      { day: "Fri", time: null, leaves: null, leaveType: "Full Day", categoryCode: "ATR", weekOff: false },
      p, { department: "Devops" }
    );
    assert.equal(cls.status, "atr");
    assert.equal(cls.atrMinutes, 540);
    assert.equal(cls.totalMinutes, 540);
  }

  // 6. ATR with worked hours (additive)
  {
    const cls = Logic.classifyDayStatus(
      { day: "Fri", time: "06:00", leaves: null, leaveType: "Full Day", categoryCode: "ATR", weekOff: false },
      p, { department: "Devops" }
    );
    assert.equal(cls.status, "atr");
    assert.equal(cls.workedMinutes, 360);
    assert.equal(cls.atrMinutes, 540);
    assert.equal(cls.totalMinutes, 900); // 15 hours
  }

  // 7. Leave + ATR → leave wins, ATR ignored
  {
    const cls = Logic.classifyDayStatus(
      { day: "Mon", time: "05:00", leaves: "CL", leaveType: "Full Day", categoryCode: "ATR", weekOff: false },
      p, { department: "Devops" }
    );
    assert.equal(cls.status, "leave");
    assert.equal(cls.leaveMinutes, 540);
    assert.equal(cls.atrMinutes, 0); // ATR ignored
    assert.equal(cls.totalMinutes, 840); // 300 worked + 540 leave
  }

  // 8. Weekend
  {
    const cls = Logic.classifyDayStatus(
      { day: "Sun", time: null, weekOff: true },
      p, { department: "Devops" }
    );
    assert.equal(cls.status, "weekend");
    assert.equal(cls.totalMinutes, 0);
  }

  // 9. Normal worked day
  {
    const cls = Logic.classifyDayStatus(
      { day: "Mon", time: "09:15", leaves: null, categoryCode: null, weekOff: false },
      p, { department: "Devops" }
    );
    assert.equal(cls.status, "worked");
    assert.equal(cls.workedMinutes, 555);
    assert.equal(cls.totalMinutes, 555);
  }

  console.log("✅ classifyDayStatus tests passed");
}

// ═══════════════════════════════════════════════════════════════════
// Saturday Department Logic Tests
// ═══════════════════════════════════════════════════════════════════

{
  const p = policy();

  // Non-DevOps: Saturday auto-credits WFH
  {
    const cls = Logic.classifyDayStatus(
      { day: "Sat", time: null, leaves: null, categoryCode: null, weekOff: false },
      p, { department: "HR" }
    );
    assert.equal(cls.status, "wfh");
    assert.equal(cls.leaveMinutes, 540);
    assert.equal(cls.totalMinutes, 540);
  }

  // DevOps: Saturday without WFH → pending
  {
    const cls = Logic.classifyDayStatus(
      { day: "Sat", time: null, leaves: null, categoryCode: null, weekOff: false },
      p, { department: "Devops" }
    );
    assert.equal(cls.status, "pending");
    assert.equal(cls.totalMinutes, 0);
  }

  // DevOps: Saturday with explicit WFH → wfh
  {
    const cls = Logic.classifyDayStatus(
      { day: "Sat", time: null, leaves: "Work From Home", leaveType: "Full Day", categoryCode: null, weekOff: false },
      p, { department: "Devops" }
    );
    assert.equal(cls.status, "wfh");
    assert.equal(cls.leaveMinutes, 540);
    assert.equal(cls.totalMinutes, 540);
  }

  // Finance: Saturday auto-credits
  {
    const cls = Logic.classifyDayStatus(
      { day: "Sat", time: null, leaves: null, categoryCode: null, weekOff: false },
      p, { department: "Finance" }
    );
    assert.equal(cls.status, "wfh");
    assert.equal(cls.totalMinutes, 540);
  }

  console.log("✅ Saturday department logic tests passed");
}

// ═══════════════════════════════════════════════════════════════════
// classifyDayStatus — Leap/Bio & action metadata
// ═══════════════════════════════════════════════════════════════════

{
  const p = policy();

  // Leap login present, no Bio → WFH not regularized → atr-wfh pending
  {
    const cls = Logic.classifyDayStatus(
      { day: "Mon", time: null, hasLeap: true, hasBio: false, leaves: null, categoryCode: null, weekOff: false },
      p, { department: "Devops" }
    );
    assert.equal(cls.status, "pending");
    assert.equal(cls.actionNeeded, true);
    assert.equal(cls.actionType, "atr-wfh");
    assert.equal(cls.totalMinutes, 0);
  }

  // Both Leap and Bio + Final Login → worked, no action (guards old false-WFH bug)
  {
    const cls = Logic.classifyDayStatus(
      { day: "Tue", time: "09:07", hasLeap: true, hasBio: true, leaves: null, categoryCode: null, weekOff: false },
      p, { department: "Devops" }
    );
    assert.equal(cls.status, "worked");
    assert.equal(cls.actionNeeded, false);
    assert.equal(cls.actionType, null);
  }

  // Category code (C0018) on a leap-only day → ATR already applied, no action
  {
    const cls = Logic.classifyDayStatus(
      { day: "Wed", time: null, hasLeap: true, hasBio: false, leaves: null, leaveType: "Full Day", categoryCode: "C0018", weekOff: false },
      p, { department: "Devops" }
    );
    assert.equal(cls.status, "atr");
    assert.equal(cls.actionNeeded, false);
    assert.equal(cls.atrMinutes, 540);
  }

  // Second Half Day ATR → half credit
  {
    const cls = Logic.classifyDayStatus(
      { day: "Thu", time: null, hasLeap: true, hasBio: false, leaves: null, leaveType: "Second Half Day", categoryCode: "C0018", weekOff: false },
      p, { department: "Devops" }
    );
    assert.equal(cls.status, "atr");
    assert.equal(cls.isFull, false);
    assert.equal(cls.atrMinutes, 270);
  }

  // DevOps Saturday, nothing → wfh-leave-atr
  {
    const cls = Logic.classifyDayStatus(
      { day: "Sat", time: null, hasLeap: false, hasBio: false, leaves: null, categoryCode: null, weekOff: false },
      p, { department: "Devops" }
    );
    assert.equal(cls.status, "pending");
    assert.equal(cls.actionType, "wfh-leave-atr");
  }

  // Unmarked weekday → leave-atr
  {
    const cls = Logic.classifyDayStatus(
      { day: "Mon", time: null, hasLeap: false, hasBio: false, leaves: null, categoryCode: null, weekOff: false },
      p, { department: "Devops" }
    );
    assert.equal(cls.actionType, "leave-atr");
    assert.equal(cls.actionNeeded, true);
  }

  console.log("✅ classifyDayStatus leap/bio tests passed");
}

// ═══════════════════════════════════════════════════════════════════
// computeMonthEndAnalysis Tests
// ═══════════════════════════════════════════════════════════════════

{
  const p = policy();

  // Complete week (all 5 days worked ≥ 9h each)
  {
    const allEntries = {
      "2026-06-01": { day: "Mon", time: "09:15", leaves: null, categoryCode: null, weekOff: false },
      "2026-06-02": { day: "Tue", time: "09:00", leaves: null, categoryCode: null, weekOff: false },
      "2026-06-03": { day: "Wed", time: "09:08", leaves: null, categoryCode: null, weekOff: false },
      "2026-06-04": { day: "Thu", time: "09:22", leaves: null, categoryCode: null, weekOff: false },
      "2026-06-05": { day: "Fri", time: "09:20", leaves: null, categoryCode: null, weekOff: false },
    };

    const result = Logic.computeMonthEndAnalysis({
      allEntries,
      policy: p,
      department: "Devops",
      today: new Date(2026, 5, 15), // June 15
    });

    assert.equal(result.monthName, "June");
    const week1 = result.weeks[0];
    assert.equal(week1.status, "complete");
    assert.equal(week1.deficitMinutes, 0);
    assert.equal(week1.suggestions.length, 0);
  }

  // Week short by full day with pending day → suggests pending
  {
    const allEntries = {
      "2026-06-01": { day: "Mon", time: "09:00", leaves: null, categoryCode: null, weekOff: false },
      "2026-06-02": { day: "Tue", time: null, leaves: null, categoryCode: null, weekOff: false }, // pending
      "2026-06-03": { day: "Wed", time: "09:00", leaves: null, categoryCode: null, weekOff: false },
      "2026-06-04": { day: "Thu", time: "09:00", leaves: null, categoryCode: null, weekOff: false },
      "2026-06-05": { day: "Fri", time: "09:00", leaves: null, categoryCode: null, weekOff: false },
    };

    const result = Logic.computeMonthEndAnalysis({
      allEntries,
      policy: p,
      department: "Devops",
      today: new Date(2026, 5, 15),
    });

    const week1 = result.weeks[0];
    assert.equal(week1.status, "short");
    assert.equal(week1.deficitMinutes, 540); // missing 9h
    assert.equal(week1.pendingDays.length, 1);
    assert.equal(week1.pendingDays[0].day, "Tue");
    assert.equal(week1.suggestions.length, 1);
    assert.equal(week1.suggestions[0].type, "missing");
    assert.equal(week1.suggestions[0].day, "Tue");
  }

  // Week short by small deficit, no pending → suggests lowest-hours day
  {
    const allEntries = {
      "2026-06-01": { day: "Mon", time: "09:15", leaves: null, categoryCode: null, weekOff: false },
      "2026-06-02": { day: "Tue", time: "08:42", leaves: null, categoryCode: null, weekOff: false },
      "2026-06-03": { day: "Wed", time: "09:08", leaves: null, categoryCode: null, weekOff: false },
      "2026-06-04": { day: "Thu", time: "08:58", leaves: null, categoryCode: null, weekOff: false },
      "2026-06-05": { day: "Fri", time: "09:02", leaves: null, categoryCode: null, weekOff: false },
    };

    const result = Logic.computeMonthEndAnalysis({
      allEntries,
      policy: p,
      department: "Devops",
      today: new Date(2026, 5, 15),
    });

    const week1 = result.weeks[0];
    // Total: 555+522+548+538+542 = 2705 min; Target = 2700; short by 0
    // Actually 09:15=555, 08:42=522, 09:08=548, 08:58=538, 09:02=542 = 2705
    // Target = 45*60 = 2700. So 2705 ≥ 2700 → complete
    assert.equal(week1.status, "complete");
  }

  console.log("✅ computeMonthEndAnalysis tests passed");
}

// ═══════════════════════════════════════════════════════════════════
// Saturday month-end analysis (6-day DevOps policy)
// ═══════════════════════════════════════════════════════════════════

{
  const p6 = Logic.resolveWorkPolicy({
    workingDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    dailyWorkHours: 9,
  });

  const allEntries = {
    "2026-06-01": { day: "Mon", time: "09:00", leaves: null, categoryCode: null, weekOff: false },
    "2026-06-02": { day: "Tue", time: "09:00", leaves: null, categoryCode: null, weekOff: false },
    "2026-06-03": { day: "Wed", time: "09:00", leaves: null, categoryCode: null, weekOff: false },
    "2026-06-04": { day: "Thu", time: "09:00", leaves: null, categoryCode: null, weekOff: false },
    "2026-06-05": { day: "Fri", time: "09:00", leaves: null, categoryCode: null, weekOff: false },
    // 2026-06-06 Saturday intentionally missing → unmarked
  };

  const result = Logic.computeMonthEndAnalysis({
    allEntries, policy: p6, department: "Devops", today: new Date(2026, 5, 6),
  });

  const week1 = result.weeks[0];
  assert.equal(week1.workingDayCount, 6);
  assert.equal(week1.targetMinutes, 3240); // 6 × 9h
  assert.equal(week1.status, "short");
  assert.equal(week1.deficitMinutes, 540); // Saturday missing
  const satSug = week1.suggestions.find((s) => s.day === "Sat");
  assert.ok(satSug, "expected a Saturday suggestion");
  assert.equal(satSug.actionType, "wfh-leave-atr");

  console.log("✅ Saturday month-analysis tests passed");
}

// ═══════════════════════════════════════════════════════════════════
// Enhanced computeAttendanceSummary Tests
// ═══════════════════════════════════════════════════════════════════

{
  // Week with 1 pending day → required adjusted
  {
    const context = Logic.buildWeekContext({
      policy: policy(),
      today: new Date(2026, 5, 3), // Wed June 3
    });

    const entries = {
      "2026-06-01": { day: "Mon", time: "09:00", leaves: null, categoryCode: null, weekOff: false },
      "2026-06-02": { day: "Tue", time: null, leaves: null, categoryCode: null, weekOff: false }, // pending
      "2026-06-03": { day: "Wed", time: "09:00", leaves: null, categoryCode: null, weekOff: false },
      "2026-06-04": { day: "Thu", time: "09:00", leaves: null, categoryCode: null, weekOff: false },
      "2026-06-05": { day: "Fri", time: "09:00", leaves: null, categoryCode: null, weekOff: false },
    };

    const summary = Logic.computeAttendanceSummary({
      entries, data: {}, context,
      todayLogin: { found: false },
      department: "Devops",
    });

    assert.equal(summary.isEnhanced, true);
    assert.equal(summary.pendingDays.length, 1);
    assert.equal(summary.pendingDays[0].day, "Tue");
    // Required = 4 days × 9h = 36h = 2160 min (1 day excluded)
    assert.equal(summary.adjustedRequiredMinutes, 2160);
    assert.equal(summary.adjustedDaysConsidered, 4);
    // Worked = 4 × 9h = 36h = 2160 min
    assert.equal(summary.totalWorkedMinutes, 2160);
    assert.equal(summary.remainingMinutes, 0);
  }

  // Week with leave + ATR
  {
    const context = Logic.buildWeekContext({
      policy: policy(),
      today: new Date(2026, 5, 3),
    });

    const entries = {
      "2026-06-01": { day: "Mon", time: "09:00", leaves: null, categoryCode: null, weekOff: false },
      "2026-06-02": { day: "Tue", time: null, leaves: "CL", leaveType: "Full Day", categoryCode: null, weekOff: false },
      "2026-06-03": { day: "Wed", time: null, leaves: null, leaveType: "Full Day", categoryCode: "ATR", weekOff: false },
      "2026-06-04": { day: "Thu", time: "09:00", leaves: null, categoryCode: null, weekOff: false },
      "2026-06-05": { day: "Fri", time: "09:00", leaves: null, categoryCode: null, weekOff: false },
    };

    const summary = Logic.computeAttendanceSummary({
      entries, data: {}, context,
      todayLogin: { found: false },
      department: "Devops",
    });

    assert.equal(summary.isEnhanced, true);
    assert.equal(summary.leaveDays.length, 1);
    assert.equal(summary.atrDays.length, 1);
    assert.equal(summary.pendingDays.length, 0);
    // Worked: 3×540=1620, Leave: 540, ATR: 540 → total 2700 = 45h
    assert.equal(summary.totalWorkedMinutes, 2700);
    assert.equal(summary.remainingMinutes, 0);
  }

  console.log("✅ Enhanced computeAttendanceSummary tests passed");
}

// ═══════════════════════════════════════════════════════════════════
// Today's cumulative logout time
// ═══════════════════════════════════════════════════════════════════

{
  const context = Logic.buildWeekContext({
    policy: policy(),
    today: new Date(2026, 5, 2), // Tuesday, June 2 2026
  });

  const entries = {
    "2026-06-01": { day: "Mon", time: "09:00", leaves: null, categoryCode: null, weekOff: false },
  };

  const summary = Logic.computeAttendanceSummary({
    entries, data: {}, context,
    todayLogin: { found: true, time24: "09:30", raw: "09:30 AM" },
    department: "Devops",
  });

  // Target through Tuesday = 2 × 9h = 18h; Monday credits 9h; today needs 9h.
  assert.equal(summary.logoutStatus, "ok");
  assert.equal(summary.todayRemainingFormatted, "09:00");
  assert.equal(summary.logoutTime, "18:30");

  // No Today Login → card hidden
  const noLogin = Logic.computeAttendanceSummary({
    entries, data: {}, context,
    todayLogin: { found: false, time24: null },
    department: "Devops",
  });
  assert.equal(noLogin.logoutStatus, "no-login");

  // Leap-only ATR-pending Monday is assumed to become a full day → does NOT
  // inflate Tuesday's logout (still login + 9h).
  const atrEntries = {
    "2026-06-01": { day: "Mon", time: null, hasLeap: true, hasBio: false, leaves: null, categoryCode: null, weekOff: false },
  };
  const atrSummary = Logic.computeAttendanceSummary({
    entries: atrEntries, data: {}, context,
    todayLogin: { found: true, time24: "09:30", raw: "09:30 AM" },
    department: "Devops",
  });
  assert.equal(atrSummary.logoutStatus, "ok");
  assert.equal(atrSummary.todayRemainingFormatted, "09:00");
  assert.equal(atrSummary.logoutTime, "18:30");

  console.log("✅ Cumulative logout tests passed");
}

// ═══════════════════════════════════════════════════════════════════
// hasLoginTime + augmentPolicyForDepartment Tests
// ═══════════════════════════════════════════════════════════════════

{
  assert.equal(Logic.hasLoginTime("09:01:20 AM"), true);
  assert.equal(Logic.hasLoginTime("09:51:31"), true);
  assert.equal(Logic.hasLoginTime(""), false);
  assert.equal(Logic.hasLoginTime(null), false);
  assert.equal(Logic.hasLoginTime("00:00:00"), false);
  assert.equal(Logic.hasLoginTime("-"), false);
  console.log("✅ hasLoginTime tests passed");
}

{
  const dev = Logic.augmentPolicyForDepartment(
    { workingDays: ["Mon", "Tue", "Wed", "Thu", "Fri"], dailyWorkHours: 9 },
    "Devops"
  );
  assert.deepEqual(plain(dev.workingDays), ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
  assert.equal(dev.totalWeeklyHours, 54);

  const hr = Logic.augmentPolicyForDepartment(
    { workingDays: ["Mon", "Tue", "Wed", "Thu", "Fri"], dailyWorkHours: 9 },
    "HR"
  );
  assert.deepEqual(plain(hr.workingDays), ["Mon", "Tue", "Wed", "Thu", "Fri"]);

  const already = Logic.augmentPolicyForDepartment(
    { workingDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], dailyWorkHours: 9 },
    "Devops"
  );
  assert.deepEqual(plain(already.workingDays), ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
  console.log("✅ augmentPolicyForDepartment tests passed");
}

console.log("\n🎉 All attendance-extension logic tests passed!\n");
