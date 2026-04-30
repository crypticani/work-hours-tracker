/**
 * content.js — HRMS Attendance Page Scraper
 *
 * Injected into the HRMS attendance page via chrome.scripting.executeScript.
 * Parses the attendance table, extracts day + Final Login, and returns
 * structured data back to the popup.
 *
 * KEY DESIGN: Data is now keyed by ISO date (YYYY-MM-DD) rather than
 * weekday name alone. This enables month-boundary filtering — when a
 * work week spans two months, only days in the CURRENT month are included.
 *
 * This script is NOT auto-injected — it's executed on-demand when the user
 * clicks "Fetch Attendance" in the popup.
 */

(function () {
  "use strict";

  // ── Configuration ─────────────────────────────────────────────────────────

  const DAILY_TARGET_HOURS = 9; // Configurable daily work target

  // "Today Login" label identifiers (for the page header area, not the table)
  const TODAY_LOGIN_LABELS = [
    "today login", "today's login", "login time", "today_login",
    "current login", "check in", "check-in"
  ];

  // Column header identifiers (case-insensitive matching)
  const FINAL_LOGIN_IDS = [
    "final login", "final_login", "finallogin",
    "total hours", "worked hours", "working hours",
    "final hrs", "total hrs"
  ];

  const DATE_IDS = [
    "date", "att. date", "attendance date", "att date"
  ];

  const DAY_IDS = [
    "day", "shift day", "week day", "weekday"
  ];

  // Values to treat as "no work done"
  const IGNORE_TIME_VALUES = [
    "00:00:00", "00:00", "0:00:00", "0:00",
    "-", "--", "N/A", "n/a", ""
  ];

  // Full day name → short day mapping
  const FULL_TO_SHORT = {
    monday: "Mon", tuesday: "Tue", wednesday: "Wed",
    thursday: "Thu", friday: "Fri", saturday: "Sat", sunday: "Sun"
  };

  const SHORT_DAYS = new Set(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);

  // ── Date/Time Helpers ─────────────────────────────────────────────────────

  /**
   * Parse a date string (DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, or YYYY-MM-DD)
   * into a Date object. Returns null if unparseable.
   * @param {string} dateStr
   * @returns {Date|null}
   */
  function parseDate(dateStr) {
    if (!dateStr || typeof dateStr !== "string") return null;
    const trimmed = dateStr.trim();

    // DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY
    const ddmmyyyy = trimmed.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
    if (ddmmyyyy) {
      const [, dd, mm, yyyy] = ddmmyyyy;
      const d = new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd));
      return isNaN(d.getTime()) ? null : d;
    }

    // YYYY-MM-DD (ISO)
    const d = new Date(trimmed);
    return isNaN(d.getTime()) ? null : d;
  }

  /**
   * Format a Date object to ISO date string YYYY-MM-DD.
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
   * Format a Date to a display string like "30 Apr (Wed)".
   * @param {Date} date
   * @returns {string}
   */
  function formatDateDisplay(date) {
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${date.getDate()} ${monthNames[date.getMonth()]} (${dayNames[date.getDay()]})`;
  }

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

  function deriveDayFromDate(dateStr) {
    const date = parseDate(dateStr);
    if (!date) return null;
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return dayNames[date.getDay()];
  }

  function convertTime(timeStr) {
    if (!timeStr || typeof timeStr !== "string") return null;
    const trimmed = timeStr.trim();
    if (IGNORE_TIME_VALUES.includes(trimmed)) return null;
    const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!match) return null;
    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    if (hours === 0 && minutes === 0) return null;
    if (hours > 23 || minutes > 59) return null;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  /**
   * Convert 12-hour AM/PM time to 24-hour HH:MM format.
   * Handles: "09:38:41 AM" → "09:38", "02:30:00 PM" → "14:30"
   * @param {string} timeStr
   * @returns {string|null} "HH:MM" in 24h format, or null
   */
  function convertAMPM(timeStr) {
    if (!timeStr || typeof timeStr !== "string") return null;
    const trimmed = timeStr.trim();

    // Match "HH:MM:SS AM/PM" or "HH:MM AM/PM" (with optional seconds)
    const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|am|pm|a\.m\.|p\.m\.?)$/i);
    if (!match) {
      // Try without AM/PM — might already be 24h format
      return convertTime(timeStr);
    }

    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const period = match[4].toUpperCase().replace(/\./g, "");

    // Convert to 24h
    if (period === "AM" || period === "A") {
      if (hours === 12) hours = 0; // 12:xx AM = 00:xx
    } else if (period === "PM" || period === "P") {
      if (hours !== 12) hours += 12; // 1-11 PM → 13-23
    }

    if (hours > 23 || minutes > 59) return null;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  /**
   * Extract "Today Login" time from the HRMS page header/body.
   * Searches for text patterns like "Today Login 09:38:41 AM" or
   * "Today Login: 09:38:41 AM" anywhere on the page outside the table.
   * @returns {{ raw: string, time24: string, found: boolean }}
   */
  function extractTodayLogin() {
    const result = { raw: null, time24: null, found: false };

    // Strategy 1: Search all text nodes for "Today Login" + time pattern
    const allElements = document.querySelectorAll(
      "div, span, p, td, th, label, strong, b, h1, h2, h3, h4, h5, h6, li, small"
    );

    // Regex: matches "Today Login" (or variants) followed by a time
    const loginRegex = /today(?:'?s?)?\s*login[:\s]*([\d]{1,2}:[\d]{2}(?::[\d]{2})?(?:\s*(?:AM|PM|am|pm))?)/i;

    for (const el of allElements) {
      // Only check direct text content (avoid deep nesting noise)
      const text = el.textContent?.trim();
      if (!text || text.length > 200) continue;

      const match = text.match(loginRegex);
      if (match) {
        result.raw = match[1].trim();
        result.time24 = convertAMPM(result.raw);
        result.found = true;
        console.log(`[HRMS Extractor] ✅ Found Today Login: "${result.raw}" → ${result.time24}`);
        break;
      }
    }

    // Strategy 2: Look for elements with specific class/id patterns
    if (!result.found) {
      const candidates = document.querySelectorAll(
        "[class*='today'], [class*='login-time'], [class*='checkin'], " +
        "[id*='today'], [id*='login-time'], [id*='checkin']"
      );

      for (const el of candidates) {
        const text = el.textContent?.trim();
        if (!text) continue;
        // Look for time-like pattern
        const timeMatch = text.match(/(\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:AM|PM|am|pm))?)/);
        if (timeMatch) {
          result.raw = timeMatch[1].trim();
          result.time24 = convertAMPM(result.raw);
          result.found = true;
          console.log(`[HRMS Extractor] ✅ Found Today Login via selector: "${result.raw}" → ${result.time24}`);
          break;
        }
      }
    }

    if (!result.found) {
      console.log("[HRMS Extractor] ⚠️ Could not find Today Login on page");
    }

    return result;
  }

  // ── Week & Month Boundary Logic ───────────────────────────────────────────

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
   * Handles month boundaries: if the week spans Apr→May, only Apr days
   * are kept (assuming today is in April).
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

    return {
      validDates,
      filtered: validDates.length < dates.length,
      currentMonth,
      currentYear,
    };
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
   * Format minutes as "HH:MM".
   * @param {number} totalMinutes
   * @returns {string}
   */
  function formatMinutes(totalMinutes) {
    const h = Math.floor(Math.abs(totalMinutes) / 60);
    const m = Math.abs(totalMinutes) % 60;
    const sign = totalMinutes < 0 ? "-" : "";
    return `${sign}${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  // ── Column Detection ──────────────────────────────────────────────────────

  function findColIndex(headerCells, identifiers) {
    for (let i = 0; i < headerCells.length; i++) {
      const text = headerCells[i].textContent.trim().toLowerCase();
      for (const id of identifiers) {
        if (text === id || text.includes(id)) {
          return i;
        }
      }
    }
    return -1;
  }

  // ── Table Detection ───────────────────────────────────────────────────────

  function findAttendanceTable() {
    const tables = document.querySelectorAll("table");
    console.log(`[HRMS Extractor] Found ${tables.length} table(s) on page`);

    // Strategy 1: Find table with "Final Login" column
    for (const table of tables) {
      const headerRow = table.querySelector("thead tr, tr:first-child");
      if (!headerRow) continue;
      const headerCells = headerRow.querySelectorAll("th, td");
      const finalLoginIdx = findColIndex(headerCells, FINAL_LOGIN_IDS);
      if (finalLoginIdx !== -1) {
        console.log(`[HRMS Extractor] ✅ Found table with "Final Login" at column ${finalLoginIdx}`);
        return { table, headerCells, finalLoginIdx };
      }
    }

    // Strategy 2: Look for known HRMS container selectors
    const containerSelectors = [
      "[class*='attendance']", "[class*='grid']",
      "[id*='attendance']", "[id*='grid']",
      ".k-grid", ".ag-root", "[role='grid']",
    ];

    for (const sel of containerSelectors) {
      const container = document.querySelector(sel);
      if (!container) continue;
      const table = container.querySelector("table");
      if (!table) continue;
      const headerRow = table.querySelector("thead tr, tr:first-child");
      if (!headerRow) continue;
      const headerCells = headerRow.querySelectorAll("th, td");
      const finalLoginIdx = findColIndex(headerCells, FINAL_LOGIN_IDS);
      if (finalLoginIdx !== -1) {
        console.log(`[HRMS Extractor] ✅ Found table inside "${sel}" container`);
        return { table, headerCells, finalLoginIdx };
      }
    }

    // Strategy 3: Fallback — largest table with a time-like value
    let bestTable = null;
    let bestRowCount = 0;

    for (const table of tables) {
      const rows = table.querySelectorAll("tbody tr, tr");
      if (rows.length > bestRowCount) {
        const hasTime = Array.from(rows).some(row =>
          Array.from(row.cells).some(cell =>
            /\d{1,2}:\d{2}(:\d{2})?/.test(cell.textContent.trim())
          )
        );
        if (hasTime) {
          bestTable = table;
          bestRowCount = rows.length;
        }
      }
    }

    if (bestTable) {
      console.log(`[HRMS Extractor] ⚠️ Using fallback: largest table with ${bestRowCount} rows`);
      const headerRow = bestTable.querySelector("thead tr, tr:first-child");
      const headerCells = headerRow ? headerRow.querySelectorAll("th, td") : [];
      const finalLoginIdx = findColIndex(headerCells, FINAL_LOGIN_IDS);
      return { table: bestTable, headerCells, finalLoginIdx };
    }

    return null;
  }

  // ── Main Extraction ───────────────────────────────────────────────────────

  function extractAttendance() {
    // Generate this week's valid work dates (filtered by current month)
    const weekDates = generateWeekDates();
    const { validDates, filtered: isMonthBoundary, currentMonth, currentYear } = filterByMonth(weekDates);

    const monthNames = ["January", "February", "March", "April", "May", "June",
                        "July", "August", "September", "October", "November", "December"];

    // Extract today's login time from the page header
    const todayLogin = extractTodayLogin();

    const result = {
      success: false,
      // Date-keyed data → { "2026-04-28": { day: "Mon", date: "28/04/2026", time: "09:45", display: "28 Apr (Mon)" }, ... }
      entries: {},
      // Legacy day-keyed data for backward compat with tracker → { "Mon": "09:45", ... }
      data: {},
      rawRows: [],
      errors: [],
      // Today's login time (extracted from HRMS header)
      todayLogin,
      meta: {
        pageTitle: document.title,
        pageUrl: window.location.href,
        extractedAt: new Date().toISOString(),
        totalRowsScanned: 0,
        validRowsExtracted: 0,
        currentWeekOnly: true,
        isMonthBoundary,
        currentMonthName: monthNames[currentMonth],
        currentMonth,
        currentYear,
        daysConsidered: validDates.length,
        totalWeekDays: weekDates.length,
        dailyTargetHours: DAILY_TARGET_HOURS,
        validDatesList: validDates.map(d => toISODate(d)),
        excludedDates: weekDates
          .filter(d => d.getMonth() !== currentMonth || d.getFullYear() !== currentYear)
          .map(d => ({ iso: toISODate(d), display: formatDateDisplay(d) })),
      },
      // Weekly summary computed after extraction
      summary: null,
    };

    // Find the attendance table
    const found = findAttendanceTable();

    if (!found) {
      result.errors.push(
        "No attendance table found on this page. " +
        "Make sure you're on the HRMS attendance page with the table visible."
      );
      return result;
    }

    const { table, headerCells, finalLoginIdx } = found;

    // Find column indices
    let dateIdx = -1;
    let dayIdx = -1;

    if (headerCells.length > 0) {
      dateIdx = findColIndex(headerCells, DATE_IDS);
      dayIdx = findColIndex(headerCells, DAY_IDS);
    }

    console.log(`[HRMS Extractor] Column indices — Date: ${dateIdx}, Day: ${dayIdx}, Final Login: ${finalLoginIdx}`);

    // If Final Login column not identified, try to auto-detect time columns
    let effectiveFinalLoginIdx = finalLoginIdx;
    if (effectiveFinalLoginIdx === -1) {
      const firstDataRow = table.querySelector("tbody tr, tr:nth-child(2)");
      if (firstDataRow) {
        const cells = firstDataRow.querySelectorAll("td, th");
        for (let i = 0; i < cells.length; i++) {
          if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(cells[i].textContent.trim())) {
            effectiveFinalLoginIdx = i;
            console.log(`[HRMS Extractor] ⚠️ Auto-detected time column at index ${i}`);
            break;
          }
        }
      }
    }

    if (effectiveFinalLoginIdx === -1) {
      result.errors.push(
        'Could not find "Final Login" column. ' +
        "Looked for headers containing: " + FINAL_LOGIN_IDS.join(", ")
      );
      return result;
    }

    // Build a Set of valid ISO dates for quick lookup
    const validDateSet = new Set(validDates.map(d => toISODate(d)));

    // Get data rows (skip header)
    const allRows = table.querySelectorAll("tbody tr");
    const dataRows = allRows.length > 0
      ? allRows
      : Array.from(table.querySelectorAll("tr")).slice(1);

    result.meta.totalRowsScanned = dataRows.length;

    // Process each row
    for (const row of dataRows) {
      const cells = row.querySelectorAll("td, th");
      if (cells.length === 0) continue;

      // Skip rows with too few columns
      if (cells.length < Math.max(effectiveFinalLoginIdx + 1, 2)) continue;

      // Extract raw values
      const dateVal = dateIdx !== -1 && cells[dateIdx]
        ? cells[dateIdx].textContent.trim() : null;
      const dayVal = dayIdx !== -1 && cells[dayIdx]
        ? cells[dayIdx].textContent.trim() : null;
      const timeVal = cells[effectiveFinalLoginIdx]
        ? cells[effectiveFinalLoginIdx].textContent.trim() : null;

      // Skip completely empty rows
      if (!timeVal && !dateVal && !dayVal) continue;

      // Parse the date
      const parsedDate = parseDate(dateVal);
      const isoDate = parsedDate ? toISODate(parsedDate) : null;

      // Determine the day name
      let dayName = null;
      if (dayVal) dayName = normalizeDayName(dayVal);
      if (!dayName && dateVal) dayName = deriveDayFromDate(dateVal);

      // Skip if we can't determine the day
      if (!dayName) {
        console.log(`[HRMS Extractor] Skipping row — can't determine day: date="${dateVal}", day="${dayVal}"`);
        continue;
      }

      // Convert time
      const convertedTime = convertTime(timeVal);

      // Is this date in our valid set?
      const isValidDate = isoDate ? validDateSet.has(isoDate) : false;

      // Store raw row for debugging
      result.rawRows.push({
        date: dateVal,
        isoDate,
        day: dayName,
        rawTime: timeVal,
        convertedTime,
        isValidDate,
        isWeekend: parsedDate ? (parsedDate.getDay() === 0 || parsedDate.getDay() === 6) : false,
      });

      // Skip if no valid time
      if (!convertedTime) continue;

      // Only include dates that are in the valid set (current week + current month)
      if (isoDate && !isValidDate) {
        continue;
      }

      // If we don't have a date column, fall back to current-week check
      if (!isoDate) {
        // Can't do date-based filtering without dates, include all
        console.log(`[HRMS Extractor] ⚠️ No date for row, including by default: day=${dayName}`);
      }

      // Store date-keyed entry
      if (isoDate) {
        result.entries[isoDate] = {
          day: dayName,
          date: dateVal,
          time: convertedTime,
          display: parsedDate ? formatDateDisplay(parsedDate) : dateVal,
        };
      }

      // Legacy: store day-keyed data (last occurrence wins)
      result.data[dayName] = convertedTime;
      result.meta.validRowsExtracted++;
    }

    result.success = Object.keys(result.data).length > 0;

    // ── Compute Weekly Summary ──────────────────────────────────────────────

    if (result.success) {
      const workedTimes = Object.values(result.entries).map(e => e.time);
      const { totalMinutes: workedMinutes, formatted: totalWorked } = sumHours(workedTimes);

      const requiredMinutes = validDates.length * DAILY_TARGET_HOURS * 60;
      const remainingMinutes = requiredMinutes - workedMinutes;

      // ── Compute Logout Time ──────────────────────────────────────────────
      let logoutTime = null;
      let logoutStatus = "no-login";
      let todayRemainingMinutes = null;

      if (todayLogin.found && todayLogin.time24) {
        const [loginH, loginM] = todayLogin.time24.split(":").map(Number);
        const loginTotalMinutes = loginH * 60 + loginM;

        if (remainingMinutes <= 0) {
          // Already completed weekly target — can logout now
          logoutStatus = "done";
          logoutTime = null;
          todayRemainingMinutes = 0;
        } else {
          todayRemainingMinutes = remainingMinutes;
          const logoutTotalMinutes = loginTotalMinutes + remainingMinutes;
          const logoutH = Math.floor(logoutTotalMinutes / 60);
          const logoutM = logoutTotalMinutes % 60;
          logoutTime = `${String(logoutH).padStart(2, "0")}:${String(logoutM).padStart(2, "0")}`;
          logoutStatus = "ok";
        }
      }

      result.summary = {
        totalWorked,
        totalWorkedMinutes: workedMinutes,
        required: formatMinutes(requiredMinutes),
        requiredMinutes,
        remaining: formatMinutes(Math.max(0, remainingMinutes)),
        remainingMinutes: Math.max(0, remainingMinutes),
        surplus: remainingMinutes < 0 ? formatMinutes(Math.abs(remainingMinutes)) : null,
        surplusMinutes: remainingMinutes < 0 ? Math.abs(remainingMinutes) : 0,
        daysConsidered: validDates.length,
        daysWithData: Object.keys(result.entries).length,
        dailyTarget: DAILY_TARGET_HOURS,
        isMonthBoundary,
        percentComplete: requiredMinutes > 0
          ? Math.min(100, Math.round((workedMinutes / requiredMinutes) * 100))
          : 0,
        // Logout calculation
        todayLoginTime: todayLogin.time24,
        todayLoginRaw: todayLogin.raw,
        logoutTime,
        logoutStatus,
        todayRemainingMinutes,
        todayRemainingFormatted: todayRemainingMinutes !== null
          ? formatMinutes(todayRemainingMinutes) : null,
      };
    }

    if (!result.success) {
      result.errors.push(
        "No valid attendance data found. " +
        "All rows either had empty times, 00:00 values, or couldn't be parsed."
      );
    }

    console.log("[HRMS Extractor] Extraction complete:", JSON.stringify(result, null, 2));
    return result;
  }

  // ── Execute and return result ─────────────────────────────────────────────

  return extractAttendance();
})();
