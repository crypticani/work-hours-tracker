/**
 * popup.js — Extension Popup UI Logic
 *
 * Handles:
 *   - Fetch Attendance: Injects content.js into the active HRMS tab
 *   - Preview: Shows extracted data in the popup
 *   - Send to Tracker: Sends data to wht.crypticani.dev via messaging
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

  const postActions    = document.getElementById("post-actions");
  const sendResult     = document.getElementById("send-result");
  const sendIcon       = document.getElementById("send-icon");
  const sendTextEl     = document.getElementById("send-text");

  // ── State ─────────────────────────────────────────────────────────────────

  let currentData = null;  // { "Mon": "09:45", ... }
  const ALL_WORK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

  // ── Init ──────────────────────────────────────────────────────────────────

  // Check for previously extracted data
  chrome.runtime.sendMessage({ action: "GET_LAST_EXTRACTION" }, (result) => {
    if (result && result.success && result.data) {
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
    // Show loading state
    setStatus("loading", "⏳", "Extracting attendance data...");
    setBadge("loading", "Working...");
    btnFetch.disabled = true;
    hideElement(previewSection);
    hideElement(postActions);
    hideElement(sendResult);

    try {
      // Get the active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab) {
        setStatus("error", "❌", "No active tab found.");
        setBadge("error", "Error");
        btnFetch.disabled = false;
        return;
      }

      // Check if we have permission to inject into this tab
      if (tab.url?.startsWith("chrome://") || tab.url?.startsWith("chrome-extension://")) {
        setStatus("error", "❌", "Cannot extract from browser internal pages. Navigate to your HRMS attendance page first.");
        setBadge("error", "Error");
        btnFetch.disabled = false;
        return;
      }

      // Send extraction request to background
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
    if (!currentData) return;

    try {
      const json = JSON.stringify(currentData, null, 2);
      await navigator.clipboard.writeText(json);

      // Visual feedback
      const originalText = btnCopy.innerHTML;
      btnCopy.innerHTML = '<span class="btn-icon-left">✅</span> Copied!';
      btnCopy.classList.add("copied");

      setTimeout(() => {
        btnCopy.innerHTML = originalText;
        btnCopy.classList.remove("copied");
      }, 2000);

    } catch (err) {
      // Fallback: textarea copy
      const textarea = document.createElement("textarea");
      textarea.value = JSON.stringify(currentData, null, 2);
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
  }

  // ── Clear ─────────────────────────────────────────────────────────────────

  function handleClear() {
    currentData = null;
    hideElement(previewSection);
    hideElement(postActions);
    hideElement(sendResult);
    hideElement(statusArea);
    setBadge("", "Ready");

    chrome.runtime.sendMessage({ action: "CLEAR_DATA" });
  }

  // ── Render Preview ────────────────────────────────────────────────────────

  function renderPreview(result) {
    const data = result.data;
    daysPreview.innerHTML = "";

    // Determine which days to show (all work days, marking missing ones)
    const presentDays = new Set(Object.keys(data));
    const missingDaysList = ALL_WORK_DAYS.filter(d => !presentDays.has(d));

    // Show all days in order (Mon → Fri for work days, then any weekend data)
    const orderedDays = [...ALL_WORK_DAYS];
    // Add any weekend days that have data
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

    // Week indicator
    if (result.meta?.currentWeekOnly) {
      weekIndicator.textContent = "Current Week";
      showElement(weekIndicator);
    } else {
      weekIndicator.textContent = "All Visible";
      showElement(weekIndicator);
    }

    // Missing days warning
    if (missingDaysList.length > 0) {
      missingText.textContent = `Missing: ${missingDaysList.join(", ")} — may be holiday/leave/not yet logged`;
      showElement(missingDays);
    } else {
      hideElement(missingDays);
    }

    // Meta info
    if (result.meta) {
      metaText.textContent = `${result.meta.validRowsExtracted} rows · ${result.meta.pageTitle?.slice(0, 40) || "HRMS"}`;
      showElement(metaInfo);
    }

    showElement(previewSection);
    showElement(postActions);
  }

  // ── UI Helpers ────────────────────────────────────────────────────────────

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

  function showElement(el) { el.classList.remove("hidden"); }
  function hideElement(el) { el.classList.add("hidden"); }

})();
