const mongoose = require("mongoose");

const Process = require("../models/process");
const History = require("../models/history");

const ErrorHandler = require("../utils/errorHandler");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const cloudinary = require("../config/cloudinary");
const {
  handleAddIntersection,
  handleUpdateIntersection,
  handleDeleteIntersection,
} = require("../utils/intersections");

const ImageUploadArray = [
  "UPLOAD",
  "BEFORE",
  "AFTER",
  "CALIBRATION CERTIFICATE NO / DATE",
  "ACTION REPORT",
  "NPD FORM",
  "EVALUATE",
  "IMAGE",
];

function toMinutes(t) {
  if (!t || t === "nil") return null;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

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

exports.getAllProcesses = catchAsyncErrors(async (req, res, next) => {
  // populate process and updatedBy
  const processes = await Process.find()
    .populate("department")
    .populate("updatedBy", "userName email");

  res.status(200).json({
    success: true,
    data: processes,
  });
});

exports.getProcessById = catchAsyncErrors(async (req, res, next) => {
  const process = await Process.findById(req.params.id)
    .populate("department")
    .populate("updatedBy", "userName email");

  if (!process) {
    return next(new ErrorHandler("Process not found", 404));
  }

  res.status(200).json({
    success: true,
    data: process,
  });
});

exports.getProcessByDepartmentId = catchAsyncErrors(async (req, res, next) => {
  const processes = await Process.find({ department: req.params.id })
    .populate("department")
    .populate("updatedBy", "userName email");

  res.status(200).json({
    success: true,
    data: processes,
  });
});

exports.createProcess = catchAsyncErrors(async (req, res, next) => {
  const { process, headers, department, processId } = req.body;

  const processes = await Process.create({
    process,
    processId,
    headers,
    department,
    updatedBy: req.user._id,
  });

  await processes.populate("department");
  await processes.populate("updatedBy", "userName email");

  res.status(201).json({
    success: true,
    data: processes,
  });
});

exports.updateProcess = catchAsyncErrors(async (req, res, next) => {
  let process = await Process.findById(req.params.id);

  if (!process) {
    return next(new ErrorHandler("Process not found", 404));
  }

  // Update fields
  Object.assign(process, req.body);

  // Track who updated
  process.updatedBy = req.user._id;

  // Save changes
  await process.save();

  // Populate references
  await process.populate("department");
  await process.populate("updatedBy", "userName email");

  res.status(200).json({
    success: true,
    data: process,
  });
});

exports.deleteProcess = catchAsyncErrors(async (req, res, next) => {
  const process = await Process.findById(req.params.id);

  if (!process) {
    return next(new ErrorHandler("Process not found", 404));
  }

  process.updatedBy = req.user._id; // ✅ track who deleted
  await process.deleteOne(); // ✅ triggers plugin

  res.status(200).json({ success: true, message: "Process deleted" });
});

exports.addHeader = catchAsyncErrors(async (req, res, next) => {
  const process = await Process.findById(req.params.id);
  const { headerName } = req.body;

  if (!process) {
    return next(new ErrorHandler("Process not found", 404));
  }
  process.headers.push(headerName);

  process.updatedBy = req.user._id;

  await process.save();
  res.status(200).json({
    success: true,
    data: process,
  });
});

exports.deleteHeader = catchAsyncErrors(async (req, res, next) => {
  const process = await Process.findById(req.params.id);
  const { headerName } = req.body;

  if (!process) {
    return next(new ErrorHandler("Process not found", 404));
  }
  process.headers = process.headers.filter((header) => header !== headerName);
  process.updatedBy = req.user._id;

  await process.save();
  res.status(200).json({
    success: true,
    data: process,
  });
});

// ADD new row
exports.addData = catchAsyncErrors(async (req, res, next) => {
  const process = await Process.findById(req.params.id);
  if (!process) return next(new ErrorHandler("Process not found", 404));

  let { items, rowDataId } = req.body;
  if (!rowDataId) rowDataId = new mongoose.Types.ObjectId();
  if (typeof items === "string") items = JSON.parse(items);

  await handleAddIntersection(process, items, rowDataId, req.user._id);

  // ---------------- MR/R/002 (OEE Calculation) ----------------
  if (process.processId === "MR/R/002") {
    const settingsProcess = await Process.findOne({ processId: "MR/R/002A" });
    const breakHourProcess = await Process.findOne({ processId: "MR/R/002B" });
    if (!settingsProcess || !breakHourProcess)
      return next(new ErrorHandler("No Settings or Break Process Found", 404));

    const start = toMinutes(items.find((i) => i.key === "START TIME")?.value);
    const endRaw = toMinutes(items.find((i) => i.key === "END TIME")?.value);
    const cycleTime = Number(items.find((i) => i.key === "CYCLE TIME")?.value);

    const end = endRaw < start ? endRaw + 1440 : endRaw;
    const totalTime = end - start;

    // ---- calculate break minutes ----
    let breakMinutes = 0;
    sceduledLoss.forEach((b) => {
      if (b.from === "nil") return;
      let s = toMinutes(b.from),
        e = toMinutes(b.to);
      if (e < s) e += 1440;
      if (s < end && e > start) breakMinutes += b.time;
    });

    const workingTime = totalTime - breakMinutes;
    const plan = Math.floor(workingTime / cycleTime);

    // ---- update PLAN field ----
    const planItem = items.find((i) => i.key === "PLAN");
    if (planItem) planItem.value = String(plan);
  }

  // ---------------- Image Upload ----------------
  for (const item of items) {
    if (ImageUploadArray.includes(item.key) && req.files?.[item.key]) {
      const file = req.files[item.key][0];
      const upload = await cloudinary.uploader.upload(file.path, {
        folder: "process_images",
      });
      item.value = upload.secure_url;
    }
  }

  // --------------- Replace processId refs ---------------
  for (const item of items) {
    if (item.process === "processId" && item.value) {
      const p = await Process.findOne({ processId: item.value });
      if (p?._id) item.value = `processId - ${p._id}`;
      item.process = "";
    }
  }

  // ---------------- Save New Row ----------------
  const newRow = { items, rowDataId };
  process.data.push(newRow);
  process.updatedBy = req.user._id;
  await process.save();

  // ---------------- Log History ----------------
  await History.create({
    collectionName: "Process",
    documentId: process._id,
    rowId: process.data[process.data.length - 1]._id,
    operation: "create",
    oldData: null,
    newData: newRow,
    changedBy: req.user._id,
  });

  res.status(200).json({ success: true, process });
});

// UPDATE row by rowId
exports.updateData = catchAsyncErrors(async (req, res, next) => {
  const process = await Process.findById(req.params.id);
  let { rowId, items } = req.body;

  console.log("Updating rowId:", process);
  // Parse items if it's a string
  if (typeof items === "string") {
    items = JSON.parse(items);
  }

  if (!process) {
    return next(new ErrorHandler("Process not found", 404));
  }

  const row = process.data.id(rowId);
  if (!row) {
    return next(new ErrorHandler("Data not found", 404));
  }

  const oldData = { ...row.toObject() };

  for (let i = 0; i < items.length; i++) {
    if (
      ImageUploadArray.includes(items[i].key) &&
      req.files &&
      req.files[items[i].key]
    ) {
      const file = req.files[items[i].key][0];
      const result = await cloudinary.uploader.upload(file.path, {
        folder: "process_images",
      });
      items[i].value = result.secure_url;
    }
  }

  // Update row data
  const previousItems = row.items;
  row.items = items;
  process.updatedBy = req.user._id;
  await process.save();

  await handleUpdateIntersection(
    process,
    items,
    row,
    req.user._id,
    rowId,
    previousItems
  );

  // Save history for main process update
  await History.create({
    collectionName: "Process",
    documentId: process._id,
    rowId: row._id,
    operation: "update",
    oldData,
    newData: { items },
    changedBy: req.user._id,
  });

  res.status(200).json({
    success: true,
    data: process,
  });
});

// DELETE row by rowId
exports.deleteData = catchAsyncErrors(async (req, res, next) => {
  const process = await Process.findById(req.params.id);
  const { rowId } = req.body;

  if (!process) {
    return next(new ErrorHandler("Process not found", 404));
  }

  await handleDeleteIntersection(process, rowId, req.user._id);

  const row = process.data.id(rowId);
  if (!row) {
    return next(new ErrorHandler("Row not found", 404));
  }

  const oldData = { ...row.toObject() };

  // remove row
  process.data = process.data.filter((r) => r._id.toString() !== rowId);
  process.updatedBy = req.user._id;
  await process.save();

  // log history
  await History.create({
    collectionName: "Process",
    documentId: process._id,
    rowId: rowId,
    operation: "delete",
    oldData,
    newData: null,
    changedBy: req.user._id,
  });

  res.status(200).json({
    success: true,
    data: process,
  });
});

exports.getaProcessHistory = catchAsyncErrors(async (req, res, next) => {
  const history = await History.find({
    collectionName: "Process",
    documentId: req.params.id,
  })
    .populate("changedBy", "userName email")
    .sort({ timestamp: -1 });

  res.status(200).json({
    success: true,
    data: history,
  });
});

// GET /process/:processId/data/:rowId/history
exports.getProcessRowHistory = catchAsyncErrors(async (req, res, next) => {
  const { id, rowId } = req.params;

  const history = await History.find({
    collectionName: "Process",
    documentId: id,
    rowId: rowId,
  })
    .populate("changedBy", "userName email")
    .sort({ timestamp: -1 });

  if (!history.length) {
    return next(new ErrorHandler("No history found for this row", 404));
  }

  res.status(200).json({
    success: true,
    data: history,
  });
});

// Search Details
exports.getProductDetails = catchAsyncErrors(async (req, res, next) => {
  const productsProcess = await Process.findOne({ processId: "DD/R/002A" });
  const itemListProcess = await Process.findOne({ processId: "PR/R/002" });
  const vendorListProcess = await Process.findOne({ processId: "PR/R/001" });
  const customerListProcess = await Process.findOne({ processId: "MS/R/004" });

  if (!productsProcess || !itemListProcess || !vendorListProcess || !customerListProcess) {
    return next(new ErrorHandler("Process not found", 404));
  }

  // Use Sets to remove duplicates from products
  const partNo = new Set();
  const partName = new Set();
  const type = new Set();
  const material = new Set();

  // Use Sets to remove duplicates from item list
  const itemName = new Set();
  const itemGrade = new Set();

  // Use Sets to remove duplicates from vendor list
  const vendorName = new Set();

  // Use Sets to remove duplicates from customer list
  const customerName = new Set();

  productsProcess.data.forEach((row) => {
    const pNo = row.items.find((i) => i.key === "PART NO")?.value;
    const pName = row.items.find((i) => i.key === "PART NAME")?.value;
    const pType = row.items.find((i) => i.key === "TYPE")?.value;
    const pMaterial = row.items.find((i) => i.key === "MATERIAL")?.value;

    if (pNo) partNo.add(pNo);
    if (pName) partName.add(pName);
    if (pType) type.add(pType);
    if (pMaterial) material.add(pMaterial);
  });

  itemListProcess.data.forEach((row) => {
    const iName = row.items.find((i) => i.key === "ITEM NAME")?.value;
    const grade = row.items.find((i) => i.key === "ITEM GRADE")?.value;
    if (iName) itemName.add(iName);
    if (grade) itemGrade.add(grade);
  });

  vendorListProcess.data.forEach((row) => {
    const vName = row.items.find((i) => i.key === "VENDOR NAME")?.value;
    if (vName) vendorName.add(vName);
  });

  customerListProcess.data.forEach((row) => {
    const cName = row.items.find((i) => i.key === "CUSTOMER NAME")?.value;
    if (cName) customerName.add(cName);
  });

  const response = [
    { key: "PART-NO", value: Array.from(partNo) },
    { key: "PART-NAME", value: Array.from(partName) },
    { key: "TYPE", value: Array.from(type) },
    { key: "MATERIAL", value: Array.from(material) },
    { key: "ITEM-NAME", value: Array.from(itemName) },
    { key: "VENDOR-NAME", value: Array.from(vendorName) },
    { key: "GRADE", value: Array.from(itemGrade) },
    { key: "CUSTOMER-NAME", value: Array.from(customerName) },
  ];

  res.status(200).json({
    success: true,
    data: response,
  });
});

// write the controller to delete data in all the processes
exports.deleteAllProcessData = catchAsyncErrors(async (req, res, next) => {
  await Process.updateMany({}, { $set: { data: [] } });

  res.status(200).json({
    success: true,
    data: [],
  });
});
