/**
 * popup.js — Extension Popup UI Logic
 *
 * Handles:
 *   - Fetch Attendance: Injects content.js into the active HRMS tab
 *   - Preview: Shows extracted data by date (not weekday) with summary stats
 *   - Month boundary indicator when week spans two months
 *   - Send to Tracker: Sends day-keyed data to wht.crypticani.dev via messaging
 *   - Copy JSON: Copies formatted JSON to clipboard
 */

(function () {
  "use strict";

  // ── DOM Refs ──────────────────────────────────────────────────────────────

  const btnFetch       = document.getElementById("btn-fetch");
  const btnSend        = document.getElementById("btn-send");
  const btnCopy        = document.getElementById("btn-copy");
  const btnClear       = document.getElementById("btn-clear");

  const statusBadge    = document.getElementById("status-badge");
  const statusArea     = document.getElementById("status-area");
  const statusIcon     = document.getElementById("status-icon");
  const statusText     = document.getElementById("status-text");

  const previewSection = document.getElementById("preview-section");
  const daysPreview    = document.getElementById("days-preview");
  const weekIndicator  = document.getElementById("week-indicator");
  const missingDays    = document.getElementById("missing-days");
  const missingText    = document.getElementById("missing-text");
  const metaInfo       = document.getElementById("meta-info");
  const metaText       = document.getElementById("meta-text");

  const summarySection = document.getElementById("summary-section");
  const summaryWorked  = document.getElementById("summary-worked");
  const summaryReq     = document.getElementById("summary-required");
  const summaryRem     = document.getElementById("summary-remaining");
  const summaryDays    = document.getElementById("summary-days");
  const summaryBar     = document.getElementById("summary-bar-fill");
  const summaryPct     = document.getElementById("summary-pct");

  const monthNotice    = document.getElementById("month-notice");
  const monthNoticeText = document.getElementById("month-notice-text");

  const logoutSection    = document.getElementById("logout-section");
  const logoutTimeEl     = document.getElementById("logout-time");
  const logoutIconEl     = document.getElementById("logout-icon");
  const logoutLabelEl    = document.getElementById("logout-label");
  const logoutLoginInfo  = document.getElementById("logout-login-info");
  const logoutRemInfo    = document.getElementById("logout-remaining-info");

  const postActions    = document.getElementById("post-actions");
  const sendResult     = document.getElementById("send-result");
  const sendIcon       = document.getElementById("send-icon");
  const sendTextEl     = document.getElementById("send-text");

  // ── State ─────────────────────────────────────────────────────────────────

  let currentResult = null; // Full extraction result
  let currentData = null;   // Legacy day-keyed { "Mon": "09:45", ... }

  // ── Init ──────────────────────────────────────────────────────────────────

  // Check for previously extracted data
  chrome.runtime.sendMessage({ action: "GET_LAST_EXTRACTION" }, (result) => {
    if (result && result.success && result.data) {
      currentResult = result;
      currentData = result.data;
      renderPreview(result);
    }
  });

  // ── Event Handlers ────────────────────────────────────────────────────────

  btnFetch.addEventListener("click", handleFetch);
  btnSend.addEventListener("click", handleSend);
  btnCopy.addEventListener("click", handleCopy);
  btnClear.addEventListener("click", handleClear);

  // ── Fetch Attendance ──────────────────────────────────────────────────────

  async function handleFetch() {
    setStatus("loading", "⏳", "Extracting attendance data...");
    setBadge("loading", "Working...");
    btnFetch.disabled = true;
    hideElement(previewSection);
    hideElement(postActions);
    hideElement(sendResult);
    if (summarySection) hideElement(summarySection);
    if (monthNotice) hideElement(monthNotice);
    if (logoutSection) hideElement(logoutSection);

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab) {
        setStatus("error", "❌", "No active tab found.");
        setBadge("error", "Error");
        btnFetch.disabled = false;
        return;
      }

      if (tab.url?.startsWith("chrome://") || tab.url?.startsWith("chrome-extension://")) {
        setStatus("error", "❌", "Cannot extract from browser internal pages. Navigate to your HRMS attendance page first.");
        setBadge("error", "Error");
        btnFetch.disabled = false;
        return;
      }

      chrome.runtime.sendMessage(
        { action: "EXTRACT_ATTENDANCE", tabId: tab.id },
        (result) => {
          btnFetch.disabled = false;

          if (chrome.runtime.lastError) {
            setStatus("error", "❌", `Extension error: ${chrome.runtime.lastError.message}`);
            setBadge("error", "Error");
            return;
          }

          if (!result) {
            setStatus("error", "❌", "No response from content script. Try refreshing the HRMS page.");
            setBadge("error", "Error");
            return;
          }

          if (!result.success) {
            const errorMsg = result.errors?.join("\n") || "Unknown error occurred.";
            setStatus("error", "❌", errorMsg);
            setBadge("error", "Failed");
            return;
          }

          // Success!
          currentResult = result;
          currentData = result.data;
          const count = Object.keys(result.data).length;

          setStatus("success", "✅", `Found ${count} day${count !== 1 ? "s" : ""} of attendance data.`);
          setBadge("success", `${count} Days`);
          renderPreview(result);
        }
      );

    } catch (err) {
      setStatus("error", "❌", `Error: ${err.message}`);
      setBadge("error", "Error");
      btnFetch.disabled = false;
    }
  }

  // ── Send to Tracker ───────────────────────────────────────────────────────

  function handleSend() {
    if (!currentData || Object.keys(currentData).length === 0) {
      setStatus("error", "❌", "No data to send. Fetch attendance first.");
      return;
    }

    btnSend.disabled = true;
    hideElement(sendResult);

    chrome.runtime.sendMessage(
      { action: "SEND_TO_TRACKER", data: currentData },
      (response) => {
        btnSend.disabled = false;

        if (chrome.runtime.lastError) {
          showSendResult(false, `Error: ${chrome.runtime.lastError.message}`);
          return;
        }

        if (!response || !response.success) {
          const error = response?.error || "Failed to send data to tracker.";
          showSendResult(false, error);
          return;
        }

        const msg = response.message || "Data sent successfully!";
        showSendResult(true, `✅ ${msg}. Check your tracker tab.`);
      }
    );
  }

  // ── Copy JSON ─────────────────────────────────────────────────────────────

  async function handleCopy() {
    if (!currentResult) return;

    // Build a rich JSON with both date-keyed and summary
    const exportData = {
      ...(currentResult.entries || {}),
      _summary: currentResult.summary || null,
      _legacy: currentData,
    };

    try {
      const json = JSON.stringify(exportData, null, 2);
      await navigator.clipboard.writeText(json);

      const originalText = btnCopy.innerHTML;
      btnCopy.innerHTML = '<span class="btn-icon-left">✅</span> Copied!';
      btnCopy.classList.add("copied");

      setTimeout(() => {
        btnCopy.innerHTML = originalText;
        btnCopy.classList.remove("copied");
      }, 2000);

    } catch (err) {
      const textarea = document.createElement("textarea");
      textarea.value = JSON.stringify(exportData, null, 2);
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
  }

  // ── Clear ─────────────────────────────────────────────────────────────────

  function handleClear() {
    currentResult = null;
    currentData = null;
    hideElement(previewSection);
    hideElement(postActions);
    hideElement(sendResult);
    if (summarySection) hideElement(summarySection);
    if (monthNotice) hideElement(monthNotice);
    if (logoutSection) hideElement(logoutSection);
    hideElement(statusArea);
    setBadge("", "Ready");

    chrome.runtime.sendMessage({ action: "CLEAR_DATA" });
  }

  // ── Render Preview ────────────────────────────────────────────────────────

  function renderPreview(result) {
    const entries = result.entries || {};
    const meta = result.meta || {};
    const summary = result.summary || null;

    daysPreview.innerHTML = "";

    // ── Month Boundary Notice ───────────────────────────────────────────
    if (meta.isMonthBoundary && monthNotice && monthNoticeText) {
      const excluded = meta.excludedDates || [];
      const excludedStr = excluded.map(d => d.display).join(", ");
      monthNoticeText.textContent = `Adjusted for month boundary — showing ${meta.currentMonthName} only. Excluded: ${excludedStr}`;
      showElement(monthNotice);
    } else if (monthNotice) {
      hideElement(monthNotice);
    }

    // ── Day Rows (date-keyed) ───────────────────────────────────────────
    const validDates = meta.validDatesList || [];
    const hasEntries = Object.keys(entries).length > 0;

    if (hasEntries) {
      // Show rows ordered by date
      const sortedDates = validDates.length > 0
        ? validDates
        : Object.keys(entries).sort();

      for (const isoDate of sortedDates) {
        const entry = entries[isoDate];
        const row = document.createElement("div");
        row.className = "day-row";

        const labelWrap = document.createElement("div");
        labelWrap.className = "day-label-wrap";

        const label = document.createElement("span");
        label.className = "day-label";

        const dateTag = document.createElement("span");
        dateTag.className = "day-date-tag";

        if (entry) {
          label.textContent = entry.day;
          dateTag.textContent = entry.display || isoDate;
        } else {
          // Valid date but no attendance data
          const d = new Date(isoDate + "T00:00:00");
          const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
          label.textContent = dayNames[d.getDay()];
          dateTag.textContent = formatDateSimple(d);
          row.classList.add("missing");
        }

        labelWrap.appendChild(label);
        labelWrap.appendChild(dateTag);

        const value = document.createElement("span");
        if (entry && entry.time) {
          value.className = "day-value";
          value.textContent = entry.time;
        } else {
          value.className = "day-value empty";
          value.textContent = "No data";
          row.classList.add("missing");
        }

        row.appendChild(labelWrap);
        row.appendChild(value);
        daysPreview.appendChild(row);
      }
    } else {
      // Fallback: legacy day-keyed rendering
      const data = result.data || {};
      const ALL_WORK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
      const orderedDays = [...ALL_WORK_DAYS];
      if (data["Sat"]) orderedDays.push("Sat");
      if (data["Sun"]) orderedDays.push("Sun");

      for (const day of orderedDays) {
        const row = document.createElement("div");
        row.className = "day-row";

        const label = document.createElement("span");
        label.className = "day-label";
        label.textContent = day;

        const value = document.createElement("span");
        if (data[day]) {
          value.className = "day-value";
          value.textContent = data[day];
        } else {
          value.className = "day-value empty";
          value.textContent = "No data";
          row.classList.add("missing");
        }

        row.appendChild(label);
        row.appendChild(value);
        daysPreview.appendChild(row);
      }
    }

    // ── Week Indicator ──────────────────────────────────────────────────
    if (meta.isMonthBoundary) {
      weekIndicator.textContent = `${meta.currentMonthName} · ${meta.daysConsidered}/${meta.totalWeekDays} days`;
    } else if (meta.currentWeekOnly) {
      weekIndicator.textContent = "Current Week";
    } else {
      weekIndicator.textContent = "All Visible";
    }
    showElement(weekIndicator);

    // ── Missing Days ────────────────────────────────────────────────────
    const datesWithData = new Set(Object.keys(entries));
    const missingDatesList = validDates.filter(d => !datesWithData.has(d));

    if (missingDatesList.length > 0) {
      const missingDisplay = missingDatesList.map(iso => {
        const d = new Date(iso + "T00:00:00");
        const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        return dayNames[d.getDay()];
      });
      missingText.textContent = `Missing: ${missingDisplay.join(", ")} — may be holiday/leave/not yet logged`;
      showElement(missingDays);
    } else {
      hideElement(missingDays);
    }

    // ── Meta Info ───────────────────────────────────────────────────────
    if (meta) {
      metaText.textContent = `${meta.validRowsExtracted} rows · ${meta.daysConsidered} day${meta.daysConsidered !== 1 ? "s" : ""} considered`;
      showElement(metaInfo);
    }

    // ── Summary Stats ───────────────────────────────────────────────────
    if (summary && summarySection) {
      if (summaryWorked) summaryWorked.textContent = summary.totalWorked;
      if (summaryReq) summaryReq.textContent = summary.required;

      if (summaryRem) {
        if (summary.surplus) {
          summaryRem.textContent = `+${summary.surplus}`;
          summaryRem.classList.add("surplus");
          summaryRem.classList.remove("deficit");
        } else if (summary.remainingMinutes > 0) {
          summaryRem.textContent = `-${summary.remaining}`;
          summaryRem.classList.add("deficit");
          summaryRem.classList.remove("surplus");
        } else {
          summaryRem.textContent = "00:00";
          summaryRem.classList.remove("surplus", "deficit");
        }
      }

      if (summaryDays) {
        summaryDays.textContent = `${summary.daysWithData}/${summary.daysConsidered}`;
      }

      if (summaryBar) {
        summaryBar.style.width = `${summary.percentComplete}%`;
        summaryBar.classList.toggle("complete", summary.percentComplete >= 100);
      }

      if (summaryPct) {
        summaryPct.textContent = `${summary.percentComplete}%`;
      }

      showElement(summarySection);
    }

    // ── Logout Time Card ────────────────────────────────────────────────
    if (summary && logoutSection) {
      if (summary.logoutStatus === "ok" && summary.logoutTime) {
        logoutTimeEl.textContent = format24to12(summary.logoutTime);
        logoutIconEl.textContent = "🕐";
        logoutLabelEl.textContent = "Today's Logout";
        logoutLoginInfo.textContent = `Login: ${format24to12(summary.todayLoginTime)}`;
        logoutRemInfo.textContent = `Remaining: ${summary.todayRemainingFormatted}`;
        logoutSection.className = "logout-section";
        showElement(logoutSection);
      } else if (summary.logoutStatus === "done") {
        logoutTimeEl.textContent = "Target Met ✅";
        logoutIconEl.textContent = "🎉";
        logoutLabelEl.textContent = "Weekly Target Complete";
        logoutLoginInfo.textContent = `Login: ${format24to12(summary.todayLoginTime)}`;
        logoutRemInfo.textContent = `Surplus: ${summary.surplus || "00:00"}`;
        logoutSection.className = "logout-section done";
        showElement(logoutSection);
      } else {
        // no-login: today login not found on page
        hideElement(logoutSection);
      }
    }

    showElement(previewSection);
    showElement(postActions);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function formatDateSimple(date) {
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return `${date.getDate()} ${monthNames[date.getMonth()]} (${dayNames[date.getDay()]})`;
  }

  /**
   * Convert 24h "HH:MM" to 12h "h:MM AM/PM" for display.
   * @param {string} time24 - "HH:MM" format
   * @returns {string} "h:MM AM/PM"
   */
  function format24to12(time24) {
    if (!time24) return "--:--";
    const [h, m] = time24.split(":").map(Number);
    if (isNaN(h) || isNaN(m)) return time24;
    const period = h >= 12 ? "PM" : "AM";
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}:${String(m).padStart(2, "0")} ${period}`;
  }

  function setStatus(type, icon, text) {
    statusIcon.textContent = icon;
    statusText.textContent = text;
    statusArea.className = `status-area ${type === "error" ? "error" : ""}`;
    showElement(statusArea);
  }

  function setBadge(type, text) {
    statusBadge.textContent = text;
    statusBadge.className = `header-badge ${type}`;
  }

  function showSendResult(success, message) {
    sendIcon.textContent = success ? "✅" : "❌";
    sendTextEl.textContent = message;
    sendResult.className = `send-result ${success ? "" : "error"}`;
    showElement(sendResult);
  }

  function showElement(el) { if (el) el.classList.remove("hidden"); }
  function hideElement(el) { if (el) el.classList.add("hidden"); }

})();
