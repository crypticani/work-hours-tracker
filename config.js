/**
 * config.js — Work Policy Configuration
 *
 * Defines company-level work policies. All calculations depend on this object.
 * To extend for a new company, add a new preset below and use it via loadConfig().
 */

// ── Built-in Presets ──────────────────────────────────────────────────────────

export const PRESETS = {
  /** Standard 5-day, 45-hour week (9h/day) */
  "5d-45h": {
    label: "5-day · 45h/week (9h/day)",
    workDaysPerWeek: 5,
    totalWeeklyHours: 45,
    dailyWorkHours: 9,
    halfDayHours: 4.5,
    workingDays: ["Mon", "Tue", "Wed", "Thu", "Fri"],
  },

  /** 5-day, 40-hour week (8h/day) */
  "5d-40h": {
    label: "5-day · 40h/week (8h/day)",
    workDaysPerWeek: 5,
    totalWeeklyHours: 40,
    dailyWorkHours: 8,
    halfDayHours: 4,
    workingDays: ["Mon", "Tue", "Wed", "Thu", "Fri"],
  },

  /** 6-day, 48-hour week (8h/day) */
  "6d-48h": {
    label: "6-day · 48h/week (8h/day)",
    workDaysPerWeek: 6,
    totalWeeklyHours: 48,
    dailyWorkHours: 8,
    halfDayHours: 4,
    workingDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  },

  /** 4-day compressed week (10h/day) */
  "4d-40h": {
    label: "4-day · 40h/week (10h/day)",
    workDaysPerWeek: 4,
    totalWeeklyHours: 40,
    dailyWorkHours: 10,
    halfDayHours: 5,
    workingDays: ["Mon", "Tue", "Wed", "Thu"],
  },
};

// ── Default Config ────────────────────────────────────────────────────────────

export const DEFAULT_CONFIG = { ...PRESETS["5d-45h"] };

// ── All possible day names (ordered) ─────────────────────────────────────────

export const ALL_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ── Persistence Key ───────────────────────────────────────────────────────────

const CONFIG_KEY = "wht_config_v1";
const WEEK_KEY   = "wht_weekdata_v1";

// ── Config Load / Save ────────────────────────────────────────────────────────

/**
 * Load config from localStorage, or fall back to DEFAULT_CONFIG.
 * @returns {Object} resolved config
 */
export function loadConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    const parsed = JSON.parse(raw);
    // Validate required keys exist before trusting it
    if (
      typeof parsed.totalWeeklyHours === "number" &&
      typeof parsed.dailyWorkHours === "number" &&
      Array.isArray(parsed.workingDays)
    ) {
      return parsed;
    }
  } catch { /* ignore corrupted data */ }
  return { ...DEFAULT_CONFIG };
}

/**
 * Persist config to localStorage.
 * @param {Object} config
 */
export function saveConfig(config) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

// ── Week Data Load / Save ─────────────────────────────────────────────────────

/**
 * Load the week's day entries from localStorage.
 * @returns {Object} weekData map (keyed by day abbreviation)
 */
export function loadWeekData() {
  try {
    const raw = localStorage.getItem(WEEK_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch { return {}; }
}

/**
 * Persist week data to localStorage.
 * @param {Object} weekData
 */
export function saveWeekData(weekData) {
  localStorage.setItem(WEEK_KEY, JSON.stringify(weekData));
}

/**
 * Clear only week entries, preserving config.
 */
export function clearWeekData() {
  localStorage.removeItem(WEEK_KEY);
}
