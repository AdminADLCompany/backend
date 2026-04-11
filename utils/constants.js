const sceduledLoss = [
  { label: "FOOD", time: 15, type: "breakFast", from: "08:30", to: "08:45" },
  { label: "FOOD", time: 20, type: "Lunch", from: "12:30", to: "12:50" },
  { label: "FOOD", time: 20, type: "Dinner", from: "20:30", to: "20:50" },
  {
    label: "FOOD",
    time: 20,
    type: "nightBreakFast",
    from: "02:00",
    to: "02:20",
  },
  { label: "TEA", time: 5, type: "earlyTea", from: "07:00", to: "07:05" },
  { label: "TEA", time: 10, type: "morningTea", from: "10:30", to: "10:40" },
  { label: "TEA", time: 5, type: "afternoonTea", from: "16:30", to: "16:35" },
  { label: "TEA", time: 10, type: "eveningTea", from: "00:00", to: "00:10" },
  { label: "TEA", time: 10, type: "nightTea", from: "04:00", to: "04:10" },
  { label: "PRAYER", time: 20, type: "fajar", from: "05:40", to: "06:00" },
  { label: "PRAYER", time: 10, type: "zuhar", from: "12:50", to: "13:00" },
  { label: "PRAYER", time: 10, type: "asar", from: "16:35", to: "16:45" },
  { label: "PRAYER", time: 15, type: "maghrib", from: "18:30", to: "18:45" },
  { label: "PRAYER", time: 10, type: "isha", from: "20:50", to: "21:00" },
  { label: "DRM", time: 0, type: "drm", from: "nil", to: "nil" },
  { label: "INSPECTION", time: 0, type: "inspection", from: "nil", to: "nil" },
  {
    label: "COMMUNICATION",
    time: 0,
    type: "communication",
    from: "nil",
    to: "nil",
  },
];

module.exports = {
  sceduledLoss,
};
