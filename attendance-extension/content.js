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

  // Column header identifiers (case-insensitive matching)
  const FINAL_LOGIN_IDS = [
    "final login", "final_login", "finallogin",
    "total hours", "worked hours", "working hours",
    "final hrs", "total hrs"
  ];

  const DATE_IDS = [
    "date", "att. date", "attendance date", "att date", "shift date"
  ];

  const DAY_IDS = [
    "day", "shift day", "week day", "weekday"
  ];

  const Logic = globalThis.AttendanceLogic;
  if (!Logic) {
    throw new Error("Attendance calculation helpers were not loaded.");
  }
  const WORK_POLICY = Logic.resolveWorkPolicy(globalThis.__WHT_POLICY);

  // ── Today Login Extraction ────────────────────────────────────────────────

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
        result.time24 = Logic.convertLoginTime(result.raw);
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
          result.time24 = Logic.convertLoginTime(result.raw);
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
    const weekContext = Logic.buildWeekContext({ policy: WORK_POLICY });
    const {
      weekDates,
      validDates,
      isMonthBoundary,
      currentMonth,
      currentYear,
      currentMonthName,
      excludedDates,
      validIsoByDay,
    } = weekContext;

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
        currentMonthName,
        currentMonth,
        currentYear,
        daysConsidered: validDates.length,
        totalWeekDays: weekDates.length,
        dailyTargetHours: WORK_POLICY.dailyWorkHours,
        workPolicy: WORK_POLICY,
        validDatesList: validDates.map(d => Logic.toISODate(d)),
        refreshDays: Object.keys(validIsoByDay),
        excludedDates,
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
          if (/^\d+:\d{2}(:\d{2})?$/.test(cells[i].textContent.trim())) {
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
    const validDateSet = new Set(validDates.map(d => Logic.toISODate(d)));

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
      let parsedDate = Logic.parseDateStrict(dateVal);
      let isoDate = parsedDate ? Logic.toISODate(parsedDate) : null;

      // Determine the day name
      let dayName = null;
      if (dayVal) dayName = Logic.normalizeDayName(dayVal);
      if (!dayName && dateVal) dayName = Logic.deriveDayFromDate(dateVal);

      // Skip if we can't determine the day
      if (!dayName) {
        console.log(`[HRMS Extractor] Skipping row — can't determine day: date="${dateVal}", day="${dayVal}"`);
        continue;
      }

      // Convert time
      if (!isoDate && dayName && validIsoByDay[dayName]) {
        isoDate = validIsoByDay[dayName];
        parsedDate = Logic.parseDateStrict(isoDate);
      }

      const convertedTime = Logic.convertWorkedTime(timeVal);

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
      if (!isValidDate) continue;

      // Store date-keyed entry
      if (isoDate) {
        result.entries[isoDate] = {
          day: dayName,
          date: dateVal,
          time: convertedTime,
          display: parsedDate ? Logic.formatDateDisplay(parsedDate) : isoDate,
        };
      }

      // Legacy: store day-keyed data (last occurrence wins)
      result.data[dayName] = convertedTime;
      result.meta.validRowsExtracted++;
    }

    result.success = Object.keys(result.data).length > 0;

    // ── Compute Weekly Summary ──────────────────────────────────────────────

    if (result.success) {
      result.summary = Logic.computeAttendanceSummary({
        entries: result.entries,
        data: result.data,
        todayLogin,
        context: weekContext,
      });
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

  // ── Execute and expose result ─────────────────────────────────────────────

  let extractionResult;
  try {
    extractionResult = extractAttendance();
  } catch (err) {
    console.error("[HRMS Extractor] Extraction failed:", err);
    extractionResult = {
      success: false,
      entries: {},
      data: {},
      rawRows: [],
      errors: [err?.message || "Attendance extraction failed."],
      error: err?.stack || err?.message || String(err),
      todayLogin: { raw: null, time24: null, found: false },
      meta: {
        pageTitle: document.title,
        pageUrl: window.location.href,
        extractedAt: new Date().toISOString(),
      },
      summary: null,
    };
  }

  globalThis.__WHT_LAST_EXTRACTION = extractionResult;
  return extractionResult;
})();
