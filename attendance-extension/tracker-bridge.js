/**
 * tracker-bridge.js — Content Script for Work Hours Tracker
 *
 * Injected automatically into https://wht.crypticani.dev/*
 * Listens for messages from the popup/background to auto-fill
 * attendance data into the tracker's input fields.
 *
 * Integration points (from the tracker's ui.js):
 *   - Day type select: #type-{day} (e.g., #type-Mon)
 *   - Hours input: #hours-{day} (appears after selecting "Worked")
 *   - Week data localStorage key: "wht_weekdata_v1"
 */

(function () {
  "use strict";

  console.log("[WHT Bridge] Content script loaded on Work Hours Tracker");

  const Logic = globalThis.AttendanceLogic;
  if (!Logic) {
    throw new Error("Attendance calculation helpers were not loaded.");
  }

  // ── Expose presence marker for the website to detect ──────────────────────
  // The tracker site checks for this attribute to know the extension is installed.
  document.documentElement.dataset.whtExtension = "true";
  window.dispatchEvent(new CustomEvent("wht-extension-ready"));

  /**
   * Simulate user input on an element — triggers 'input' and 'change' events
   * so the tracker's event handlers pick up the value.
   */
  function simulateInput(element, value) {
    // Use the native setter to bypass React/framework interception
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, "value"
    )?.set;

    const nativeSelectValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLSelectElement.prototype, "value"
    )?.set;

    if (element.tagName === "SELECT" && nativeSelectValueSetter) {
      nativeSelectValueSetter.call(element, value);
    } else if (nativeInputValueSetter) {
      nativeInputValueSetter.call(element, value);
    } else {
      element.value = value;
    }

    // Dispatch events to trigger the tracker's handlers
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  /**
   * Wait for an element to appear in the DOM (handles dynamic rendering).
   */
  function waitForElement(selector, timeout = 3000) {
    return new Promise((resolve) => {
      const existing = document.querySelector(selector);
      if (existing) return resolve(existing);

      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) {
          observer.disconnect();
          resolve(el);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

      setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeout);
    });
  }

  /**
   * Auto-fill a single day's data into the tracker UI.
   * Steps:
   *   1. Set the day type to "worked"
   *   2. Wait for the hours input to render
   *   3. Fill in the hours value
   */
  async function fillDay(day, timeStr) {
    console.log(`[WHT Bridge] Filling ${day} = ${timeStr}`);

    // Step 1: Find and set the type dropdown
    const typeSelect = document.querySelector(`#type-${day}`);
    if (!typeSelect) {
      console.warn(`[WHT Bridge] Type select #type-${day} not found — day "${day}" may not be a working day in current config`);
      return { day, success: false, error: "Day not found in tracker (not a working day?)" };
    }

    // Set type to "worked"
    simulateInput(typeSelect, "worked");

    // Step 2: Wait for hours input to appear (rendered dynamically after type change)
    const hoursInput = await waitForElement(`#hours-${day}`, 2000);
    if (!hoursInput) {
      console.warn(`[WHT Bridge] Hours input #hours-${day} did not appear after setting type`);
      return { day, success: false, error: "Hours input didn't render" };
    }

    // Small delay to ensure DOM is settled
    await new Promise(r => setTimeout(r, 100));

    // Step 3: Set the hours value
    simulateInput(hoursInput, timeStr);

    console.log(`[WHT Bridge] ✅ ${day} filled successfully: ${timeStr}`);
    return { day, success: true, time: timeStr };
  }

  /**
   * Clear a day's visible tracker UI when a refreshed extraction no longer has
   * data for that day.
   */
  async function clearDay(day) {
    const typeSelect = document.querySelector(`#type-${day}`);
    if (!typeSelect) return { day, success: false, skipped: true };
    simulateInput(typeSelect, "");
    await new Promise(r => setTimeout(r, 50));
    return { day, success: true, cleared: true };
  }

  /**
   * Also update localStorage directly as a safety net.
   * The tracker stores week data under "wht_weekdata_v1".
   */
  function updateLocalStorage(attendanceData, refreshDays) {
    try {
      const WEEK_KEY = "wht_weekdata_v1";
      const existing = JSON.parse(localStorage.getItem(WEEK_KEY) || "{}");
      const merged = Logic.mergeTrackerWeekData({
        existing,
        attendanceData,
        refreshDays,
      });

      localStorage.setItem(WEEK_KEY, JSON.stringify(merged));
      console.log("[WHT Bridge] ✅ localStorage updated:", merged);
      return true;
    } catch (err) {
      console.error("[WHT Bridge] Failed to update localStorage:", err);
      return false;
    }
  }

  // ── Message Listener ──────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "GET_TRACKER_CONFIG") {
      try {
        const raw = localStorage.getItem("wht_config_v1");
        sendResponse({
          success: true,
          config: raw ? JSON.parse(raw) : null,
        });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      return false;
    }

    if (message.action !== "FILL_TRACKER") return false;

    console.log("[WHT Bridge] Received FILL_TRACKER message:", message.data);

    const attendanceData = message.data;
    const refreshDays = Array.isArray(message.refreshDays)
      ? message.refreshDays
      : Object.keys(attendanceData || {});
    if (!attendanceData || typeof attendanceData !== "object") {
      sendResponse({ success: false, error: "Invalid data received" });
      return false;
    }

    const days = Object.entries(attendanceData);
    const results = [];

    (async () => {
      const importedDays = new Set(Object.keys(attendanceData));
      for (const day of refreshDays) {
        if (!importedDays.has(day)) {
          await clearDay(day);
        }
      }

      // Persist after clearing UI controls so UI change handlers cannot restore stale values.
      const storageOk = updateLocalStorage(attendanceData, refreshDays);

      for (const [day, timeStr] of days) {
        const result = await fillDay(day, timeStr);
        results.push(result);
        // Small delay between days for visual feedback
        await new Promise(r => setTimeout(r, 150));
      }

      const allSuccess = results.every(r => r.success);
      const filledCount = results.filter(r => r.success).length;

      console.log(`[WHT Bridge] Fill complete: ${filledCount}/${days.length} days`);

      sendResponse({
        success: true,
        storageUpdated: storageOk,
        results,
        message: `Filled ${filledCount} of ${days.length} days`,
      });
    })();

    // Return true to indicate async response
    return true;
  });

  // ── Announce readiness ────────────────────────────────────────────────────

  // Let the popup know this tab has the bridge loaded
  chrome.runtime.sendMessage({ action: "BRIDGE_READY", url: window.location.href });

})();
