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

  // Already short form?
  if (SHORT_DAYS.has(trimmed)) return trimmed;

  // Try full name lookup (case-insensitive)
  const short = FULL_TO_SHORT[trimmed.toLowerCase()];
  if (short) return short;

  // Partial match — first 3 letters
  const prefix = trimmed.slice(0, 3);
  const capitalized = prefix.charAt(0).toUpperCase() + prefix.slice(1).toLowerCase();
  if (SHORT_DAYS.has(capitalized)) return capitalized;

  return null;
}

/**
 * Derive the short weekday name from a date string (DD/MM/YYYY or YYYY-MM-DD).
 * Falls back to null if parsing fails.
 * @param {string} dateStr
 * @returns {string|null}
 */
function deriveDayFromDate(dateStr) {
  if (!dateStr || typeof dateStr !== "string") return null;

  let date;

  // Try DD/MM/YYYY format
  const ddmmyyyy = dateStr.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (ddmmyyyy) {
    const [, dd, mm, yyyy] = ddmmyyyy;
    date = new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd));
  } else {
    // Try native Date parse (YYYY-MM-DD, etc.)
    date = new Date(dateStr);
  }

  if (isNaN(date.getTime())) return null;

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

  // Check against ignore list
  if (ignoreValues.includes(trimmed)) return null;

  // Match HH:MM:SS or HH:MM patterns
  const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;

  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);

  // Treat 00:00 as no work
  if (hours === 0 && minutes === 0) return null;

  // Validate ranges
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

/**
 * Detect the current week's date range (Monday to Sunday).
 * Returns { start: Date, end: Date, days: ["Mon"..."Sun"] }.
 */
function getCurrentWeekRange() {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon, ...
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

  const monday = new Date(now);
  monday.setDate(now.getDate() + mondayOffset);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  return { start: monday, end: sunday };
}

/**
 * Check if a date string falls within the current week (Mon-Sun).
 * @param {string} dateStr - DD/MM/YYYY or YYYY-MM-DD
 * @returns {boolean}
 */
function isCurrentWeek(dateStr) {
  if (!dateStr) return false;

  let date;
  const ddmmyyyy = dateStr.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (ddmmyyyy) {
    const [, dd, mm, yyyy] = ddmmyyyy;
    date = new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd));
  } else {
    date = new Date(dateStr);
  }

  if (isNaN(date.getTime())) return false;

  const { start, end } = getCurrentWeekRange();
  return date >= start && date <= end;
}

// ── Column Detection ──────────────────────────────────────────────────────────

/**
 * Find the index of a column by searching header cells for matching text.
 * Case-insensitive, partial match supported.
 * @param {HTMLTableRowElement[]} headerRows - <tr> elements from <thead> or first row
 * @param {string[]} identifiers - possible column names to match
 * @returns {number} column index (0-based) or -1 if not found
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

// ── Export (for content script / popup) ────────────────────────────────────────

// Using globalThis to share between content script and popup contexts
if (typeof globalThis !== "undefined") {
  globalThis.AttendanceUtils = {
    normalizeDayName,
    deriveDayFromDate,
    convertTime,
    timeToDecimalHours,
    getCurrentWeekRange,
    isCurrentWeek,
    findColumnIndex,
  };
}
