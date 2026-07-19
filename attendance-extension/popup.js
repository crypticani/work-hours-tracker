/**
 * popup.js — Extension Popup UI Logic
 *
 * Handles:
 *   - Fetch Attendance: Injects content.js into the active HRMS tab
 *   - Preview: Shows extracted data by date with status badges
 *   - Pending Leave/ATR display
 *   - Month-End Analysis with weekly breakdown and suggestions
 *   - Send to Tracker / Copy JSON
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

  const pendingSection = document.getElementById("pending-section");
  const pendingList    = document.getElementById("pending-list");
  const pendingCount   = document.getElementById("pending-count");

  const monthAnalysisSection = document.getElementById("month-analysis-section");
  const monthAnalysisLabel   = document.getElementById("month-analysis-label");
  const monthWeeks           = document.getElementById("month-weeks");

  const postActions    = document.getElementById("post-actions");
  const sendResult     = document.getElementById("send-result");
  const sendIcon       = document.getElementById("send-icon");
  const sendTextEl     = document.getElementById("send-text");

  // ── State ─────────────────────────────────────────────────────────────────

  let currentResult = null;
  let currentData = null;

  // ── Init ──────────────────────────────────────────────────────────────────

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
    hideAllSections();

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
            const errorMsg = result.errors?.join("\n") || result.error || "Unknown error occurred.";
            setStatus("error", "❌", errorMsg);
            setBadge("error", "Failed");
            return;
          }

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
      {
        action: "SEND_TO_TRACKER",
        data: currentData,
        refreshDays: currentResult?.meta?.refreshDays || Object.keys(currentData),
      },
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

    const exportData = {
      ...(currentResult.entries || {}),
      _summary: currentResult.summary || null,
      _monthAnalysis: currentResult.monthAnalysis || null,
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
    hideAllSections();
    setBadge("", "Ready");
    chrome.runtime.sendMessage({ action: "CLEAR_DATA" });
  }

  function hideAllSections() {
    hideElement(previewSection);
    hideElement(postActions);
    hideElement(sendResult);
    if (summarySection) hideElement(summarySection);
    if (monthNotice) hideElement(monthNotice);
    if (logoutSection) hideElement(logoutSection);
    if (pendingSection) hideElement(pendingSection);
    if (monthAnalysisSection) hideElement(monthAnalysisSection);
    hideElement(statusArea);
  }

  // ── Render Preview ────────────────────────────────────────────────────────

  function renderPreview(result) {
    const entries = result.entries || {};
    const meta = result.meta || {};
    const summary = result.summary || null;
    const monthAnalysis = result.monthAnalysis || null;

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

    // ── Day Rows (date-keyed with status badges) ────────────────────────
    const validDates = meta.validDatesList || [];
    const hasEntries = Object.keys(entries).length > 0;
    const classifications = summary?.dayClassifications || {};

    if (hasEntries) {
      const sortedDates = validDates.length > 0
        ? validDates
        : Object.keys(entries).sort();

      for (const isoDate of sortedDates) {
        const entry = entries[isoDate];
        const cls = classifications[isoDate] || null;
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
          const d = new Date(isoDate + "T00:00:00");
          const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
          label.textContent = dayNames[d.getDay()];
          dateTag.textContent = formatDateSimple(d);
          row.classList.add("missing");
        }

        labelWrap.appendChild(label);
        labelWrap.appendChild(dateTag);

        // ── Status Badge ──
        if (cls) {
          const badge = document.createElement("span");
          badge.className = `day-status-badge badge-${cls.status}`;
          badge.textContent = getStatusBadgeText(cls.status);
          labelWrap.appendChild(badge);
        }

        const value = document.createElement("span");
        if (cls && cls.status === "pending") {
          value.className = "day-value pending";
          value.textContent = cls.label ? `⏳ ${cls.label}` : "⏳ Pending";
          row.classList.add("pending-row");
        } else if (cls && (cls.status === "leave" || cls.status === "wfh")) {
          value.className = "day-value leave";
          const timeStr = entry?.time ? `${entry.time} + ` : "";
          value.textContent = `${timeStr}${cls.label}`;
        } else if (cls && cls.status === "atr") {
          value.className = "day-value atr";
          const timeStr = entry?.time ? `${entry.time} + ` : "";
          value.textContent = `${timeStr}${cls.label}`;
        } else if (entry && entry.time) {
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

    // ── Missing Days (legacy, only for non-enhanced) ────────────────────
    if (!summary?.isEnhanced) {
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
    } else {
      hideElement(missingDays);
    }

    // ── Meta Info ───────────────────────────────────────────────────────
    if (meta) {
      let metaStr = `${meta.validRowsExtracted} rows · ${meta.daysConsidered} day${meta.daysConsidered !== 1 ? "s" : ""} considered`;
      if (meta.department) metaStr += ` · ${meta.department}`;
      metaText.textContent = metaStr;
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
        summaryDays.textContent = `${summary.daysWithData}/${summary.isEnhanced ? summary.adjustedDaysConsidered : summary.daysConsidered}`;
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
        hideElement(logoutSection);
      }
    }

    // ── Pending Leave/ATR Section ────────────────────────────────────────
    renderPendingSection(summary);

    // ── Month-End Analysis ──────────────────────────────────────────────
    renderMonthAnalysis(monthAnalysis);

    showElement(previewSection);
    showElement(postActions);
  }

  // ── Pending Section ───────────────────────────────────────────────────────

  function renderPendingSection(summary) {
    if (!summary || !summary.pendingDays || summary.pendingDays.length === 0) {
      if (pendingSection) hideElement(pendingSection);
      return;
    }

    pendingList.innerHTML = "";
    const days = summary.pendingDays;

    if (pendingCount) {
      pendingCount.textContent = `${days.length} day${days.length !== 1 ? "s" : ""}`;
    }

    for (const pd of days) {
      const meta = pendingActionMeta(pd.actionType);
      const item = document.createElement("div");
      item.className = "pending-item";

      const icon = document.createElement("span");
      icon.className = "pending-icon";
      icon.textContent = meta.icon;

      const info = document.createElement("div");
      info.className = "pending-info";

      const dayLabel = document.createElement("span");
      dayLabel.className = "pending-day";
      dayLabel.textContent = pd.day;

      const dateLabel = document.createElement("span");
      dateLabel.className = "pending-date";
      dateLabel.textContent = pd.display || pd.isoDate;

      info.appendChild(dayLabel);
      info.appendChild(dateLabel);

      const action = document.createElement("span");
      action.className = "pending-action";
      action.textContent = meta.action;

      item.appendChild(icon);
      item.appendChild(info);
      item.appendChild(action);
      pendingList.appendChild(item);
    }

    showElement(pendingSection);
  }

  function pendingActionMeta(actionType) {
    switch (actionType) {
      case "atr-wfh": return { icon: "🏠", action: "File ATR (WFH)" };
      case "wfh-leave-atr": return { icon: "📅", action: "Mark Saturday (WFH Leave/ATR)" };
      default: return { icon: "⏳", action: "Apply Leave/ATR" };
    }
  }

  // ── Month-End Analysis ────────────────────────────────────────────────────

  function renderMonthAnalysis(analysis) {
    if (!analysis || !analysis.weeks || analysis.weeks.length === 0) {
      if (monthAnalysisSection) hideElement(monthAnalysisSection);
      return;
    }

    monthWeeks.innerHTML = "";

    if (monthAnalysisLabel) {
      monthAnalysisLabel.textContent = `${analysis.monthName} ${analysis.year}`;
    }

    for (const week of analysis.weeks) {
      const card = document.createElement("div");
      card.className = `week-card ${week.status}`;

      // ── Header ──
      const header = document.createElement("div");
      header.className = "week-card-header";

      const title = document.createElement("div");
      title.className = "week-card-title";
      title.textContent = `Week ${week.weekNumber}`;

      const dateRange = document.createElement("span");
      dateRange.className = "week-date-range";
      dateRange.textContent = `${formatIsoShort(week.startDate)} – ${formatIsoShort(week.endDate)}`;
      title.appendChild(dateRange);

      const status = document.createElement("div");
      status.className = `week-status ${week.status}`;

      if (week.status === "complete") {
        status.textContent = "✓ Complete";
      } else {
        const defH = Math.floor(week.deficitMinutes / 60);
        const defM = week.deficitMinutes % 60;
        const defStr = `${String(defH).padStart(2, "0")}:${String(defM).padStart(2, "0")}`;
        status.textContent = `⚠ Short by ${defStr}`;
      }

      header.appendChild(title);
      header.appendChild(status);
      card.appendChild(header);

      // ── Hours Breakdown ──
      const breakdown = document.createElement("div");
      breakdown.className = "week-breakdown";

      const workedH = Math.floor(week.workedMinutes / 60);
      const workedM = week.workedMinutes % 60;
      addBreakdownItem(breakdown, "Worked", `${String(workedH).padStart(2, "0")}:${String(workedM).padStart(2, "0")}`, "worked");

      if (week.leaveMinutes > 0) {
        const leaveH = Math.floor(week.leaveMinutes / 60);
        const leaveM = week.leaveMinutes % 60;
        addBreakdownItem(breakdown, "Leave/WFH", `${String(leaveH).padStart(2, "0")}:${String(leaveM).padStart(2, "0")}`, "leave");
      }

      if (week.atrMinutes > 0) {
        const atrH = Math.floor(week.atrMinutes / 60);
        const atrM = week.atrMinutes % 60;
        addBreakdownItem(breakdown, "ATR", `${String(atrH).padStart(2, "0")}:${String(atrM).padStart(2, "0")}`, "atr");
      }

      const targetH = Math.floor(week.targetMinutes / 60);
      const targetM = week.targetMinutes % 60;
      addBreakdownItem(breakdown, "Target", `${String(targetH).padStart(2, "0")}:${String(targetM).padStart(2, "0")}`, "target");

      card.appendChild(breakdown);

      // ── Pending Days ──
      if (week.pendingDays.length > 0) {
        const pendingWrap = document.createElement("div");
        pendingWrap.className = "week-pending";

        const pendingLabel = document.createElement("div");
        pendingLabel.className = "week-pending-label";
        pendingLabel.textContent = "⏳ Pending Leave/ATR:";
        pendingWrap.appendChild(pendingLabel);

        for (const pd of week.pendingDays) {
          const item = document.createElement("span");
          item.className = "week-pending-day";
          item.textContent = pd.day;
          pendingWrap.appendChild(item);
        }

        card.appendChild(pendingWrap);
      }

      // ── Suggestions ──
      if (week.suggestions.length > 0) {
        const sugWrap = document.createElement("div");
        sugWrap.className = "week-suggestions";

        const sugLabel = document.createElement("div");
        sugLabel.className = "week-suggestion-label";
        sugLabel.textContent = "💡 Suggested Leave/ATR:";
        sugWrap.appendChild(sugLabel);

        for (const sug of week.suggestions) {
          const item = document.createElement("div");
          item.className = `suggestion-item ${sug.type}`;

          const daySpan = document.createElement("span");
          daySpan.className = "suggestion-day";
          daySpan.textContent = sug.day;

          const reasonSpan = document.createElement("span");
          reasonSpan.className = "suggestion-reason";
          reasonSpan.textContent = sug.reason;

          item.appendChild(daySpan);
          item.appendChild(reasonSpan);
          sugWrap.appendChild(item);
        }

        card.appendChild(sugWrap);
      }

      monthWeeks.appendChild(card);
    }

    showElement(monthAnalysisSection);
  }

  function addBreakdownItem(container, label, value, type) {
    const item = document.createElement("div");
    item.className = `breakdown-item ${type}`;

    const lbl = document.createElement("span");
    lbl.className = "breakdown-label";
    lbl.textContent = label;

    const val = document.createElement("span");
    val.className = "breakdown-value";
    val.textContent = value;

    item.appendChild(lbl);
    item.appendChild(val);
    container.appendChild(item);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function getStatusBadgeText(status) {
    const map = {
      "worked": "✅", "wfh": "🏠", "leave": "🏖️",
      "atr": "📋", "pending": "⏳", "weekend": "🗓️",
    };
    return map[status] || "–";
  }

  function formatDateSimple(date) {
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return `${date.getDate()} ${monthNames[date.getMonth()]} (${dayNames[date.getDay()]})`;
  }

  function formatIsoShort(isoDate) {
    if (!isoDate) return "";
    const d = new Date(isoDate + "T00:00:00");
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${d.getDate()} ${monthNames[d.getMonth()]}`;
  }

  function format24to12(time24) {
    if (!time24) return "--:--";
    const [h, m] = time24.split(":").map(Number);
    if (isNaN(h) || isNaN(m)) return time24;
    
    const dayOffset = Math.floor(h / 24);
    const realH = h % 24;
    const period = realH >= 12 ? "PM" : "AM";
    const h12 = realH === 0 ? 12 : realH > 12 ? realH - 12 : realH;

    return `${h12}:${String(m).padStart(2, "0")} ${period}${dayOffset > 0 ? ` (+${dayOffset}d)` : ""}`;
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
