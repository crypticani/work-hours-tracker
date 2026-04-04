/**
 * calculator.js — Pure Calculation Logic
 *
 * All functions here are pure: they take data/config and return values.
 * No DOM access, no side effects — easy to unit-test independently.
 */

// ── Time Utilities ────────────────────────────────────────────────────────────

/**
 * Parse a flexible HH:MM (or H, H:MM, HH:MM) string to total minutes.
 * Handles overflow (e.g. "9:75" → normalizes correctly).
 * @param {string} str
 * @returns {number} total minutes (>= 0)
 */
export function parseTimeToMinutes(str) {
  if (!str || typeof str !== "string") return 0;
  str = str.trim();

  // Only digits → treat as hours
  if (/^\d+$/.test(str)) {
    return parseInt(str, 10) * 60;
  }

  if (str.includes(":")) {
    const parts = str.split(":").map((s) => s.trim());
    let h = parseInt(parts[0] || "0", 10) || 0;
    let m = parseInt(parts[1] || "0", 10) || 0;
    if (isNaN(h)) h = 0;
    if (isNaN(m)) m = 0;
    // Normalize minute overflow
    if (m >= 60) {
      h += Math.floor(m / 60);
      m = m % 60;
    }
    return h * 60 + m;
  }

  return 0;
}

/**
 * Format total minutes to "HH:MM" string. Handles negatives (shows minus sign).
 * @param {number} totalMinutes
 * @returns {string}
 */
export function formatMinutesToHHMM(totalMinutes) {
  const sign = totalMinutes < 0 ? "-" : "";
  const abs = Math.abs(totalMinutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Format decimal hours as HH:MM string (e.g. 4.5 → "04:30", 9 → "09:00").
 * Handles negatives (prefixes with "-").
 * @param {number} hours
 * @returns {string}
 */
export function formatHoursAsHHMM(hours) {
  return formatMinutesToHHMM(Math.round(hours * 60));
}

// ── Core Calculations ─────────────────────────────────────────────────────────

/**
 * Calculate total completed (credited) hours for the week.
 *
 * Credit rules:
 *   - "worked"      → `entry.hours` (decimal or HH:MM parsed)
 *   - "holiday"     → config.dailyWorkHours (full day credit)
 *   - "half-day"    → config.halfDayHours
 *   - "in-progress" → 0 (not yet completed)
 *   - (empty/none)  → 0
 *
 * @param {Object} weekData  - { Mon: { type, hours?, loginTime? }, ... }
 * @param {Object} config    - company policy config
 * @returns {number} total completed hours (decimal)
 */
export function calculateTotalCompletedHours(weekData, config) {
  let total = 0;

  for (const day of config.workingDays) {
    const entry = weekData[day];

    // No entry OR unselected type → assume full day (auto-credit)
    if (!entry || !entry.type) {
      total += config.dailyWorkHours;
      continue;
    }

    switch (entry.type) {
      case "worked":
        // hours may be a decimal number or an HH:MM string
        if (typeof entry.hours === "number") {
          total += entry.hours;
        } else if (typeof entry.hours === "string" && entry.hours.trim()) {
          total += parseTimeToMinutes(entry.hours) / 60;
        } else {
          // type is worked but no hours entered yet → full credit
          total += config.dailyWorkHours;
        }
        break;

      case "wfh":
        // Work from home = full day credit
        total += config.dailyWorkHours;
        break;

      case "holiday":
        total += config.dailyWorkHours;
        break;

      case "half-day":
        total += config.halfDayHours;
        break;

      case "in-progress":
        // Not complete yet — contributes 0 to "completed"
        break;

      default:
        // Unknown type → full credit as safety fallback
        total += config.dailyWorkHours;
        break;
    }
  }

  return total;
}

/**
 * Calculate remaining hours needed to hit the weekly target.
 * Negative means the user has exceeded the quota (surplus).
 *
 * @param {number} totalCompleted - hours completed so far
 * @param {Object} config
 * @returns {number} remaining hours (may be negative)
 */
export function calculateRemainingHours(totalCompleted, config) {
  return config.totalWeeklyHours - totalCompleted;
}

/**
 * Given a login time string and the remaining hours to work,
 * calculate the exact logout time.
 *
 * @param {string} loginTime     - "HH:MM" (24-hour)
 * @param {number} remainingHours - decimal hours (may be negative/zero)
 * @returns {{ logoutTime: string, status: "ok"|"already-done"|"invalid-login" }}
 */
export function calculateLogoutTime(loginTime, remainingHours) {
  if (!loginTime || typeof loginTime !== "string" || !loginTime.trim()) {
    return { logoutTime: null, status: "invalid-login" };
  }

  const loginMinutes = parseTimeToMinutes(loginTime);

  // Invalid login time (00:00 may be intentional, but empty string caught above)
  if (loginMinutes < 0) {
    return { logoutTime: null, status: "invalid-login" };
  }

  // Already done this week
  if (remainingHours <= 0) {
    return { logoutTime: null, status: "already-done" };
  }

  const logoutMinutes = loginMinutes + Math.round(remainingHours * 60);

  // Handle day overflow (past midnight) — show >24h format
  const h = Math.floor(logoutMinutes / 60);
  const m = logoutMinutes % 60;
  const logoutTime = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

  return { logoutTime, status: "ok" };
}

// ── Stats Helpers ─────────────────────────────────────────────────────────────

/**
 * Count how many working days still have no data entered (empty type, excluding in-progress).
 * @param {Object} weekData
 * @param {Object} config
 * @returns {number}
 */
/**
 * Count how many working days are unlabeled (no type selected).
 * These days are auto-credited full hours, but showing the count
 * helps the user know how many days they haven't classified yet.
 * @param {Object} weekData
 * @param {Object} config
 * @returns {number}
 */
export function countPendingDays(weekData, config) {
  return config.workingDays.filter((day) => {
    const entry = weekData[day];
    return !entry || !entry.type || entry.type === "";
  }).length;
}

/**
 * Calculate required daily average for remaining empty days.
 * Returns null if no pending days.
 * @param {number} remainingHours
 * @param {number} pendingDays
 * @returns {number|null}
 */
export function calculateRequiredAvg(remainingHours, pendingDays) {
  if (pendingDays <= 0 || remainingHours <= 0) return null;
  return remainingHours / pendingDays;
}

/**
 * Validate a "worked" hours value — warn if it exceeds the daily limit.
 * @param {number} hours
 * @param {Object} config
 * @returns {{ valid: boolean, warning: string|null }}
 */
export function validateWorkedHours(hours, config) {
  if (isNaN(hours) || hours < 0) {
    return { valid: false, warning: "Hours must be a positive number." };
  }
  if (hours > config.dailyWorkHours * 2) {
    return { valid: true, warning: `${hours}h seems very high. Daily limit is ${config.dailyWorkHours}h.` };
  }
  if (hours > config.dailyWorkHours) {
    return { valid: true, warning: `${hours}h exceeds daily limit of ${config.dailyWorkHours}h (overtime).` };
  }
  return { valid: true, warning: null };
}
