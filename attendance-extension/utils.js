/**
 * utils.js — Shared Utility Functions
 *
 * Pure helper functions used by both content.js and popup.js.
 * No DOM access, no Chrome API calls — keep this testable.
 */

// ── Day Name Mapping ──────────────────────────────────────────────────────────

const FULL_TO_SHORT = {
  monday:    "Mon",
  tuesday:   "Tue",
  wednesday: "Wed",
  thursday:  "Thu",
  friday:    "Fri",
  saturday:  "Sat",
  sunday:    "Sun",
};

const SHORT_DAYS = new Set(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);

/**
 * Normalize a day name to 3-letter abbreviation.
 * Handles: "Monday" → "Mon", "Mon" → "Mon", "TUESDAY" → "Tue"
 * @param {string} dayStr
 * @returns {string|null} Short day name or null if unrecognized
 */
function normalizeDayName(dayStr) {
  if (!dayStr || typeof dayStr !== "string") return null;
  const trimmed = dayStr.trim();
  if (SHORT_DAYS.has(trimmed)) return trimmed;
  const short = FULL_TO_SHORT[trimmed.toLowerCase()];
  if (short) return short;
  const prefix = trimmed.slice(0, 3);
  const capitalized = prefix.charAt(0).toUpperCase() + prefix.slice(1).toLowerCase();
  if (SHORT_DAYS.has(capitalized)) return capitalized;
  return null;
}

// ── Date Parsing ──────────────────────────────────────────────────────────────

/**
 * Parse a date string (DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, or YYYY-MM-DD)
 * into a Date object. Returns null if unparseable.
 * @param {string} dateStr
 * @returns {Date|null}
 */
function parseDate(dateStr) {
  if (!dateStr || typeof dateStr !== "string") return null;
  const trimmed = dateStr.trim();

  const ddmmyyyy = trimmed.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (ddmmyyyy) {
    const [, dd, mm, yyyy] = ddmmyyyy;
    const d = new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd));
    return isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(trimmed);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Format a Date to ISO date string YYYY-MM-DD.
 * @param {Date} date
 * @returns {string}
 */
function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Derive the short weekday name from a date string.
 * @param {string} dateStr
 * @returns {string|null}
 */
function deriveDayFromDate(dateStr) {
  const date = parseDate(dateStr);
  if (!date) return null;
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return dayNames[date.getDay()];
}

// ── Time Conversion ───────────────────────────────────────────────────────────

/**
 * Convert HH:MM:SS (or HH:MM) to HH:MM, truncating seconds.
 * Returns null for invalid/empty/zero times.
 * @param {string} timeStr
 * @param {string[]} ignoreValues - values to treat as "no work"
 * @returns {string|null} "HH:MM" or null
 */
function convertTime(timeStr, ignoreValues = []) {
  if (!timeStr || typeof timeStr !== "string") return null;
  const trimmed = timeStr.trim();
  if (ignoreValues.includes(trimmed)) return null;
  const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  if (hours === 0 && minutes === 0) return null;
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Convert "HH:MM" string to decimal hours (e.g., "09:30" → 9.5).
 * @param {string} timeStr - "HH:MM" format
 * @returns {number} decimal hours
 */
function timeToDecimalHours(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(":").map(Number);
  return h + (m / 60);
}

// ── Week & Month Boundary ─────────────────────────────────────────────────────

/**
 * Get the Monday of the current week.
 * @returns {Date} Monday at 00:00:00
 */
function getMonday() {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon, ...
  const offset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(now);
  monday.setDate(now.getDate() + offset);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

/**
 * Generate weekday dates (Mon–Fri) for the current week.
 * @returns {Date[]} Array of 5 Date objects
 */
function generateWeekDates() {
  const monday = getMonday();
  const dates = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    dates.push(d);
  }
  return dates;
}

/**
 * Filter dates to only include those in today's month.
 * Handles month boundaries: if the week spans two months, only
 * days in the current month are kept.
 * @param {Date[]} dates
 * @returns {{ validDates: Date[], filtered: boolean, currentMonth: number, currentYear: number }}
 */
function filterByMonth(dates) {
  const today = new Date();
  const currentMonth = today.getMonth();
  const currentYear = today.getFullYear();
  const validDates = dates.filter(d =>
    d.getMonth() === currentMonth && d.getFullYear() === currentYear
  );
  return { validDates, filtered: validDates.length < dates.length, currentMonth, currentYear };
}

/**
 * Sum hours from "HH:MM" time strings.
 * @param {string[]} times - Array of "HH:MM" strings
 * @returns {{ totalMinutes: number, formatted: string }}
 */
function sumHours(times) {
  let totalMinutes = 0;
  for (const t of times) {
    if (!t) continue;
    const [h, m] = t.split(":").map(Number);
    totalMinutes += h * 60 + m;
  }
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return {
    totalMinutes,
    formatted: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
  };
}

/**
 * Format total minutes as "HH:MM". Handles negatives.
 * @param {number} totalMinutes
 * @returns {string}
 */
function formatMinutes(totalMinutes) {
  const h = Math.floor(Math.abs(totalMinutes) / 60);
  const m = Math.abs(totalMinutes) % 60;
  const sign = totalMinutes < 0 ? "-" : "";
  return `${sign}${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Get the current week's date range (Monday to Sunday).
 * @returns {{ start: Date, end: Date }}
 */
function getCurrentWeekRange() {
  const monday = getMonday();
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { start: monday, end: sunday };
}

/**
 * Check if a date string falls within the current week (Mon–Sun).
 * @param {string} dateStr
 * @returns {boolean}
 */
function isCurrentWeek(dateStr) {
  const date = parseDate(dateStr);
  if (!date) return false;
  const { start, end } = getCurrentWeekRange();
  return date >= start && date <= end;
}

// ── Column Detection ──────────────────────────────────────────────────────────

/**
 * Find the index of a column by searching header cells for matching text.
 * @param {HTMLTableRowElement[]} headerRows
 * @param {string[]} identifiers
 * @returns {number} column index (0-based) or -1
 */
function findColumnIndex(headerRows, identifiers) {
  for (const row of headerRows) {
    const cells = row.querySelectorAll("th, td");
    for (let i = 0; i < cells.length; i++) {
      const text = cells[i].textContent.trim().toLowerCase();
      for (const id of identifiers) {
        if (text === id.toLowerCase() || text.includes(id.toLowerCase())) {
          return i;
        }
      }
    }
  }
  return -1;
}

// ── Export ─────────────────────────────────────────────────────────────────────

if (typeof globalThis !== "undefined") {
  globalThis.AttendanceUtils = {
    normalizeDayName,
    parseDate,
    toISODate,
    deriveDayFromDate,
    convertTime,
    timeToDecimalHours,
    getMonday,
    generateWeekDates,
    filterByMonth,
    sumHours,
    formatMinutes,
    getCurrentWeekRange,
    isCurrentWeek,
    findColumnIndex,
  };
}
