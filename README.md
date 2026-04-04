# ⏱️ Work Hours Tracker

A **flexible, configurable** weekly work-hours calculator that supports any company policy.  
Track worked hours, holidays, half-days, and get your exact logout time — all in the browser, with no server needed.

---

## Features

- 🏢 **Config-driven** — define your own work week (days, hours, half-day credits)
- 📋 **4 day types** — Worked · Holiday · Half-day · In-progress
- 🕐 **Logout time calculator** — enter your login time, get exact logout
- 📊 **Live summary** — completed, remaining, required daily avg, progress bar
- 💾 **LocalStorage persistence** — data survives page refresh
- 🌙 **Dark / Light mode** toggle
- 🔄 **Reset week** without losing config

---

## Quick Start

Since the app uses ES modules, you need a local server (not `file://`):

```bash
# Python 3 (simplest)
cd work-hours-tracker
python3 -m http.server 8080
# → open http://localhost:8080
```

Or with Node.js:
```bash
npx serve .
```

---

## File Structure

```
work-hours-tracker/
├── index.html      ← App shell (no inline logic)
├── config.js       ← Policy presets + localStorage persistence
├── calculator.js   ← Pure calculation logic (no DOM)
├── ui.js           ← DOM rendering & interaction
└── styles.css      ← Dark glassmorphism design system
```

---

## Company Policy Config Examples

### 5-day · 45h/week (default)
```json
{
  "workDaysPerWeek": 5,
  "totalWeeklyHours": 45,
  "dailyWorkHours": 9,
  "halfDayHours": 4.5,
  "workingDays": ["Mon", "Tue", "Wed", "Thu", "Fri"]
}
```

### 6-day · 48h/week
```json
{
  "workDaysPerWeek": 6,
  "totalWeeklyHours": 48,
  "dailyWorkHours": 8,
  "halfDayHours": 4,
  "workingDays": ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
}
```

### 4-day compressed · 40h/week
```json
{
  "workDaysPerWeek": 4,
  "totalWeeklyHours": 40,
  "dailyWorkHours": 10,
  "halfDayHours": 5,
  "workingDays": ["Mon", "Tue", "Wed", "Thu"]
}
```

---

## Input Types

| Type | Meaning | Credit |
|---|---|---|
| **Worked** | Enter actual hours (HH:MM or decimal) | Exact hours |
| **Holiday** | Public holiday / company off | Full `dailyWorkHours` |
| **Half Day** | Half-day leave | Configured `halfDayHours` |
| **In Progress** | Today — enter login time | Logout time calculated |

---

## Calculation Rules

```
completedHours = Σ (worked + holidays×dailyHours + halfDays×halfDayHours)
remainingHours = totalWeeklyHours - completedHours
logoutTime     = loginTime + remainingHours
```

---

## Extending for a New Company

1. Open `config.js`
2. Add a new entry to the `PRESETS` object:
```js
"my-company": {
  label: "My Co · 50h/week",
  workDaysPerWeek: 5,
  totalWeeklyHours: 50,
  dailyWorkHours: 10,
  halfDayHours: 5,
  workingDays: ["Mon", "Tue", "Wed", "Thu", "Fri"],
}
```
3. It'll appear automatically as a chip in the UI.

---

## Architecture Notes

- **`calculator.js`** — pure functions only; zero DOM, easy to unit-test
- **`config.js`** — all policy rules in one place; presets + persistence
- **`ui.js`** — sole owner of DOM; calls calculator functions, never duplicates logic
- **`index.html`** — shell layout only; imports `ui.js` as an ES module

---

*Data is stored in `localStorage` under keys `wht_config_v1` and `wht_weekdata_v1`.*
