/**
 * background.js — Service Worker (Manifest V3)
 *
 * Handles:
 *   1. Orchestrating communication between HRMS tab ↔ Popup ↔ Tracker tab
 *   2. Badge updates for visual feedback
 *   3. Storing last extraction result for popup access
 */

// ── State ───────────────────────────────────────────────────────────────────

let lastExtraction = null;
let trackerTabId = null;

// ── Message Handlers ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {

    // ── Popup requests data extraction from HRMS tab ──
    case "EXTRACT_ATTENDANCE": {
      const tabId = message.tabId;
      console.log(`[BG] Extracting attendance from tab ${tabId}`);

      chrome.scripting.executeScript(
        {
          target: { tabId },
          files: ["content.js"],
        },
        (results) => {
          if (chrome.runtime.lastError) {
            console.error("[BG] Script injection failed:", chrome.runtime.lastError.message);
            sendResponse({
              success: false,
              error: chrome.runtime.lastError.message,
            });
            return;
          }

          if (!results || results.length === 0 || !results[0].result) {
            sendResponse({
              success: false,
              error: "No result returned from content script. Make sure you're on the HRMS attendance page.",
            });
            return;
          }

          const extraction = results[0].result;
          lastExtraction = extraction;

          // Update badge
          if (extraction.success) {
            const count = Object.keys(extraction.data).length;
            chrome.action.setBadgeText({ text: String(count) });
            chrome.action.setBadgeBackgroundColor({ color: "#3fb950" });
          } else {
            chrome.action.setBadgeText({ text: "!" });
            chrome.action.setBadgeBackgroundColor({ color: "#f85149" });
          }

          sendResponse(extraction);
        }
      );

      return true; // Async response
    }

    // ── Popup requests sending data to tracker tab ──
    case "SEND_TO_TRACKER": {
      const data = message.data;
      console.log("[BG] Sending data to tracker:", data);

      findTrackerTab()
        .then((tabId) => {
          if (!tabId) {
            sendResponse({
              success: false,
              error: "Work Hours Tracker is not open. Please open https://wht.crypticani.dev first.",
            });
            return;
          }

          trackerTabId = tabId;

          // Send data to the tracker tab's content script
          chrome.tabs.sendMessage(
            tabId,
            { action: "FILL_TRACKER", data },
            (response) => {
              if (chrome.runtime.lastError) {
                console.error("[BG] Failed to send to tracker:", chrome.runtime.lastError.message);
                sendResponse({
                  success: false,
                  error: "Failed to communicate with tracker. Try refreshing the tracker page.",
                });
                return;
              }

              // Focus the tracker tab for visual confirmation
              chrome.tabs.update(tabId, { active: true });

              sendResponse(response || { success: true });
            }
          );
        })
        .catch((err) => {
          sendResponse({ success: false, error: err.message });
        });

      return true; // Async response
    }

    // ── Tracker bridge announces readiness ──
    case "BRIDGE_READY": {
      if (sender.tab) {
        trackerTabId = sender.tab.id;
        console.log(`[BG] Tracker bridge ready on tab ${trackerTabId}`);
      }
      break;
    }

    // ── Get last extraction (popup re-opened) ──
    case "GET_LAST_EXTRACTION": {
      sendResponse(lastExtraction);
      break;
    }

    // ── Clear stored data ──
    case "CLEAR_DATA": {
      lastExtraction = null;
      chrome.action.setBadgeText({ text: "" });
      sendResponse({ success: true });
      break;
    }
  }
});

// ── Tab Finder ──────────────────────────────────────────────────────────────

/**
 * Find the Work Hours Tracker tab.
 * @returns {Promise<number|null>} Tab ID or null
 */
async function findTrackerTab() {
  const tabs = await chrome.tabs.query({
    url: ["https://wht.crypticani.dev/*", "http://localhost:*/*"],
  });

  if (tabs.length > 0) {
    return tabs[0].id;
  }

  // Fallback: check all tabs for matching URL pattern
  const allTabs = await chrome.tabs.query({});
  const tracker = allTabs.find(
    (tab) => tab.url && (
      tab.url.includes("wht.crypticani.dev") ||
      tab.url.includes("work-hours-tracker")
    )
  );

  return tracker ? tracker.id : null;
}

// ── Install / Update ────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
  console.log("[BG] Extension installed/updated:", details.reason);
  chrome.action.setBadgeText({ text: "" });
});
