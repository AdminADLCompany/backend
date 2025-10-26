const mongoose = require('mongoose')

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
  let { items, rowDataId } = req.body;

  if (!process) {
    return next(new ErrorHandler("Process not found", 404));
  }

  // if rowDataId is null || undefined || "" then give some randome _id
  if (!rowDataId) {
    rowDataId = new mongoose.Types.ObjectId();
  }

  if (typeof items === "string") {
    items = JSON.parse(items); // ✅ convert string to array
  }

  // ---- DD/R/002 logic: Auto-fill ITEM CODE based on ITEM NAME & ITEM GRADE ----
  if (process.processId === "DD/R/002") {
    const itemListProcess = await Process.findOne({ processId: "PR/R/002" });

    if (itemListProcess) {
      const inputItemName = items
        .find((i) => i.key === "ITEM-NAME")
        ?.value?.trim();
      const inputItemGrade = items
        .find((i) => i.key === "GRADE")
        ?.value?.trim();

      if (inputItemName && inputItemGrade) {
        // Find matching row inside itemListProcess.data
        const matchedRow = itemListProcess.data.find((itemRow) => {
          const rowItemName = itemRow.items
            .find((i) => i.key === "ITEM NAME")
            ?.value?.trim();
          const rowItemGrade = itemRow.items
            .find((i) => i.key === "ITEM GRADE")
            ?.value?.trim();
          return (
            rowItemName?.toLowerCase() === inputItemName.toLowerCase() &&
            rowItemGrade?.toLowerCase() === inputItemGrade.toLowerCase()
          );
        });

        if (matchedRow) {
          const itemCode = matchedRow.items.find(
            (i) => i.key === "ITEM CODE"
          )?.value;

          // ✅ Update or insert ITEM CODE in the current items array
          const existingCodeItem = items.find((i) => i.key === "ITEM CODE");
          if (existingCodeItem) {
            existingCodeItem.value = itemCode || "";
          } else {
            items.push({
              key: "ITEM CODE",
              value: itemCode || "",
              process: "value",
            });
          }
        }
      }
    }
  }

  // ---- Handle intersections ----
  await handleAddIntersection(process, items, rowDataId, req.user._id);

  // ---- Handle image uploads ----
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
      items[i].value = result.secure_url; // store cloudinary URL
    }
  }

  // ---- Replace processId references with actual IDs ----
  for (let i = 0; i < items.length; i++) {
    if (items[i].process === "processId" && items[i].value) {
      const relatedProcess = await Process.findOne({
        processId: items[i].value,
      });
      if (relatedProcess && relatedProcess._id) {
        items[i] = {
          key: items[i].key,
          value: `processId - ${relatedProcess._id}`,
          process: "",
        };
      }
    }
  }

  // ---- Create new row ----
  const newRow = { items, rowDataId };
  process.data.push(newRow);
  process.updatedBy = req.user._id;
  await process.save();

  // ---- Log history ----
  await History.create({
    collectionName: "Process",
    documentId: process._id,
    rowId: process.data[process.data.length - 1]._id,
    operation: "create",
    oldData: null,
    newData: newRow,
    changedBy: req.user._id,
  });

  res.status(200).json({
    success: true,
    process,
  });
});

// UPDATE row by rowId
exports.updateData = catchAsyncErrors(async (req, res, next) => {
  const process = await Process.findById(req.params.id);
  let { rowId, items } = req.body;

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

  await handleUpdateIntersection(process, items, row, req.user._id, rowId, previousItems);
  /** 🔥 Extra logic for Action Taken process */
//   if (process.processId === "MR/R/003B") {
//     const moveToItem = items.find((i) => i.key === "MOVE TO");

//     if (moveToItem && moveToItem.value === "Rework") {
//       const rejectionReport = await Process.findOne({ processId: "MR/R/003" });
//       const reworkReport = await Process.findOne({ processId: "MR/R/003A" });

//       if (rejectionReport && reworkReport) {
//         const rejectionRow = rejectionReport.data.id(row.rowDataId);

//         if (rejectionRow) {
//           const partNo = rejectionRow.items.find(
//             (i) => i.key === "PART NO"
//           )?.value;
//           const partName = rejectionRow.items.find(
//             (i) => i.key === "PART NAME"
//           )?.value;
//           const problemDesc = rejectionRow.items.find(
//             (i) => i.key === "PROBLEM DESCRIPTION"
//           )?.value;
//           const rejectStage = rejectionRow.items.find(
//             (i) => i.key === "REJECT STAGE"
//           )?.value;

//           // Prepare new rework row
//           const reworkRow = {
//             items: [
//               { key: "PART NO", value: partNo || "", process: "value" },
//               { key: "PART NAME", value: partName || "", process: "value" },
//               {
//                 key: "PROBLEM DESCRIPTION",
//                 value: problemDesc || "",
//                 process: "value",
//               },
//               { key: "REWORK QTY", value: "0", process: "value" }, // default
//               {
//                 key: "REJECT STAGE",
//                 value: rejectStage || "",
//                 process: "value",
//               },
//               {
//                 key: "ACTION PLAN",
//                 value: items.find((i) => i.key === "ACTION PLAN")?.value || "",
//                 process: "value",
//               },
//               {
//                 key: "VERIFIED BY",
//                 value: items.find((i) => i.key === "VERIFIED BY")?.value || "",
//                 process: "value",
//               },
//               {
//                 key: "STATUS",
//                 value:
//                   items.find((i) => i.key === "ACTION PLAN STATUS")?.value ||
//                   "",
//                 process: "value",
//               },
//             ],
//             rowDataId: row.rowDataId, // 🔗 link to rejection row
//           };

//           reworkReport.data.push(reworkRow);
//           reworkReport.updatedBy = req.user._id;
//           await reworkReport.save();

//           // Log to history
//           await History.create({
//             collectionName: "Process",
//             documentId: reworkReport._id,
//             rowId: reworkReport.data[reworkReport.data.length - 1]._id,
//             operation: "create",
//             oldData: null,
//             newData: reworkRow,
//             changedBy: req.user._id,
//           });
//         }
//       }
//     }
//   } else if (process.processId === "MS/R/005") {
//     const moveToItem = items.find((i) => i.key === "QL STATUS");

//     if (moveToItem && moveToItem.value === "OPEN") {
//       const orderListProcess = await Process.findOne({ processId: "MS/R/006" });

//       if (orderListProcess) {
//         const orderListRow = {
//           items: [
//             {
//               key: "DATE",
//               value: items.find((i) => i.key === "DATE")?.value,
//               process: "value",
//             },
//             {
//               key: "QUOTE NO",
//               value: items.find((i) => i.key === "QUOTATION NO")?.value,
//               process: "value",
//             },
//             {
//               key: "ENQ BY",
//               value: items.find((i) => i.key === "ENQ BY")?.value,
//               process: "value",
//             },
//             {
//               key: "CUSTOMER NAME",
//               value: items.find((i) => i.key === "CUSTOMER NAME")?.value,
//               process: "value",
//             },
//             {
//               key: "LOCATION",
//               value: items.find((i) => i.key === "LOCATION")?.value,
//               process: "value",
//             },
//             {
//               key: "DESCRIPTION",
//               value: items.find((i) => i.key === "DESCRIPTION")?.value,
//               process: "value",
//             },
//             {
//               key: "QTY",
//               value: items.find((i) => i.key === "QTY")?.value,
//               process: "value",
//             },
//             {
//               key: "UNITS",
//               value: items.find((i) => i.key === "UNITS")?.value,
//               process: "value",
//             },
//             { key: "VALUE", value: "", process: "value" },
//             { key: "ORDER DATE", value: "", process: "value" },
//             { key: "PO NO", value: "", process: "value" },
//             { key: "LEAD TIME", value: "", process: "value" },
//             { key: "INVOICE NO", value: "", process: "value" },
//             { key: "DELIVERY QTY", value: "", process: "value" },
//             { key: "PENDING QTY", value: "", process: "value" },
//             { key: "DELIVERY DATE", value: "", process: "value" },
//             { key: "GRN", value: "", process: "value" },
//             { key: "PAYMENT", value: "", process: "value" },
//           ],
//         };

//         orderListProcess.data.push(orderListRow);
//         orderListProcess.updatedBy = req.user._id;
//         await orderListProcess.save();
//       }
//     }
//   }

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
  const process = await Process.findOne({ processId: "DD/R/002A" });
  const itemListProcess = await Process.findOne({ processId: "PR/R/002" });
  const vendorListProcess = await Process.findOne({ processId: "PR/R/001" });

  if (!process || !process.data) {
    return ErrorHandler("Process not found", 404);
  }

  // Use Sets to remove duplicates
  const partNo = new Set();
  const partName = new Set();
  const type = new Set();
  const material = new Set();

  const itemName = new Set();
  const itemGrade = new Set();

  const vendorName = new Set();

  process.data.forEach((row) => {
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

  const response = [
    { key: "PART-NO", value: Array.from(partNo) },
    { key: "PART-NAME", value: Array.from(partName) },
    { key: "TYPE", value: Array.from(type) },
    { key: "MATERIAL", value: Array.from(material) },
    { key: "ITEM-NAME", value: Array.from(itemName) },
    { key: "VENDOR-NAME", value: Array.from(vendorName) },
    { key: "GRADE", value: Array.from(itemGrade) },
  ];

  res.status(200).json({
    success: true,
    data: response,
  });
});
