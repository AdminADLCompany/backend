const History = require("../models/history");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");

// ✅ Clear all history
exports.clearAllHistory = catchAsyncErrors(async (req, res, next) => {
  await History.deleteMany();

  res.status(200).json({
    success: true,
    message: "All history records cleared successfully",
  });
});
