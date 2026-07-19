/**
 * logic.js — Shared attendance calculation helpers
 *
 * Pure helpers used by the HRMS extractor and tracker bridge. This file is a
 * classic script for Manifest V3 content script compatibility.
 */
(function () {
  "use strict";

  const FULL_TO_SHORT = {
    monday: "Mon",
    tuesday: "Tue",
    wednesday: "Wed",
    thursday: "Thu",
    friday: "Fri",
    saturday: "Sat",
    sunday: "Sun",
  };

  const SHORT_DAYS = new Set(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  const ALL_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const DAY_TO_OFFSET = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const SHORT_MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const DEFAULT_WORK_POLICY = {
    totalWeeklyHours: 45,
    dailyWorkHours: 9,
    halfDayHours: 4.5,
    workingDays: ["Mon", "Tue", "Wed", "Thu", "Fri"],
  };

  const DEFAULT_IGNORE_TIME_VALUES = [
    "00:00:00", "00:00", "0:00:00", "0:00",
    "-", "--", "N/A", "n/a", "",
  ];

  function resolveWorkPolicy(input) {
    const parsed = input && typeof input === "object" ? input : {};
    const workingDays = Array.isArray(parsed.workingDays)
      ? ALL_DAYS.filter((day) => parsed.workingDays.includes(day))
      : DEFAULT_WORK_POLICY.workingDays;

    const dailyWorkHours = Number.isFinite(parsed.dailyWorkHours)
      ? parsed.dailyWorkHours
      : DEFAULT_WORK_POLICY.dailyWorkHours;
    const totalWeeklyHours = Number.isFinite(parsed.totalWeeklyHours)
      ? parsed.totalWeeklyHours
      : dailyWorkHours * workingDays.length;
    const halfDayHours = Number.isFinite(parsed.halfDayHours)
      ? parsed.halfDayHours
      : dailyWorkHours / 2;

    return {
      totalWeeklyHours,
      dailyWorkHours,
      halfDayHours,
      workingDays,
    };
  }

  function normalizeDayName(dayStr) {
    if (!dayStr || typeof dayStr !== "string") return null;
    const trimmed = dayStr.trim();
    if (SHORT_DAYS.has(trimmed)) return trimmed;
    const short = FULL_TO_SHORT[trimmed.toLowerCase()];
    if (short) return short;
    const prefix = trimmed.slice(0, 3);
    const capitalized = prefix.charAt(0).toUpperCase() + prefix.slice(1).toLowerCase();
    return SHORT_DAYS.has(capitalized) ? capitalized : null;
  }

  function buildValidatedDate(year, monthIndex, day) {
    const date = new Date(year, monthIndex, day);
    date.setHours(0, 0, 0, 0);
    if (
      date.getFullYear() !== year ||
      date.getMonth() !== monthIndex ||
      date.getDate() !== day
    ) {
      return null;
    }
    return date;
  }

  function parseDateStrict(dateStr) {
    if (!dateStr || typeof dateStr !== "string") return null;
    const trimmed = dateStr.trim();

    const ddmmyyyy = trimmed.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})$/);
    if (ddmmyyyy) {
      const [, dd, mm, yyyy] = ddmmyyyy;
      return buildValidatedDate(Number(yyyy), Number(mm) - 1, Number(dd));
    }

    const yyyyMMdd = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (yyyyMMdd) {
      const [, yyyy, mm, dd] = yyyyMMdd;
      return buildValidatedDate(Number(yyyy), Number(mm) - 1, Number(dd));
    }

    const ddmmyyyyDash = trimmed.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    if (ddmmyyyyDash) {
      const [, dd, mm, yyyy] = ddmmyyyyDash;
      return buildValidatedDate(Number(yyyy), Number(mm) - 1, Number(dd));
    }

    return null;
  }

  function toISODate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function deriveDayFromDate(dateStr) {
    const date = parseDateStrict(dateStr);
    if (!date) return null;
    return ALL_DAYS[(date.getDay() + 6) % 7];
  }

  function formatDateDisplay(date) {
    const dayName = ALL_DAYS[(date.getDay() + 6) % 7];
    return `${date.getDate()} ${SHORT_MONTH_NAMES[date.getMonth()]} (${dayName})`;
  }

  function convertWorkedTime(timeStr, ignoreValues) {
    if (!timeStr || typeof timeStr !== "string") return null;
    const ignored = ignoreValues || DEFAULT_IGNORE_TIME_VALUES;
    const trimmed = timeStr.trim();
    if (ignored.includes(trimmed)) return null;
    const match = trimmed.match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
    if (hours === 0 && minutes === 0) return null;
    if (minutes > 59) return null;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  function convertLoginTime(timeStr) {
    if (!timeStr || typeof timeStr !== "string") return null;
    const trimmed = timeStr.trim();
    const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|A\.M\.|P\.M\.|A|P)?$/i);
    if (!match) return null;

    let hours = Number(match[1]);
    const minutes = Number(match[2]);
    const period = match[4] ? match[4].toUpperCase().replace(/\./g, "") : null;
    if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
    if (minutes > 59) return null;

    if (period) {
      if (hours < 1 || hours > 12) return null;
      if (period === "AM" || period === "A") {
        if (hours === 12) hours = 0;
      } else if (period === "PM" || period === "P") {
        if (hours !== 12) hours += 12;
      }
    }

    if (hours > 23) return null;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  function hasLoginTime(timeStr, ignoreValues) {
    if (!timeStr || typeof timeStr !== "string") return false;
    const ignored = ignoreValues || DEFAULT_IGNORE_TIME_VALUES;
    const trimmed = timeStr.trim();
    if (!trimmed || ignored.includes(trimmed)) return false;
    return /\d{1,2}:\d{2}/.test(trimmed);
  }

  function timeToMinutes(timeStr) {
    if (!timeStr || typeof timeStr !== "string") return 0;
    const match = timeStr.trim().match(/^(\d+):(\d{2})$/);
    if (!match) return 0;
    return Number(match[1]) * 60 + Number(match[2]);
  }

  function timeToDecimalHours(timeStr) {
    return timeToMinutes(timeStr) / 60;
  }

  function sumHours(times) {
    let totalMinutes = 0;
    for (const t of times) totalMinutes += timeToMinutes(t);
    return { totalMinutes, formatted: formatMinutes(totalMinutes) };
  }

  function formatMinutes(totalMinutes) {
    const h = Math.floor(Math.abs(totalMinutes) / 60);
    const m = Math.abs(totalMinutes) % 60;
    const sign = totalMinutes < 0 ? "-" : "";
    return `${sign}${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  function getMonday(today) {
    const base = today ? new Date(today) : new Date();
    const dayOfWeek = base.getDay();
    const offset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(base);
    monday.setDate(base.getDate() + offset);
    monday.setHours(0, 0, 0, 0);
    return monday;
  }

  function generateWeekDates(policy, today) {
    const resolved = resolveWorkPolicy(policy);
    const monday = getMonday(today);
    return ALL_DAYS
      .filter((day) => resolved.workingDays.includes(day))
      .map((day) => {
        const date = new Date(monday);
        date.setDate(monday.getDate() + DAY_TO_OFFSET[day]);
        return date;
      });
  }

  function buildWeekContext(options) {
    const opts = options || {};
    const today = opts.today ? new Date(opts.today) : new Date();
    const policy = resolveWorkPolicy(opts.policy);
    const weekDates = generateWeekDates(policy, today);
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();
    const validDates = weekDates.filter(
      (d) => d.getMonth() === currentMonth && d.getFullYear() === currentYear
    );
    const validDateSet = new Set(validDates.map(toISODate));
    const validIsoByDay = {};
    for (const date of validDates) {
      validIsoByDay[ALL_DAYS[(date.getDay() + 6) % 7]] = toISODate(date);
    }

    return {
      today,
      policy,
      weekDates,
      validDates,
      validDateSet,
      validIsoByDay,
      isMonthBoundary: validDates.length < weekDates.length,
      currentMonth,
      currentYear,
      currentMonthName: MONTH_NAMES[currentMonth],
      excludedDates: weekDates
        .filter((d) => d.getMonth() !== currentMonth || d.getFullYear() !== currentYear)
        .map((d) => ({ iso: toISODate(d), display: formatDateDisplay(d) })),
    };
  }

  function normalizeAttendanceRows(rows, context) {
    const ctx = context || buildWeekContext();
    const entries = {};
    const data = {};
    const rawRows = [];
    let validRowsExtracted = 0;

    for (const row of rows || []) {
      const dateVal = row.date || null;
      const dayVal = row.day || null;
      const timeVal = row.time || null;
      const parsedDate = parseDateStrict(dateVal);
      let isoDate = parsedDate ? toISODate(parsedDate) : null;
      let dayName = normalizeDayName(dayVal) || (dateVal ? deriveDayFromDate(dateVal) : null);

      if (!dayName && isoDate) {
        dayName = ALL_DAYS[(parsedDate.getDay() + 6) % 7];
      }
      if (!dayName) continue;

      if (!isoDate && ctx.validIsoByDay[dayName]) {
        isoDate = ctx.validIsoByDay[dayName];
      }

      const convertedTime = convertWorkedTime(timeVal);
      const isValidDate = isoDate ? ctx.validDateSet.has(isoDate) : false;

      rawRows.push({
        date: dateVal,
        isoDate,
        day: dayName,
        rawTime: timeVal,
        convertedTime,
        isValidDate,
        isWeekend: parsedDate ? (parsedDate.getDay() === 0 || parsedDate.getDay() === 6) : false,
      });

      if (!convertedTime || !isValidDate) continue;

      const displayDate = parsedDate || parseDateStrict(isoDate);
      entries[isoDate] = {
        day: dayName,
        date: dateVal,
        time: convertedTime,
        display: displayDate ? formatDateDisplay(displayDate) : isoDate,
      };
      data[dayName] = convertedTime;
      validRowsExtracted++;
    }

    return { entries, data, rawRows, validRowsExtracted };
  }

  // ── Leave/ATR Classification Engine ──────────────────────────────────────

  /**
   * Parse the "Type" column value to determine full vs half day.
   * @param {string} typeStr - "Full Day", "Half Day", etc.
   * @param {Object} policy  - work policy for hour values
   * @returns {{ isFull: boolean, minutes: number }}
   */
  function parseLeaveType(typeStr, policy) {
    const p = policy || DEFAULT_WORK_POLICY;
    const fullMinutes = Math.round(p.dailyWorkHours * 60);
    const halfMinutes = Math.round(p.halfDayHours * 60);

    if (!typeStr || typeof typeStr !== "string") {
      return { isFull: true, minutes: fullMinutes };
    }

    const lower = typeStr.trim().toLowerCase();

    if (lower.includes("half")) {
      return { isFull: false, minutes: halfMinutes };
    }
    if (lower === "0.5") {
      return { isFull: false, minutes: halfMinutes };
    }

    // "Full Day", "1.0", any other value defaults to full
    return { isFull: true, minutes: fullMinutes };
  }

  /**
   * Check if a leaves value represents Work From Home.
   * @param {string} leavesStr
   * @returns {boolean}
   */
  function isWFH(leavesStr) {
    if (!leavesStr || typeof leavesStr !== "string") return false;
    const lower = leavesStr.trim().toLowerCase();
    return lower.includes("work from home") || lower === "wfh";
  }

  /**
   * Check if a department string is DevOps.
   * @param {string} dept
   * @returns {boolean}
   */
  function isDevOpsDepartment(dept) {
    if (!dept || typeof dept !== "string") return false;
    const trimmed = dept.trim();
    return trimmed === "DevOps" || trimmed === "Devops";
  }

  /**
   * Return a resolved policy, adding Saturday as a working day for DevOps.
   * Keeps logic.js policy-driven; the department rule is applied by the caller
   * (content.js) so unit tests remain unaffected.
   */
  function augmentPolicyForDepartment(policy, department) {
    const resolved = resolveWorkPolicy(policy);
    if (isDevOpsDepartment(department) && !resolved.workingDays.includes("Sat")) {
      const workingDays = ALL_DAYS.filter(
        (d) => resolved.workingDays.includes(d) || d === "Sat"
      );
      return {
        ...resolved,
        workingDays,
        totalWeeklyHours: resolved.dailyWorkHours * workingDays.length,
      };
    }
    return resolved;
  }

  /**
   * Classify a single day's attendance status.
   *
   * Priority: weekOff → leaves → categoryCode → worked(FinalLogin)
   *   → leap-only(atr-wfh) → DevOps Saturday(wfh-leave-atr)
   *   → non-DevOps Saturday(auto-WFH) → unmarked(leave-atr)
   *
   * @param {Object} entry   - enriched entry (may include hasLeap/hasBio)
   * @param {Object} policy  - work policy
   * @param {Object} options - { department: string }
   * @returns {Object} classification result
   */
  function classifyDayStatus(entry, policy, options) {
    const p = policy || DEFAULT_WORK_POLICY;
    const opts = options || {};
    const dept = opts.department || "";

    const result = {
      status: "pending",
      isFull: true,
      workedMinutes: 0,
      leaveMinutes: 0,
      atrMinutes: 0,
      totalMinutes: 0,
      actionNeeded: false,
      actionType: null,
      label: "Pending",
    };

    if (!entry) {
      result.actionNeeded = true;
      result.actionType = "leave-atr";
      result.label = "Apply Leave/ATR";
      return result;
    }

    // 1. Weekend
    if (entry.weekOff) {
      result.status = "weekend";
      result.label = "Weekend";
      return result;
    }

    const daySaturday = entry.day === "Sat" ||
      (typeof entry.day === "string" && entry.day.toLowerCase().startsWith("sat"));
    const workedMins = entry.time ? timeToMinutes(entry.time) : 0;
    const hasLeap = !!entry.hasLeap;
    const hasBio = !!entry.hasBio;

    // 2. Leaves present (applied leave / WFH) — takes priority over ATR
    if (entry.leaves && typeof entry.leaves === "string" && entry.leaves.trim()) {
      const lt = parseLeaveType(entry.leaveType, p);
      if (isWFH(entry.leaves)) {
        result.status = "wfh";
        result.label = `WFH (${lt.isFull ? "Full Day" : "Half Day"})`;
      } else {
        result.status = "leave";
        result.label = `Leave (${lt.isFull ? "Full Day" : "Half Day"})`;
      }
      result.isFull = lt.isFull;
      result.leaveMinutes = lt.minutes;
      result.workedMinutes = workedMins;
      result.totalMinutes = workedMins + lt.minutes;
      return result;
    }

    // 3. Category Code present → ATR already applied
    if (entry.categoryCode && typeof entry.categoryCode === "string" && entry.categoryCode.trim()) {
      const lt = parseLeaveType(entry.leaveType, p);
      result.status = "atr";
      result.isFull = lt.isFull;
      result.atrMinutes = lt.minutes;
      result.workedMinutes = workedMins;
      result.totalMinutes = workedMins + lt.minutes;
      result.label = `ATR (${lt.isFull ? "Full Day" : "Half Day"})`;
      return result;
    }

    // 4. Final Login has valid worked time → worked, no action
    if (workedMins > 0) {
      result.status = "worked";
      result.workedMinutes = workedMins;
      result.totalMinutes = workedMins;
      result.label = "Worked";
      return result;
    }

    // 5. Leap login present but no Bio login → WFH, ATR not yet filed
    if (hasLeap && !hasBio) {
      result.status = "pending";
      result.actionNeeded = true;
      result.actionType = "atr-wfh";
      result.label = "WFH — file ATR";
      return result;
    }

    // 6. DevOps Saturday with nothing → apply WFH Leave/ATR
    if (daySaturday && isDevOpsDepartment(dept)) {
      result.status = "pending";
      result.actionNeeded = true;
      result.actionType = "wfh-leave-atr";
      result.label = "Saturday — apply WFH Leave/ATR";
      return result;
    }

    // 6b. Non-DevOps Saturday with nothing → auto-credit WFH (HR backend)
    if (daySaturday && !isDevOpsDepartment(dept)) {
      const lt = parseLeaveType(entry.leaveType, p);
      result.status = "wfh";
      result.isFull = lt.isFull;
      result.leaveMinutes = lt.minutes;
      result.totalMinutes = lt.minutes;
      result.label = `WFH (${lt.isFull ? "Full Day" : "Half Day"})`;
      return result;
    }

    // 7. Nothing present → unmarked, apply Leave/ATR
    result.status = "pending";
    result.actionNeeded = true;
    result.actionType = "leave-atr";
    result.label = "Apply Leave/ATR";
    return result;
  }

  /**
   * Generate all Mon–Sun week boundaries that overlap a given month.
   * Each week is clipped to only include working days within the month.
   *
   * @param {number} month - 0-indexed month
   * @param {number} year
   * @param {Object} policy
   * @returns {Array<{ weekNumber: number, dates: Date[], startDate: string, endDate: string }>}
   */
  function generateMonthWeeks(month, year, policy) {
    const p = policy || DEFAULT_WORK_POLICY;
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0); // last day of month

    // Find the Monday of the week containing the 1st
    const firstMonday = getMonday(firstDay);

    const weeks = [];
    let weekStart = new Date(firstMonday);
    let weekNum = 1;

    while (weekStart <= lastDay) {
      const weekDates = [];

      for (let i = 0; i < 7; i++) {
        const d = new Date(weekStart);
        d.setDate(weekStart.getDate() + i);
        d.setHours(0, 0, 0, 0);

        // Only include if within the target month
        if (d.getMonth() !== month || d.getFullYear() !== year) continue;

        // Only include configured working days
        const dayName = ALL_DAYS[(d.getDay() + 6) % 7];
        if (p.workingDays.includes(dayName)) {
          weekDates.push(d);
        }
      }

      if (weekDates.length > 0) {
        weeks.push({
          weekNumber: weekNum,
          dates: weekDates,
          startDate: toISODate(weekDates[0]),
          endDate: toISODate(weekDates[weekDates.length - 1]),
        });
        weekNum++;
      }

      // Advance to next Monday
      weekStart.setDate(weekStart.getDate() + 7);
    }

    return weeks;
  }

  /**
   * Perform month-end analysis: classify each day, compute per-week totals,
   * detect deficits, and generate Leave/ATR suggestions.
   *
   * @param {Object} input
   * @param {Object} input.allEntries - date-keyed entries for the full month
   * @param {Object} input.policy     - work policy
   * @param {string} input.department - department name
   * @param {Date}   input.today      - current date
   * @returns {Object} month-end analysis result
   */
  function computeMonthEndAnalysis(input) {
    const allEntries = input.allEntries || {};
    const policy = resolveWorkPolicy(input.policy);
    const dept = input.department || "";
    const today = input.today ? new Date(input.today) : new Date();

    const month = today.getMonth();
    const year = today.getFullYear();

    const weeks = generateMonthWeeks(month, year, policy);
    const analysisWeeks = [];

    for (const week of weeks) {
      const dayResults = [];
      let totalWorked = 0;
      let totalLeave = 0;
      let totalATR = 0;
      const pendingDays = [];

      for (const date of week.dates) {
        const isoDate = toISODate(date);
        const dayName = ALL_DAYS[(date.getDay() + 6) % 7];
        const entry = allEntries[isoDate] || { day: dayName, time: null };

        // Ensure entry has day name
        const entryWithDay = { ...entry, day: entry.day || dayName };

        const classification = classifyDayStatus(entryWithDay, policy, { department: dept });

        dayResults.push({
          isoDate,
          day: dayName,
          date: date,
          ...classification,
        });

        if (classification.status === "pending") {
          pendingDays.push({ isoDate, day: dayName });
        } else if (classification.status !== "weekend") {
          totalWorked += classification.workedMinutes;
          totalLeave += classification.leaveMinutes;
          totalATR += classification.atrMinutes;
        }
      }

      const workingDayCount = week.dates.length;
      const targetMinutes = Math.round(workingDayCount * policy.dailyWorkHours * 60);
      const totalMinutes = totalWorked + totalLeave + totalATR;
      const deficitMinutes = Math.max(0, targetMinutes - totalMinutes);

      // Generate suggestions
      const suggestions = [];

      if (deficitMinutes > 0) {
        // Step 1: Suggest pending days first (entire missing days)
        for (const pd of pendingDays) {
          suggestions.push({
            isoDate: pd.isoDate,
            day: pd.day,
            reason: "Missing day — apply Leave/ATR",
            type: "missing",
          });
        }

        // Step 2: If still short after suggesting all pending days as full-day credits,
        // suggest the worked day with the lowest hours
        const pendingCredit = pendingDays.length * Math.round(policy.dailyWorkHours * 60);
        const remainingDeficit = deficitMinutes - pendingCredit;

        if (remainingDeficit > 0) {
          // Find worked days sorted by lowest hours
          const workedDays = dayResults
            .filter((d) => d.status === "worked")
            .sort((a, b) => a.workedMinutes - b.workedMinutes);

          if (workedDays.length > 0) {
            const lowest = workedDays[0];
            const lowestFormatted = formatMinutes(lowest.workedMinutes);
            suggestions.push({
              isoDate: lowest.isoDate,
              day: lowest.day,
              reason: `Lowest hours (${lowestFormatted}) — apply Leave/ATR`,
              type: "low-hours",
            });
          }
        }
      }

      const status = deficitMinutes <= 0 ? "complete" : "short";

      analysisWeeks.push({
        weekNumber: week.weekNumber,
        startDate: week.startDate,
        endDate: week.endDate,
        days: dayResults,
        workedMinutes: totalWorked,
        leaveMinutes: totalLeave,
        atrMinutes: totalATR,
        totalMinutes,
        workingDayCount,
        targetMinutes,
        deficitMinutes,
        status,
        pendingDays,
        suggestions,
      });
    }

    return {
      monthName: MONTH_NAMES[month],
      year,
      weeks: analysisWeeks,
    };
  }

  // ── Enhanced Attendance Summary ─────────────────────────────────────────

  function computeAttendanceSummary(input) {
    const entries = input.entries || {};
    const data = input.data || {};
    const context = input.context || buildWeekContext();
    const todayLogin = input.todayLogin || { found: false, time24: null, raw: null };
    const dept = input.department || "";

    // ── Classify each day ──
    const dayClassifications = {};
    const pendingDaysList = [];
    const leaveDaysList = [];
    const atrDaysList = [];
    let adjustedWorkedMinutes = 0;
    let adjustedLeaveMinutes = 0;
    let adjustedATRMinutes = 0;
    let pendingCount = 0;

    const entryKeys = Object.keys(entries);
    const hasEntries = entryKeys.length > 0;

    if (hasEntries) {
      for (const isoDate of entryKeys) {
        const entry = entries[isoDate];
        const classification = classifyDayStatus(entry, context.policy, { department: dept });
        dayClassifications[isoDate] = classification;

        if (classification.status === "pending") {
          pendingCount++;
          pendingDaysList.push({
            isoDate,
            day: entry.day,
            display: entry.display || isoDate,
          });
        } else if (classification.status === "weekend") {
          // skip
        } else {
          adjustedWorkedMinutes += classification.workedMinutes;
          adjustedLeaveMinutes += classification.leaveMinutes;
          adjustedATRMinutes += classification.atrMinutes;

          if (classification.status === "leave" || classification.status === "wfh") {
            leaveDaysList.push({
              isoDate,
              day: entry.day,
              type: classification.isFull ? "full" : "half",
              label: classification.label,
              hours: classification.leaveMinutes / 60,
              display: entry.display || isoDate,
            });
          }
          if (classification.status === "atr") {
            atrDaysList.push({
              isoDate,
              day: entry.day,
              type: classification.isFull ? "full" : "half",
              label: classification.label,
              hours: classification.atrMinutes / 60,
              display: entry.display || isoDate,
            });
          }
        }
      }
    }

    // ── Compute totals (enhanced) ──
    // adjustedTotal includes worked + leave + ATR credits
    const adjustedTotalMinutes = adjustedWorkedMinutes + adjustedLeaveMinutes + adjustedATRMinutes;

    // For backward-compat: also compute original workedTimes-based values
    const workedTimes = hasEntries
      ? Object.values(entries).map((entry) => entry.time).filter(Boolean)
      : Object.values(data);
    const { totalMinutes: rawWorkedMinutes, formatted: rawTotalWorked } = sumHours(workedTimes);

    // Use enhanced values if we have enriched entries, otherwise fall back to legacy
    const useEnhanced = hasEntries && entryKeys.some((k) => {
      const e = entries[k];
      return e && (e.leaves !== undefined || e.categoryCode !== undefined || e.weekOff !== undefined);
    });

    const effectiveWorkedMinutes = useEnhanced ? adjustedTotalMinutes : rawWorkedMinutes;
    const effectiveTotalWorked = useEnhanced ? formatMinutes(adjustedTotalMinutes) : rawTotalWorked;

    // Adjusted required: exclude pending days from requirement
    const adjustedDaysConsidered = context.validDates.length - pendingCount;
    const adjustedRequiredMinutes = useEnhanced
      ? Math.round(Math.max(0, adjustedDaysConsidered) * context.policy.dailyWorkHours * 60)
      : Math.round(context.validDates.length * context.policy.dailyWorkHours * 60);

    const requiredMinutes = adjustedRequiredMinutes;
    const remainingRawMinutes = requiredMinutes - effectiveWorkedMinutes;

    let logoutTime = null;
    let logoutStatus = "no-login";
    let todayRemainingMinutes = null;

    if (todayLogin.found && todayLogin.time24) {
      const loginTotalMinutes = timeToMinutes(todayLogin.time24);
      if (remainingRawMinutes <= 0) {
        logoutStatus = "done";
        todayRemainingMinutes = 0;
      } else {
        const todayIso = toISODate(context.today);
        const futureDays = context.validDates.filter((d) => {
          const iso = toISODate(d);
          if (iso <= todayIso) return false;
          // Also exclude future pending days from calculation
          if (useEnhanced && dayClassifications[iso] && dayClassifications[iso].status === "pending") {
            return false;
          }
          return true;
        }).length;
        todayRemainingMinutes = remainingRawMinutes -
          Math.round(futureDays * context.policy.dailyWorkHours * 60);
        if (todayRemainingMinutes < 0) todayRemainingMinutes = 0;

        const logoutTotalMinutes = loginTotalMinutes + todayRemainingMinutes;
        const logoutH = Math.floor(logoutTotalMinutes / 60);
        const logoutM = logoutTotalMinutes % 60;
        logoutTime = `${String(logoutH).padStart(2, "0")}:${String(logoutM).padStart(2, "0")}`;
        logoutStatus = "ok";
      }
    }

    return {
      totalWorked: effectiveTotalWorked,
      totalWorkedMinutes: effectiveWorkedMinutes,
      required: formatMinutes(requiredMinutes),
      requiredMinutes,
      remaining: formatMinutes(Math.max(0, remainingRawMinutes)),
      remainingMinutes: Math.max(0, remainingRawMinutes),
      surplus: remainingRawMinutes < 0 ? formatMinutes(Math.abs(remainingRawMinutes)) : null,
      surplusMinutes: remainingRawMinutes < 0 ? Math.abs(remainingRawMinutes) : 0,
      daysConsidered: context.validDates.length,
      daysWithData: useEnhanced
        ? entryKeys.filter((k) => dayClassifications[k] && dayClassifications[k].status !== "pending" && dayClassifications[k].status !== "weekend").length
        : (Object.keys(entries).length || Object.keys(data).length),
      dailyTarget: context.policy.dailyWorkHours,
      isMonthBoundary: context.isMonthBoundary,
      percentComplete: requiredMinutes > 0
        ? Math.min(100, Math.round((effectiveWorkedMinutes / requiredMinutes) * 100))
        : 0,
      todayLoginTime: todayLogin.time24,
      todayLoginRaw: todayLogin.raw,
      logoutTime,
      logoutStatus,
      todayRemainingMinutes,
      todayRemainingFormatted: todayRemainingMinutes !== null
        ? formatMinutes(todayRemainingMinutes)
        : null,
      // ── New enhanced fields ──
      pendingDays: pendingDaysList,
      leaveDays: leaveDaysList,
      atrDays: atrDaysList,
      dayClassifications,
      adjustedWorkedMinutes,
      adjustedLeaveMinutes,
      adjustedATRMinutes,
      adjustedRequiredMinutes,
      adjustedDaysConsidered,
      isEnhanced: useEnhanced,
    };
  }

  function mergeTrackerWeekData(options) {
    const existing = { ...((options && options.existing) || {}) };
    const attendanceData = (options && options.attendanceData) || {};
    const refreshDays = (options && options.refreshDays) || Object.keys(attendanceData);

    for (const day of refreshDays) {
      delete existing[day];
    }

    for (const [day, timeStr] of Object.entries(attendanceData)) {
      existing[day] = {
        type: "worked",
        hours: timeToDecimalHours(timeStr),
      };
    }

    return existing;
  }

  globalThis.AttendanceLogic = {
    DEFAULT_WORK_POLICY,
    resolveWorkPolicy,
    hasLoginTime,
    augmentPolicyForDepartment,
    normalizeDayName,
    parseDateStrict,
    toISODate,
    deriveDayFromDate,
    formatDateDisplay,
    convertWorkedTime,
    convertLoginTime,
    timeToMinutes,
    timeToDecimalHours,
    sumHours,
    formatMinutes,
    getMonday,
    generateWeekDates,
    buildWeekContext,
    normalizeAttendanceRows,
    computeAttendanceSummary,
    mergeTrackerWeekData,
    // ── New Leave/ATR functions ──
    parseLeaveType,
    isWFH,
    isDevOpsDepartment,
    classifyDayStatus,
    generateMonthWeeks,
    computeMonthEndAnalysis,
  };
})();
