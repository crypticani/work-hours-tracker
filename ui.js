/**
 * ui.js — DOM Rendering & Interaction Layer
 *
 * Wires together config, calculator, and the HTML.
 * All DOM manipulation lives here; no business logic.
 */

import {
  PRESETS,
  loadConfig,
  saveConfig,
  loadWeekData,
  saveWeekData,
  clearWeekData,
} from "./config.js";

import { initExtensionPrompt } from "./extension-prompt.js";

import {
  calculateTotalCompletedHours,
  calculateRemainingHours,
  calculateLogoutTime,
  countPendingDays,
  calculateRequiredAvg,
  validateWorkedHours,
  formatMinutesToHHMM,
  formatHoursAsHHMM,
  parseTimeToMinutes,
} from "./calculator.js";

// ── State ─────────────────────────────────────────────────────────────────────

let config   = loadConfig();
let weekData = loadWeekData();

// ── DOM Refs ──────────────────────────────────────────────────────────────────

const presetBar        = document.getElementById("preset-bar");
const inputTotalHours  = document.getElementById("cfg-total-hours");
const inputDailyHours  = document.getElementById("cfg-daily-hours");
const inputHalfDay     = document.getElementById("cfg-half-day");
const inputWorkingDays = document.getElementById("cfg-working-days");

const daysGrid         = document.getElementById("days-grid");

const statCompleted    = document.getElementById("stat-completed");
const statCompletedSub = document.getElementById("stat-completed-sub");
const statRemaining    = document.getElementById("stat-remaining");
const statRemainingSub = document.getElementById("stat-remaining-sub");
const statAvg          = document.getElementById("stat-avg");
const statAvgSub       = document.getElementById("stat-avg-sub");
const progressFill     = document.getElementById("progress-fill");
const progressPct      = document.getElementById("progress-pct");
const progressTarget   = document.getElementById("progress-target");

const logoutBanner     = document.getElementById("logout-banner");
const logoutTime       = document.getElementById("logout-time");
const logoutSub        = document.getElementById("logout-sub");
const logoutLabel      = document.getElementById("logout-label");
const logoutIcon       = document.getElementById("logout-icon");

const btnResetWeek     = document.getElementById("btn-reset-week");
const btnThemeToggle   = document.getElementById("btn-theme-toggle");

// ── Theme ─────────────────────────────────────────────────────────────────────

function initTheme() {
  const saved = localStorage.getItem("wht_theme");
  if (saved === "light") {
    document.body.classList.add("light-mode");
    btnThemeToggle.textContent = "☀️";
    btnThemeToggle.title = "Switch to dark mode";
  }
}

function toggleTheme() {
  const isLight = document.body.classList.toggle("light-mode");
  localStorage.setItem("wht_theme", isLight ? "light" : "dark");
  btnThemeToggle.textContent = isLight ? "☀️" : "🌙";
  btnThemeToggle.title = isLight ? "Switch to dark mode" : "Switch to light mode";
}

// ── Preset Bar ────────────────────────────────────────────────────────────────

function renderPresets() {
  presetBar.innerHTML = "";
  Object.entries(PRESETS).forEach(([key, preset]) => {
    const chip = document.createElement("button");
    chip.className = "preset-chip";
    chip.dataset.key = key;
    chip.textContent = preset.label;
    chip.addEventListener("click", () => applyPreset(key));
    presetBar.appendChild(chip);
  });
  refreshActivePreset();
}

function refreshActivePreset() {
  document.querySelectorAll(".preset-chip").forEach((chip) => {
    const p = PRESETS[chip.dataset.key];
    const matches =
      p &&
      p.totalWeeklyHours  === config.totalWeeklyHours  &&
      p.dailyWorkHours    === config.dailyWorkHours     &&
      p.workingDays.join() === config.workingDays.join();
    chip.classList.toggle("active", matches);
  });
}

function applyPreset(key) {
  const preset = PRESETS[key];
  if (!preset) return;
  config = { ...preset };
  syncConfigInputs();
  saveConfig(config);
  refreshActivePreset();
  // Rebuild week grid since working days may have changed
  weekData = loadWeekData();
  renderDaysGrid();
  updateSummary();
}

// ── Config Inputs ─────────────────────────────────────────────────────────────

function syncConfigInputs() {
  inputTotalHours.value  = config.totalWeeklyHours;
  inputDailyHours.value  = config.dailyWorkHours;
  inputHalfDay.value     = config.halfDayHours;
  // Working days: check/uncheck checkboxes
  document.querySelectorAll(".day-checkbox").forEach((cb) => {
    cb.checked = config.workingDays.includes(cb.value);
  });
}

function buildWorkingDayChecks() {
  const ALL_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  inputWorkingDays.innerHTML = "";

  ALL_DAYS.forEach((day) => {
    const label = document.createElement("label");
    label.className = "day-check-label";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "day-checkbox";
    cb.value = day;
    cb.checked = config.workingDays.includes(day);
    cb.id = `day-check-${day}`;

    cb.addEventListener("change", () => {
      const checked = Array.from(document.querySelectorAll(".day-checkbox:checked")).map(
        (el) => el.value
      );
      // Keep original weekday order
      config.workingDays = ALL_DAYS.filter((d) => checked.includes(d));
      config.workDaysPerWeek = config.workingDays.length;
      saveConfig(config);
      refreshActivePreset();
      renderDaysGrid();
      updateSummary();
    });

    const span = document.createElement("span");
    span.textContent = day;

    label.appendChild(cb);
    label.appendChild(span);
    label.htmlFor = `day-check-${day}`;
    inputWorkingDays.appendChild(label);
  });
}

function wireConfigInputs() {
  inputTotalHours.addEventListener("input", () => {
    const v = parseFloat(inputTotalHours.value);
    if (!isNaN(v) && v > 0) {
      config.totalWeeklyHours = v;
      saveConfig(config);
      refreshActivePreset();
      updateSummary();
    }
  });

  inputDailyHours.addEventListener("input", () => {
    const v = parseFloat(inputDailyHours.value);
    if (!isNaN(v) && v > 0) {
      config.dailyWorkHours = v;
      saveConfig(config);
      refreshActivePreset();
      // Re-render to update credit display on holiday/half-day cards
      renderDaysGrid();
      updateSummary();
    }
  });

  inputHalfDay.addEventListener("input", () => {
    const v = parseFloat(inputHalfDay.value);
    if (!isNaN(v) && v >= 0) {
      config.halfDayHours = v;
      saveConfig(config);
      refreshActivePreset();
      renderDaysGrid();
      updateSummary();
    }
  });
}

// ── Day Grid ──────────────────────────────────────────────────────────────────

function renderDaysGrid() {
  daysGrid.innerHTML = "";
  config.workingDays.forEach((day) => {
    const entry = weekData[day] || { type: "" };
    daysGrid.appendChild(buildDayCard(day, entry));
  });
}

function buildDayCard(day, entry) {
  const card = document.createElement("div");
  card.className = "day-card";
  card.dataset.day = day;
  card.dataset.type = entry.type || "";

  // ── Header ──
  const header = document.createElement("div");
  header.className = "day-card-header";

  const nameEl = document.createElement("div");
  nameEl.className = "day-name";
  nameEl.textContent = day;

  const badge = document.createElement("span");
  badge.className = "day-status-badge";
  updateBadge(badge, entry.type);

  header.appendChild(nameEl);
  header.appendChild(badge);
  card.appendChild(header);

  // ── Type Dropdown ──
  const typeSelect = document.createElement("select");
  typeSelect.className = "day-type-select";
  typeSelect.id = `type-${day}`;
  typeSelect.setAttribute("aria-label", `${day} entry type`);

  [
    { value: "",            label: "— Select type —" },
    { value: "worked",      label: "✅  Worked" },
    { value: "wfh",         label: "🏠  WFH" },
    { value: "holiday",     label: "🎉  Holiday" },
    { value: "half-day",    label: "☀️  Half Day" },
    { value: "in-progress", label: "⏳  In Progress" },
  ].forEach(({ value, label }) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    typeSelect.appendChild(opt);
  });

  typeSelect.value = entry.type || "";
  card.appendChild(typeSelect);

  // ── Extra Fields (conditional) ──
  const extra = document.createElement("div");
  extra.className = "day-extra";
  extra.id = `extra-${day}`;
  card.appendChild(extra);

  // ── Credit display ──
  const creditEl = document.createElement("div");
  creditEl.className = "day-credit";
  creditEl.id = `credit-${day}`;
  card.appendChild(creditEl);

  // Render the current entry fields
  renderDayExtra(day, entry, extra, badge, creditEl, card);

  // Wire type change
  typeSelect.addEventListener("change", (e) => {
    const newType = e.target.value;
    weekData[day] = { type: newType };

    // Carry over relevant fields if switching between similar types
    if (newType === "worked" && entry.hours) weekData[day].hours = entry.hours;
    if (newType === "in-progress" && entry.loginTime) weekData[day].loginTime = entry.loginTime;

    entry = weekData[day];
    card.dataset.type = newType;
    updateBadge(badge, newType);
    renderDayExtra(day, entry, extra, badge, creditEl, card);
    saveWeekData(weekData);
    updateSummary();
  });

  return card;
}

/**
 * Render the conditional input area based on day type.
 */
function renderDayExtra(day, entry, extra, badge, creditEl, card) {
  extra.innerHTML = "";
  creditEl.textContent = "";

  switch (entry.type) {
    case "worked": {
      const group = document.createElement("div");
      group.className = "form-group";

      const lbl = document.createElement("label");
      lbl.htmlFor = `hours-${day}`;
      lbl.textContent = "Hours worked (HH:MM)";

      const input = document.createElement("input");
      input.type = "text";
      input.inputMode = "numeric";
      input.className = "time-input";
      input.id = `hours-${day}`;
      input.placeholder = "HH:MM  e.g. 09:00";
      input.maxLength = 5;
      // Show stored hours as HH:MM on load
      input.value = (entry.hours !== undefined && entry.hours !== "")
        ? formatHoursAsHHMM(Number(entry.hours))
        : "";
      input.setAttribute("aria-label", `${day} hours worked in HH:MM`);

      const warning = document.createElement("div");
      warning.className = "day-warning";
      warning.style.display = "none";

      // Commit current input value to state
      function commitValue() {
        const val = input.value.trim();
        const mins = parseTimeToMinutes(val);
        const hrs  = mins / 60;

        if (!val || val === ":") {
          // Empty → full-day fallback
          weekData[day] = { type: "worked" };
          warning.style.display = "none";
          creditEl.textContent = `Credit: ${formatHoursAsHHMM(config.dailyWorkHours)} (no hours — full day assumed)`;
        } else {
          weekData[day] = { type: "worked", hours: hrs };
          const { warning: w } = validateWorkedHours(hrs, config);
          if (w) {
            warning.innerHTML = `⚠️ ${w}`;
            warning.style.display = "flex";
          } else {
            warning.style.display = "none";
          }
          creditEl.textContent = `Credit: ${formatHoursAsHHMM(hrs)}`;
        }
        saveWeekData(weekData);
        updateSummary();
      }

      // Auto-format HH:MM: strip non-digits, auto-insert colon after 2nd digit
      input.addEventListener("input", (e) => {
        const isDeleting = e.inputType?.startsWith("delete");
        const digits = input.value.replace(/\D/g, "").slice(0, 4);

        if (digits.length >= 3) {
          input.value = digits.slice(0, 2) + ":" + digits.slice(2);
        } else if (digits.length === 2 && !isDeleting) {
          // Auto-insert colon after HH
          input.value = digits + ":";
        } else {
          input.value = digits;
        }

        commitValue();
      });

      // Normalize to full HH:MM on blur (e.g. "09:3" → "09:03", "09:" → "09:00")
      input.addEventListener("blur", () => {
        const val = input.value.trim();
        if (val && val !== ":") {
          const mins = parseTimeToMinutes(val);
          input.value = formatMinutesToHHMM(mins);
        }
        commitValue();
      });

      group.appendChild(lbl);
      group.appendChild(input);
      group.appendChild(warning);
      extra.appendChild(group);

      // Initial credit display
      if (entry.hours !== undefined && entry.hours !== "") {
        creditEl.textContent = `Credit: ${formatHoursAsHHMM(Number(entry.hours))}`;
      } else {
        creditEl.textContent = `Credit: ${formatHoursAsHHMM(config.dailyWorkHours)} (no hours — full day assumed)`;
      }
      break;
    }

    case "wfh":
      creditEl.textContent = `Credit: ${formatHoursAsHHMM(config.dailyWorkHours)} (work from home)`;
      break;

    case "holiday":
      creditEl.textContent = `Credit: ${formatHoursAsHHMM(config.dailyWorkHours)} (full day)`;
      break;

    case "half-day":
      creditEl.textContent = `Credit: ${formatHoursAsHHMM(config.halfDayHours)} (half day)`;
      break;

    case "in-progress": {
      const group = document.createElement("div");
      group.className = "form-group";

      const lbl = document.createElement("label");
      lbl.htmlFor = `login-${day}`;
      lbl.textContent = "Login time";

      const input = document.createElement("input");
      input.type = "text";
      input.inputMode = "numeric";
      input.className = "time-input";
      input.id = `login-${day}`;
      input.placeholder = "HH:MM (e.g. 09:30)";
      input.value = entry.loginTime ?? "";
      input.setAttribute("aria-label", `${day} login time`);

      const hint = document.createElement("div");
      hint.className = "hint-text";
      hint.textContent = "Logout time will be calculated automatically.";

      input.addEventListener("input", () => {
        weekData[day] = { type: "in-progress", loginTime: input.value.trim() };
        saveWeekData(weekData);
        updateSummary();
      });

      group.appendChild(lbl);
      group.appendChild(input);
      group.appendChild(hint);
      extra.appendChild(group);
      break;
    }

    default:
      break;
  }
}

/**
 * Update the status badge text and class.
 */
function updateBadge(badge, type) {
  const map = {
    "worked":      { text: "Done",        cls: "badge-worked"      },
    "wfh":         { text: "WFH",         cls: "badge-wfh"         },
    "holiday":     { text: "Holiday",     cls: "badge-holiday"     },
    "half-day":    { text: "Half Day",    cls: "badge-half-day"    },
    "in-progress": { text: "In Progress", cls: "badge-in-progress" },
    "":            { text: "–",           cls: "badge-empty"       },
  };
  const { text, cls } = map[type] || map[""];
  badge.textContent = text;
  badge.className = `day-status-badge ${cls}`;
}

// ── Summary Update ────────────────────────────────────────────────────────────

function updateSummary() {
  const completed  = calculateTotalCompletedHours(weekData, config);
  const remaining  = calculateRemainingHours(completed, config);
  const pending    = countPendingDays(weekData, config);
  const avg        = calculateRequiredAvg(remaining, pending);
  const pct        = Math.min(100, Math.max(0, (completed / config.totalWeeklyHours) * 100));

  // ── Completed ──
  statCompleted.textContent    = formatHoursAsHHMM(completed);
  statCompletedSub.textContent = `of ${formatHoursAsHHMM(config.totalWeeklyHours)} target`;

  // ── Remaining ──
  if (remaining <= 0) {
    statRemaining.textContent    = "Done!";
    statRemainingSub.textContent = remaining < 0
      ? `${formatHoursAsHHMM(Math.abs(remaining))} surplus`
      : "Exactly on target";
  } else {
    statRemaining.textContent    = formatHoursAsHHMM(remaining);
    statRemainingSub.textContent = "still to go";
  }

  // ── Required Avg ──
  // Unlabeled days display
  if (pending > 0) {
    statAvg.textContent    = formatHoursAsHHMM(config.dailyWorkHours);
    statAvgSub.textContent = `${pending} unlabeled day${pending !== 1 ? "s" : ""} (auto-credited)`;
  } else if (remaining <= 0) {
    statAvg.textContent    = "🎉 Target hit!";
    statAvgSub.textContent = "Weekly quota complete";
  } else {
    statAvg.textContent    = "–";
    statAvgSub.textContent = "All days classified";
  }

  // ── Progress Bar ──
  progressFill.style.width = `${pct}%`;
  progressFill.classList.toggle("complete", pct >= 100);
  progressPct.textContent    = `${pct.toFixed(0)}%`;
  progressTarget.textContent = `${config.totalWeeklyHours}h`;

  // ── Logout Banner ──
  updateLogoutBanner(remaining);
}

function updateLogoutBanner(remaining) {
  // Show for ANY day marked in-progress.
  // Unselected days are already auto-credited in calculateTotalCompletedHours,
  // so `remaining` correctly reflects only what's left after all other days
  // (whether explicitly labeled or auto-credited) — no need to restrict to last day.
  const inProgressDay = config.workingDays.find(
    (d) => weekData[d]?.type === "in-progress"
  );

  if (!inProgressDay) {
    logoutBanner.classList.remove("visible", "done");
    return;
  }

  const login = weekData[inProgressDay]?.loginTime;

  if (remaining <= 0) {
    // Already done this week
    logoutBanner.classList.add("visible", "done");
    logoutLabel.textContent  = "✅ Weekly quota already completed";
    logoutTime.textContent   = "You can log out now!";
    logoutSub.textContent    = `${formatHoursAsHHMM(Math.abs(remaining))} surplus for the week`;
    logoutIcon.textContent   = "🎉";
    return;
  }

  const { logoutTime: lt, status } = calculateLogoutTime(login, remaining);

  if (status === "invalid-login") {
    logoutBanner.classList.add("visible");
    logoutBanner.classList.remove("done");
    logoutLabel.textContent  = "⏳ Logout Time";
    logoutTime.textContent   = "Enter login time";
    logoutSub.textContent    = `${formatHoursAsHHMM(remaining)} remaining`;
    logoutIcon.textContent   = "🕐";
    return;
  }

  logoutBanner.classList.add("visible");
  logoutBanner.classList.remove("done");
  logoutLabel.textContent  = `Logout time for ${inProgressDay}`;
  logoutTime.textContent   = lt;
  logoutSub.textContent    = `${formatHoursAsHHMM(remaining)} remaining · login ${login || "—"}`;
  logoutIcon.textContent   = "🕐";
}

// ── Reset Week ────────────────────────────────────────────────────────────────

function resetWeek() {
  if (!confirm("Clear all this week's entries? Config will be preserved.")) return;
  clearWeekData();
  weekData = {};
  renderDaysGrid();
  updateSummary();
}

// ── Init ──────────────────────────────────────────────────────────────────────

export function init() {
  initTheme();
  renderPresets();
  buildWorkingDayChecks();
  syncConfigInputs();
  wireConfigInputs();
  renderDaysGrid();
  updateSummary();

  btnResetWeek.addEventListener("click", resetWeek);
  btnThemeToggle.addEventListener("click", toggleTheme);

  // Extension install prompt / connected badge
  initExtensionPrompt();
}
