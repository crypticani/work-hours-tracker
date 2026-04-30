/**
 * extension-prompt.js — Smart Extension Install Prompt
 *
 * Detects whether the HRMS Attendance Extractor extension is installed
 * and shows either:
 *   - "✅ Extension Connected" badge (if installed)
 *   - Non-intrusive install prompt banner (if not installed)
 *
 * Detection strategy:
 *   1. Check for DOM marker injected by tracker-bridge.js
 *   2. Check for custom event dispatched by the extension
 *   3. Retry with a short delay (extension content scripts load async)
 *
 * Persistence:
 *   - Dismissed prompts are stored in localStorage
 *   - Won't show again for 7 days after dismissal
 */

// ── Config ────────────────────────────────────────────────────────────────────

const DISMISS_KEY        = "wht_ext_prompt_dismissed";
const DISMISS_DAYS       = 7;
const DETECTION_DELAY_MS = 1500;  // Wait for extension content script to load
const RETRY_DELAY_MS     = 800;   // Second check
const CHROME_STORE_URL   = "https://github.com/crypticani/work-hours-tracker/tree/main/attendance-extension";

// ── Detection ─────────────────────────────────────────────────────────────────

/**
 * Check if the extension has injected its DOM marker.
 * The tracker-bridge.js sets: document.documentElement.dataset.whtExtension = "true"
 */
function isExtensionMarkerPresent() {
  return document.documentElement.dataset.whtExtension === "true";
}

/**
 * Check if the user is on a Chromium-based browser (extension only works on Chrome).
 */
function isChromiumBrowser() {
  const ua = navigator.userAgent;
  return /Chrome\//.test(ua) && !/Edg\//.test(ua) && !/OPR\//.test(ua)
    ? true
    : /Chrome\//.test(ua); // Also show for Edge/Brave/etc.
}

/**
 * Check if the user has previously dismissed the prompt within the cooldown period.
 */
function isDismissedRecently() {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const dismissedAt = parseInt(raw, 10);
    const daysSince = (Date.now() - dismissedAt) / (1000 * 60 * 60 * 24);
    return daysSince < DISMISS_DAYS;
  } catch {
    return false;
  }
}

/**
 * Record that the user dismissed the prompt.
 */
function recordDismissal() {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch { /* ignore */ }
}

// ── DOM Building ──────────────────────────────────────────────────────────────

/**
 * Build and insert the install prompt banner.
 */
function showInstallBanner() {
  // Don't duplicate
  if (document.getElementById("ext-install-banner")) return;

  const banner = document.createElement("div");
  banner.id = "ext-install-banner";
  banner.className = "ext-banner";
  banner.setAttribute("role", "complementary");
  banner.setAttribute("aria-label", "Extension install prompt");

  banner.innerHTML = `
    <div class="ext-banner-content">
      <div class="ext-banner-icon">⚡</div>
      <div class="ext-banner-text">
        <strong class="ext-banner-title">Save Time with Auto Attendance</strong>
        <span class="ext-banner-desc">Automatically fetch your work hours from HRMS and fill them here in one click.</span>
      </div>
      <div class="ext-banner-actions">
        <a id="ext-install-btn" class="btn btn-ext-install" href="${CHROME_STORE_URL}" target="_blank" rel="noopener">
          Install Extension
        </a>
        <button id="ext-dismiss-btn" class="btn btn-ext-dismiss" title="Dismiss for ${DISMISS_DAYS} days" aria-label="Dismiss prompt">
          ✕
        </button>
      </div>
    </div>
  `;

  // Insert at the very top of .app-wrapper, before the header
  const wrapper = document.querySelector(".app-wrapper");
  if (wrapper) {
    wrapper.insertBefore(banner, wrapper.firstChild);
  }

  // Force reflow then animate in
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      banner.classList.add("visible");
    });
  });

  // Wire dismiss button
  document.getElementById("ext-dismiss-btn").addEventListener("click", () => {
    banner.classList.remove("visible");
    banner.classList.add("dismissing");
    banner.addEventListener("transitionend", () => banner.remove(), { once: true });
    recordDismissal();
  });
}

/**
 * Build and insert the "Extension Connected" badge in the header.
 */
function showConnectedBadge() {
  // Don't duplicate
  if (document.getElementById("ext-connected-badge")) return;

  const badge = document.createElement("div");
  badge.id = "ext-connected-badge";
  badge.className = "ext-badge";
  badge.setAttribute("title", "HRMS Attendance Extractor is active");

  badge.innerHTML = `
    <span class="ext-badge-dot"></span>
    <span class="ext-badge-text">Extension Connected</span>
  `;

  // Insert into header actions area
  const headerActions = document.querySelector(".header-actions");
  if (headerActions) {
    headerActions.insertBefore(badge, headerActions.firstChild);
  }

  // Animate in
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      badge.classList.add("visible");
    });
  });
}

// ── Main Entry ────────────────────────────────────────────────────────────────

/**
 * Initialize extension detection and prompt logic.
 * Called from ui.js init().
 */
export function initExtensionPrompt() {
  // Only relevant for Chromium browsers
  if (!isChromiumBrowser()) return;

  // Listen for custom event from the extension (backup detection)
  window.addEventListener("wht-extension-ready", handleExtensionDetected);

  // First check — extension may already be loaded
  if (isExtensionMarkerPresent()) {
    handleExtensionDetected();
    return;
  }

  // Wait for extension content script to load (it runs at document_idle)
  setTimeout(() => {
    if (isExtensionMarkerPresent()) {
      handleExtensionDetected();
      return;
    }

    // Retry once more
    setTimeout(() => {
      if (isExtensionMarkerPresent()) {
        handleExtensionDetected();
      } else {
        handleExtensionNotDetected();
      }
    }, RETRY_DELAY_MS);

  }, DETECTION_DELAY_MS);
}

/**
 * Extension IS installed — show the connected badge.
 */
function handleExtensionDetected() {
  // Remove any install prompt that might have been shown
  const banner = document.getElementById("ext-install-banner");
  if (banner) {
    banner.classList.remove("visible");
    banner.addEventListener("transitionend", () => banner.remove(), { once: true });
  }

  showConnectedBadge();
}

/**
 * Extension is NOT installed — show install prompt (unless dismissed).
 */
function handleExtensionNotDetected() {
  if (isDismissedRecently()) return;
  showInstallBanner();
}
