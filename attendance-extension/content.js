/**
 * content.js — HRMS Attendance Page Scraper
 *
 * Injected into the HRMS attendance page via chrome.scripting.executeScript.
 * Parses the attendance table, extracts day + Final Login, and returns
 * structured data back to the popup.
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

  // ── Helper Functions ──────────────────────────────────────────────────────

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
    if (!dateStr || typeof dateStr !== "string") return null;
    let date;
    const ddmmyyyy = dateStr.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
    if (ddmmyyyy) {
      const [, dd, mm, yyyy] = ddmmyyyy;
      date = new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd));
    } else {
      date = new Date(dateStr);
    }
    if (isNaN(date.getTime())) return null;
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

  function isCurrentWeek(dateStr) {
    if (!dateStr) return true; // If no date, assume current week
    let date;
    const ddmmyyyy = dateStr.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
    if (ddmmyyyy) {
      const [, dd, mm, yyyy] = ddmmyyyy;
      date = new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd));
    } else {
      date = new Date(dateStr);
    }
    if (isNaN(date.getTime())) return true; // Can't parse → include it
    const now = new Date();
    const dayOfWeek = now.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(now);
    monday.setDate(now.getDate() + mondayOffset);
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    return date >= monday && date <= sunday;
  }

  /**
   * Find column index by matching header text against identifiers.
   * @param {NodeListOf<Element>} headerCells - <th> or <td> elements from header row
   * @param {string[]} identifiers - possible column names
   * @returns {number} 0-based index or -1
   */
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

  /**
   * Find the attendance table by looking for a table that has
   * a "Final Login" (or equivalent) column header.
   * Tries multiple strategies:
   *   1. Look in all tables for matching header
   *   2. Look in common HRMS containers
   *   3. Fallback: largest table on page
   */
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
      "[class*='attendance']",
      "[class*='grid']",
      "[id*='attendance']",
      "[id*='grid']",
      ".k-grid",          // Kendo UI grids
      ".ag-root",         // AG Grid
      "[role='grid']",    // ARIA grid role
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
        // Check if any cell contains a time-like pattern
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

  /**
   * Extract attendance data from the current page.
   * @returns {{ success: boolean, data: Object, rawRows: Array, errors: string[], meta: Object }}
   */
  function extractAttendance() {
    const result = {
      success: false,
      data: {},          // { "Mon": "09:45", "Tue": "08:30", ... }
      rawRows: [],       // Raw parsed rows for debugging
      errors: [],
      meta: {
        pageTitle: document.title,
        pageUrl: window.location.href,
        extractedAt: new Date().toISOString(),
        totalRowsScanned: 0,
        validRowsExtracted: 0,
        currentWeekOnly: false,
      },
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
      // Scan first data row to find columns with time-like values
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

    // Get data rows (skip header)
    const allRows = table.querySelectorAll("tbody tr");
    const dataRows = allRows.length > 0
      ? allRows
      : Array.from(table.querySelectorAll("tr")).slice(1);

    result.meta.totalRowsScanned = dataRows.length;

    // Check if we have date info to filter by current week
    const hasDateColumn = dateIdx !== -1;
    let currentWeekFiltered = false;

    // Process each row
    for (const row of dataRows) {
      const cells = row.querySelectorAll("td, th");
      if (cells.length === 0) continue;

      // Skip rows with too few columns (likely summary/footer rows)
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

      // Determine the day name
      let dayName = null;

      // Priority 1: Use explicit Day column
      if (dayVal) {
        dayName = normalizeDayName(dayVal);
      }

      // Priority 2: Derive from Date column
      if (!dayName && dateVal) {
        dayName = deriveDayFromDate(dateVal);
      }

      // Skip if we can't determine the day
      if (!dayName) {
        console.log(`[HRMS Extractor] Skipping row — can't determine day: date="${dateVal}", day="${dayVal}"`);
        continue;
      }

      // Convert time
      const convertedTime = convertTime(timeVal);

      // Store raw row for debugging
      result.rawRows.push({
        date: dateVal,
        day: dayName,
        rawTime: timeVal,
        convertedTime: convertedTime,
        isCurrentWeek: hasDateColumn ? isCurrentWeek(dateVal) : null,
      });

      // Skip if no valid time
      if (!convertedTime) continue;

      // Filter by current week if we have date info
      if (hasDateColumn && dateVal) {
        if (!isCurrentWeek(dateVal)) {
          currentWeekFiltered = true;
          continue;
        }
      }

      // Store the data (last occurrence wins if same day appears twice)
      result.data[dayName] = convertedTime;
      result.meta.validRowsExtracted++;
    }

    result.meta.currentWeekOnly = currentWeekFiltered;
    result.success = Object.keys(result.data).length > 0;

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

  // This runs when the script is injected via chrome.scripting.executeScript
  return extractAttendance();
})();
