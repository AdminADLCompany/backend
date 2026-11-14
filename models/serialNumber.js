const mongoose = require("mongoose");

const serialNumberSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },
    prefix: {
      type: String,
      required: true,
      trim: true,
    },
    lastNumber: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    padLength: {
      type: Number,
      default: 6,
      min: 1,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("SerialNumber", serialNumberSchema);
