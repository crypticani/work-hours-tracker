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

  function computeAttendanceSummary(input) {
    const entries = input.entries || {};
    const data = input.data || {};
    const context = input.context || buildWeekContext();
    const todayLogin = input.todayLogin || { found: false, time24: null, raw: null };
    const workedTimes = Object.keys(entries).length > 0
      ? Object.values(entries).map((entry) => entry.time)
      : Object.values(data);
    const { totalMinutes: workedMinutes, formatted: totalWorked } = sumHours(workedTimes);

    const requiredMinutes = Math.round(
      context.validDates.length * context.policy.dailyWorkHours * 60
    );
    const remainingRawMinutes = requiredMinutes - workedMinutes;

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
        const futureDays = context.validDates.filter((d) => toISODate(d) > todayIso).length;
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
      totalWorked,
      totalWorkedMinutes: workedMinutes,
      required: formatMinutes(requiredMinutes),
      requiredMinutes,
      remaining: formatMinutes(Math.max(0, remainingRawMinutes)),
      remainingMinutes: Math.max(0, remainingRawMinutes),
      surplus: remainingRawMinutes < 0 ? formatMinutes(Math.abs(remainingRawMinutes)) : null,
      surplusMinutes: remainingRawMinutes < 0 ? Math.abs(remainingRawMinutes) : 0,
      daysConsidered: context.validDates.length,
      daysWithData: Object.keys(entries).length || Object.keys(data).length,
      dailyTarget: context.policy.dailyWorkHours,
      isMonthBoundary: context.isMonthBoundary,
      percentComplete: requiredMinutes > 0
        ? Math.min(100, Math.round((workedMinutes / requiredMinutes) * 100))
        : 0,
      todayLoginTime: todayLogin.time24,
      todayLoginRaw: todayLogin.raw,
      logoutTime,
      logoutStatus,
      todayRemainingMinutes,
      todayRemainingFormatted: todayRemainingMinutes !== null
        ? formatMinutes(todayRemainingMinutes)
        : null,
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
  };
})();
