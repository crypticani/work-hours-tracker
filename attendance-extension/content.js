/**
 * content.js — HRMS Attendance Page Scraper
 *
 * Injected into the HRMS attendance page via chrome.scripting.executeScript.
 * Parses the attendance table, extracts day + Final Login + Leaves + Type +
 * Category Code, and returns structured data back to the popup.
 *
 * KEY DESIGN: Data is now keyed by ISO date (YYYY-MM-DD) rather than
 * weekday name alone. This enables month-boundary filtering — when a
 * work week spans two months, only days in the CURRENT month are included.
 *
 * v1.4 — Enhanced to extract Leave/ATR columns, detect department,
 *         capture pending days, and provide month-end analysis data.
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

  // ── New column identifiers for Leave/ATR support ──
  const LEAVES_IDS = [
    "leaves", "leave", "leave status", "leave type"
  ];

  const TYPE_IDS = [
    "type", "leave duration", "duration"
  ];

  const CATEGORY_CODE_IDS = [
    "category code", "category_code", "categorycode", "atr", "atr code"
  ];

  const WEEK_OFF_IDS = [
    "week off", "weekoff", "week_off", "weekly off"
  ];

  const Logic = globalThis.AttendanceLogic;
  if (!Logic) {
    throw new Error("Attendance calculation helpers were not loaded.");
  }
  const WORK_POLICY = Logic.resolveWorkPolicy(globalThis.__WHT_POLICY);

  // ── Department Extraction ─────────────────────────────────────────────────

  /**
   * Extract the selected department from the HRMS page.
   * Searches for <select> dropdowns or visible text containing department info.
   * @returns {string|null} Department name or null
   */
  function extractDepartment() {
    // Strategy 1: Find <select> with department-related id/name/label
    const selectors = [
      "select[id*='department' i]",
      "select[name*='department' i]",
      "select[id*='dept' i]",
      "select[name*='dept' i]",
    ];

    for (const sel of selectors) {
      const select = document.querySelector(sel);
      if (select && select.value) {
        console.log(`[HRMS Extractor] ✅ Found department via select: "${select.value}"`);
        return select.value.trim();
      }
    }

    // Strategy 2: Find label text "Department" near a select/input
    const labels = document.querySelectorAll("label, span, div, th, td");
    for (const el of labels) {
      const text = el.textContent?.trim();
      if (!text) continue;
      if (/^select\s*department$/i.test(text) || /^department$/i.test(text)) {
        // Check sibling or child select
        const parent = el.closest("div, td, th, fieldset, section");
        if (parent) {
          const select = parent.querySelector("select");
          if (select && select.value) {
            console.log(`[HRMS Extractor] ✅ Found department via label: "${select.value}"`);
            return select.value.trim();
          }
          // Check for a visible text value (non-select display)
          const valueEl = parent.querySelector(".value, .selected, [class*='selected']");
          if (valueEl && valueEl.textContent?.trim()) {
            return valueEl.textContent.trim();
          }
        }
      }
    }

    console.log("[HRMS Extractor] ⚠️ Could not detect department");
    return null;
  }

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

    // Extract department from the page controls
    const department = extractDepartment();

    const result = {
      success: false,
      // Date-keyed data → { "2026-04-28": { day: "Mon", date: "28/04/2026", time: "09:45", ... }, ... }
      entries: {},
      // Full month entries (for month-end analysis)
      allEntries: {},
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
        department,
      },
      // Weekly summary computed after extraction
      summary: null,
      // Month-end analysis
      monthAnalysis: null,
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
    let leavesIdx = -1;
    let typeIdx = -1;
    let categoryCodeIdx = -1;
    let weekOffIdx = -1;

    if (headerCells.length > 0) {
      dateIdx = findColIndex(headerCells, DATE_IDS);
      dayIdx = findColIndex(headerCells, DAY_IDS);
      leavesIdx = findColIndex(headerCells, LEAVES_IDS);
      typeIdx = findColIndex(headerCells, TYPE_IDS);
      categoryCodeIdx = findColIndex(headerCells, CATEGORY_CODE_IDS);
      weekOffIdx = findColIndex(headerCells, WEEK_OFF_IDS);
    }

    console.log(`[HRMS Extractor] Column indices — Date: ${dateIdx}, Day: ${dayIdx}, Final Login: ${finalLoginIdx}, Leaves: ${leavesIdx}, Type: ${typeIdx}, Category Code: ${categoryCodeIdx}, Week Off: ${weekOffIdx}`);

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

      // ── Extract new columns ──
      const leavesVal = leavesIdx !== -1 && cells[leavesIdx]
        ? cells[leavesIdx].textContent.trim() : null;
      const typeVal = typeIdx !== -1 && cells[typeIdx]
        ? cells[typeIdx].textContent.trim() : null;
      const categoryCodeVal = categoryCodeIdx !== -1 && cells[categoryCodeIdx]
        ? cells[categoryCodeIdx].textContent.trim() : null;
      const weekOffVal = weekOffIdx !== -1 && cells[weekOffIdx]
        ? cells[weekOffIdx].textContent.trim() : null;

      // Skip completely empty rows (no date, no day, no data at all)
      if (!timeVal && !dateVal && !dayVal && !leavesVal && !categoryCodeVal) continue;

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

      // Check if this is a weekend (Week Off)
      const isWeekOff = weekOffVal && weekOffVal.toLowerCase() === "yes";
      const isWeekend = isWeekOff || (parsedDate ? (parsedDate.getDay() === 0 || parsedDate.getDay() === 6) : false);

      // Is this date in our valid set?
      const isValidDate = isoDate ? validDateSet.has(isoDate) : false;

      // Determine if this is a Saturday
      const isSaturday = dayName === "Sat" || (parsedDate && parsedDate.getDay() === 6);

      // Store raw row for debugging
      result.rawRows.push({
        date: dateVal,
        isoDate,
        day: dayName,
        rawTime: timeVal,
        convertedTime,
        isValidDate,
        isWeekend,
        leaves: leavesVal || null,
        leaveType: typeVal || null,
        categoryCode: categoryCodeVal || null,
        weekOff: isWeekOff,
      });

      // ── Build enriched entry ──
      const enrichedEntry = {
        day: dayName,
        date: dateVal,
        time: convertedTime,
        rawFinalLogin: timeVal || null,
        leaves: (leavesVal && leavesVal.length > 0) ? leavesVal : null,
        leaveType: (typeVal && typeVal.length > 0) ? typeVal : null,
        categoryCode: (categoryCodeVal && categoryCodeVal.length > 0) ? categoryCodeVal : null,
        weekOff: isWeekOff,
        display: parsedDate ? Logic.formatDateDisplay(parsedDate) : isoDate,
      };

      // ── Store in allEntries (full month, for month-end analysis) ──
      // Include all rows that are in the current month, including weekends/pending
      if (isoDate && parsedDate &&
          parsedDate.getMonth() === currentMonth &&
          parsedDate.getFullYear() === currentYear) {
        // Skip Sundays (Week Off) from allEntries — they're not working days
        if (!isWeekOff) {
          result.allEntries[isoDate] = enrichedEntry;
        }
      }

      // ── Determine if this row should be in current-week entries ──
      // Previously: skip if no convertedTime
      // Now: include if it's a valid date AND is a working day
      //   - Has worked hours → include
      //   - Has leaves/categoryCode → include (Leave/ATR day)
      //   - Has nothing (pending) → include so we can flag it
      //   - Skip Sundays (Week Off)
      if (!isValidDate) continue;
      if (isWeekOff) continue;

      // Store date-keyed entry (current week, within month)
      if (isoDate) {
        result.entries[isoDate] = enrichedEntry;
      }

      // Legacy: store day-keyed data (only for rows with actual worked time)
      if (convertedTime) {
        result.data[dayName] = convertedTime;
        result.meta.validRowsExtracted++;
      }
    }

    // ── Handle auto-credit Saturdays for non-DevOps ──
    // For non-DevOps departments, ensure ALL Saturdays in the month get WFH entries
    // even if not explicitly in the HRMS table
    if (department && !Logic.isDevOpsDepartment(department)) {
      // Find all Saturdays in the current month
      const firstDay = new Date(currentYear, currentMonth, 1);
      const lastDay = new Date(currentYear, currentMonth + 1, 0);

      for (let d = new Date(firstDay); d <= lastDay; d.setDate(d.getDate() + 1)) {
        if (d.getDay() === 6) { // Saturday
          const satIso = Logic.toISODate(d);
          // Only add if not already present
          if (!result.allEntries[satIso]) {
            result.allEntries[satIso] = {
              day: "Sat",
              date: null,
              time: null,
              rawFinalLogin: null,
              leaves: "Work From Home",
              leaveType: "Full Day",
              categoryCode: null,
              weekOff: false,
              display: Logic.formatDateDisplay(d),
            };
          }

          // Also add to current week entries if it's a valid date
          if (validDateSet.has(satIso) && !result.entries[satIso]) {
            result.entries[satIso] = result.allEntries[satIso];
          }
        }
      }
    }

    result.success = Object.keys(result.entries).length > 0;

    // ── Compute Weekly Summary (enhanced) ──────────────────────────────────

    if (result.success) {
      result.summary = Logic.computeAttendanceSummary({
        entries: result.entries,
        data: result.data,
        todayLogin,
        context: weekContext,
        department,
      });
    }

    // ── Compute Month-End Analysis ──────────────────────────────────────────

    if (Object.keys(result.allEntries).length > 0) {
      result.monthAnalysis = Logic.computeMonthEndAnalysis({
        allEntries: result.allEntries,
        policy: WORK_POLICY,
        department,
        today: new Date(),
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
      allEntries: {},
      data: {},
      rawRows: [],
      errors: [err?.message || "Attendance extraction failed."],
      error: err?.stack || err?.message || String(err),
      todayLogin: { raw: null, time24: null, found: false },
      meta: {
        pageTitle: document.title,
        pageUrl: window.location.href,
        extractedAt: new Date().toISOString(),
        department: null,
      },
      summary: null,
      monthAnalysis: null,
    };
  }

  globalThis.__WHT_LAST_EXTRACTION = extractionResult;
  return extractionResult;
})();
