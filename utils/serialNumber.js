/**
 * Map serial sequence types to display prefixes.
 * Add new cases when introducing more serial-backed headers.
 */
const prefixForType = (type) => {
  switch (String(type || "").trim().toUpperCase()) {
    case "ENQUIRE_NUMBER":
      return "EQN";
    default: {
      const err = new Error(`Unknown serial type: ${type}`);
      err.statusCode = 400;
      throw err;
    }
  }
};

const DEFAULT_PAD_LENGTH = 6;

const formatSerial = (prefix, number, padLength = DEFAULT_PAD_LENGTH) => {
  const pad = Math.max(1, Number(padLength) || DEFAULT_PAD_LENGTH);
  const n = Number(number) || 0;
  return `${prefix}${String(n).padStart(pad, "0")}`;
};

module.exports = {
  prefixForType,
  formatSerial,
  DEFAULT_PAD_LENGTH,
};
