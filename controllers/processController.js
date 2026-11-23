const mongoose = require("mongoose");

const Process = require("../models/process");
const History = require("../models/history");

const ErrorHandler = require("../utils/errorHandler");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const storage = require("../services/storage");
const { sceduledLoss } = require("../utils/constants");
const {
  handleAddIntersection,
  handleUpdateIntersection,
  handleDeleteIntersection,
  calculateBreaks,
} = require("../utils/intersections");

const ImageUploadArray = [
  "UPLOAD",
  "BEFORE",
  "AFTER",
  "CERTIFICATE",
  "ACTION REPORT",
  "NPD FORM",
  "EVALUATE",
  "IMAGE",
];

function toMinutes(t) {
  if (!t || t === "nil" || typeof t !== "string") return null;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

exports.getAllProcesses = catchAsyncErrors(async (req, res, next) => {
  // populate process and updatedBy
  const processes = await Process.find()
    .populate("department")
    .populate("updatedBy", "name email");

  res.status(200).json({
    success: true,
    data: processes,
  });
});

exports.getProcessById = catchAsyncErrors(async (req, res, next) => {
  const process = await Process.findById(req.params.id)
    .populate("department")
    .populate("updatedBy", "name email");

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
    .populate("updatedBy", "name email");

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
  await processes.populate("updatedBy", "name email");

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
  await process.populate("updatedBy", "name email");

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

exports.insertHeaders = catchAsyncErrors(async (req, res, next) => {
  const process = await Process.findById(req.params.id);
  if (!process) {
    return next(new ErrorHandler("Process not found", 404));
  }

  let { headers: inserts } = req.body;
  if (typeof inserts === "string") {
    try {
      inserts = JSON.parse(inserts);
    } catch {
      return next(new ErrorHandler("Invalid headers payload", 400));
    }
  }

  if (!Array.isArray(inserts) || inserts.length === 0) {
    return next(
      new ErrorHandler("headers must be a non-empty array of { headerName, index }", 400),
    );
  }

  const normalized = inserts.map((entry) => {
    const headerName =
      entry?.headerName ?? entry?.name ?? entry?.header ?? null;
    const index = Number(entry?.index);
    return { headerName, index };
  });

  for (const entry of normalized) {
    if (!entry.headerName || typeof entry.headerName !== "string") {
      return next(new ErrorHandler("Each entry requires headerName", 400));
    }
    if (!Number.isInteger(entry.index) || entry.index < 0) {
      return next(
        new ErrorHandler(`Invalid index for header "${entry.headerName}"`, 400),
      );
    }
  }

  const existingNames = new Set(
    (process.headers || []).map((h) => String(h).trim().toUpperCase()),
  );
  for (const { headerName } of normalized) {
    if (existingNames.has(headerName.trim().toUpperCase())) {
      return next(
        new ErrorHandler(`Header "${headerName}" already exists`, 400),
      );
    }
  }

  // Ascending index so consecutive inserts (1→2→3) land correctly after each splice
  const sorted = [...normalized].sort((a, b) => a.index - b.index);

  for (const { headerName, index } of sorted) {
    const clampIndex = Math.min(Math.max(index, 0), process.headers.length);
    process.headers.splice(clampIndex, 0, headerName);

    for (const row of process.data || []) {
      if (!Array.isArray(row.items)) row.items = [];
      const itemIndex = Math.min(clampIndex, row.items.length);
      row.items.splice(itemIndex, 0, {
        key: headerName,
        value: "",
        process: "",
      });
    }
  }

  process.markModified("headers");
  process.markModified("data");
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

  if (!Array.isArray(items)) {
    return next(new ErrorHandler("Items must be an array", 400));
  }

  const intersectionResponse = await handleAddIntersection(
    process,
    items,
    rowDataId,
    req.user._id,
  );

  if (intersectionResponse && intersectionResponse.success) {
    // ---------------- Image Upload ----------------
    for (const item of items) {
      if (ImageUploadArray.includes(item.key) && req.files?.[item.key]) {
        const file = req.files[item.key][0];
        item.value = await storage.saveFile(file);
      }
    }

    // --------------- Replace processId refs ---------------
    for (const item of items) {
      if (item.process === "processId" && item.value) {
        const p = await Process.findOne({ processId: item.value });
        if (p?._id) item.value = `processId - ${p._id}`;
        item.process =
          item.key === "PROTO" ||
          item.key === "VALIDATION" ||
          item.key === "MASTER PIECE"
            ? "red"
            : "value";
      }
    }

    // ---------------- MR/R/002 (OEE Calculation) ----------------
    if (process.processId === "MR/R/002") {
      const settingsProcess = await Process.findOne({ processId: "MR/R/002A" });
      const breakHourProcess = await Process.findOne({
        processId: "MR/R/002B",
      });
      if (!settingsProcess || !breakHourProcess)
        return next(
          new ErrorHandler("No Settings or Break Process Found", 404),
        );

      const start = toMinutes(items.find((i) => i.key === "START TIME")?.value);
      const endRaw = toMinutes(items.find((i) => i.key === "END TIME")?.value);
      const cycleTime = Number(
        items.find((i) => i.key === "CYCLE TIME")?.value,
      );
      const actual = Number(items.find((i) => i.key === "ACTUAL")?.value);
      const reject = Number(items.find((i) => i.key === "REJECT")?.value);
      const oeeItem = items.find((i) => i.key === "OEE");
      const settingColor = items.find((i) => i.key === "SETTING");
      settingColor.process = "blue";

      const end = endRaw < start ? endRaw + 1440 : endRaw;
      const totalTime = end - start;

      // ---- calculate break minutes ----
      const breakValues = calculateBreaks(start, end, sceduledLoss);
      const breakMinutes = Object.values(breakValues).reduce(
        (acc, val) => acc + val,
        0,
      );

      const workingTime = totalTime - breakMinutes;
      const plan = Math.floor(workingTime / cycleTime);

      // ---- update PLAN field ----
      const planItem = items.find((i) => i.key === "PLAN");
      if (planItem) planItem.value = String(plan);

      const breakHourItem = (Number(planItem.value) - actual) * cycleTime;
      let breakHourProcessItem = items.find((i) => i.key === "BREAK HOUR");
      breakHourProcessItem.process = breakHourItem.toString();

      const OEE =
        (((actual / plan) *
          ((actual - reject) / actual) *
          (workingTime - Number(breakHourItem))) /
          workingTime) *
        100;
      oeeItem.value = Math.floor(OEE);
    }

    // ---------------- MS/R/005 (Quotation) ----------------
    else if (process.processId === "MS/R/005") {
      const quotationItem = items.find((i) => i.key === "QUOTATION NO");
      const qlStatusItem = items.find((i) => i.key === "QL STATUS");

      if (qlStatusItem) {
        const status = String(qlStatusItem.value || "")
          .trim()
          .toUpperCase();
        // Keep ORDER / ORDER_HOLDED; otherwise derive from QUOTATION NO
        if (status !== "ORDER" && status !== "ORDER_HOLDED") {
          const quotationNo = quotationItem?.value?.trim() || "";
          qlStatusItem.value =
            quotationNo === "" ? "WAITING FOR QUOTE" : "WAITING FOR ORDER";
        }
      }
    }
    // ---------------- PR/R/003 (Procurement) — PR STATUS never blank ----
    else if (process.processId === "PR/R/003") {
      const prStatusItem = items.find((i) => i.key === "PR STATUS");
      if (!prStatusItem) {
        items.push({ key: "PR STATUS", value: "PENDING", process: "value" });
      } else if (!String(prStatusItem.value || "").trim()) {
        prStatusItem.value = "PENDING";
      }
    }
    // ---- MS/R/006A → MS/R/006 ---- Order List -> Quotation list
    else if (process.processId === "MS/R/006A") {
      const orderProcess = await Process.findOne({
        processId: "MS/R/006",
      });

      if (orderProcess) {
        const orderRow = orderProcess.data.find(
          (row) => row._id.toString() === rowDataId.toString(),
        );

        if (orderRow) {
          // Sum of all existing DELIVERY QTY of this particular order row's id
          let totalDeliveryQty = process.data.reduce((sum, row) => {
            if (
              row.rowDataId &&
              row.rowDataId.toString() === rowDataId.toString()
            ) {
              const qty = row.items.find(
                (item) => item.key === "DELIVERY QTY",
              )?.value;
              return sum + Number(qty || 0);
            }
            return sum;
          }, 0);

          // Add current row's delivery qty
          const currentDeliveryQty = Number(
            items.find((i) => i.key === "DELIVERY QTY")?.value || 0,
          );
          totalDeliveryQty += currentDeliveryQty;

          // current row order qty's PENDING QTY === QTY - total delivery qty.
          const orderQty = Number(
            orderRow.items.find((item) => item.key === "QTY")?.value || 0,
          );
          const pendingQty = orderQty - totalDeliveryQty;

          // PENDING QTY lives on Order List only (not Dockets headers)
          const orderPendingQtyItem = orderRow.items.find(
            (item) => item.key === "PENDING QTY",
          );
          if (orderPendingQtyItem) {
            orderPendingQtyItem.value = String(pendingQty);
          } else {
            orderRow.items.push({
              key: "PENDING QTY",
              value: String(pendingQty),
              process: "value",
            });
          }

          const customerName = orderRow.items.find(
            (item) => item.key === "CUSTOMER NAME",
          )?.value;
          const partNo = orderRow.items.find(
            (item) => item.key === "PART NO",
          )?.value;
          const partName = orderRow.items.find(
            (item) => item.key === "PART NAME",
          )?.value;
          const poNo = orderRow.items.find(
            (item) => item.key === "PO NO",
          )?.value;

          const name = items.find((i) => i.key === "CUSTOMER NAME");
          const part = items.find((i) => i.key === "PART NO");
          const partNameItem = items.find((i) => i.key === "PART NAME");
          const PO = items.find((i) => i.key === "PO NO");

          if (name) name.value = customerName || "";
          if (part) part.value = partNo || "";
          if (partNameItem) partNameItem.value = partName || "";
          if (PO) PO.value = poNo || "";

          // Auto-close order when fully delivered
          if (pendingQty <= 0) {
            const orderStatusItem = orderRow.items.find(
              (item) => item.key === "ORDER STATUS",
            );
            if (orderStatusItem) {
              orderStatusItem.value = "CLOSED";
            } else {
              orderRow.items.push({
                key: "ORDER STATUS",
                value: "CLOSED",
                process: "value",
              });
            }
          }

          orderProcess.markModified("data");
          await orderProcess.save();
        }
      }
    }

    // ---------------- DD/R/002 () ----------------
    else if (process.processId === "DD/R/002") {
      const itemListProcess = await Process.findOne({ processId: "PR/R/002" });
      if (!itemListProcess)
        throw new ErrorHandler("Item List Process (PR/R/002) not found", 404);

      const inputItemName = items
        .find((i) => i.key === "ITEM-NAME")
        ?.value?.trim();
      const inputItemGrade = items
        .find((i) => i.key === "GRADE")
        ?.value?.trim();
      if (!inputItemName || !inputItemGrade) return null;

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

      const itemCode = items.find((i) => i.key === "ITEM CODE");
      if (itemCode)
        itemCode.value =
          matchedRow?.items.find((i) => i.key === "ITEM CODE")?.value ?? "";
    } else if (process.processId === "DD/R/007") {
      // (QTY RETURNED / QTY SOLD) * 100 calculate this item row and store in the item SUCCESS RATE
      const qtyReturned = items.find((i) => i.key === "QTY RETURNED")?.value;
      const qtySold = items.find((i) => i.key === "QTY SOLD")?.value;
      const successRate = items.find((i) => i.key === "SUCCESS RATE");
      if (successRate)
        successRate.value = String(
          100 - (Number(qtyReturned) / Number(qtySold)) * 100,
        );
    } else if (process.processId === "PR/R/003A") {
      const procurmentRegisterProcess = await Process.findOne({
        processId: "PR/R/003",
      });

      if (!procurmentRegisterProcess)
        throw new ErrorHandler(
          "Procurement Register Process (PR/R/003) not found",
          404,
        );

      const matchedRow = procurmentRegisterProcess.data.find((itemRow) => {
        return itemRow._id.toString() === rowDataId.toString();
      });

      const vendorName = matchedRow?.items.find(
        (item) => item.key === "VENDOR-NAME",
      )?.value;
      const itemName = matchedRow?.items.find(
        (item) => item.key === "ITEM NAME",
      )?.value;
      const poNo = matchedRow?.items.find(
        (item) => item.key === "PO NO",
      )?.value;

      const name = items.find((i) => i.key === "VENDOR NAME");
      const part = items.find((i) => i.key === "ITEM NAME");
      const PO = items.find((i) => i.key === "PO NO");

      if (name) name.value = vendorName || "";
      if (part) part.value = itemName || "";
      if (PO) PO.value = poNo || "";
    }

    // ---------------- Save New Row ----------------
    const newRow = {
      items,
      rowDataId,
      _id: intersectionResponse?.newRowId || undefined,
    };
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
  } else {
    return next(
      new ErrorHandler(
        intersectionResponse?.message || "Intersection Processing Failed",
        intersectionResponse?.statusCode || 400,
      ),
    );
  }
});

// UPDATE row by rowId
exports.updateData = catchAsyncErrors(async (req, res, next) => {
  const process = await Process.findById(req.params.id);
  let { rowId, items } = req.body;

  // Parse items if it's a string
  if (typeof items === "string") {
    items = JSON.parse(items);
  }

  if (!Array.isArray(items)) {
    return next(new ErrorHandler("Items must be an array", 400));
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
      items[i].value = await storage.saveFile(file);
    }
  }

  if (process.processId === "MR/R/002") {
    const settingProcess = await Process.findOne({ processId: "MR/R/002A" });

    const settingData = settingProcess?.data.find((itemRow) => {
      return itemRow.rowDataId.toString() === rowId.toString();
    });

    const start = toMinutes(items.find((i) => i.key === "START TIME")?.value);
    const endRaw = toMinutes(items.find((i) => i.key === "END TIME")?.value);
    const cycleTime = Number(items.find((i) => i.key === "CYCLE TIME")?.value);
    const actual = Number(items.find((i) => i.key === "ACTUAL")?.value);
    const reject = Number(items.find((i) => i.key === "REJECT")?.value);
    const oeeItem = items.find((i) => i.key === "OEE");

    const settings = Number(
      settingData?.items.find((item) => item.key === "SETTING TIME")?.value ??
        0,
    );

    const end = endRaw < start ? endRaw + 1440 : endRaw;
    const totalTime = end - start;

    // ---- calculate break minutes ----
    const breakValues = calculateBreaks(start, end, sceduledLoss);
    const breakMinutes = Object.values(breakValues).reduce(
      (acc, val) => acc + val,
      0,
    );

    const workingTime = totalTime - breakMinutes - settings;
    const plan = Math.floor(workingTime / cycleTime);

    // ---- update PLAN field ----
    const planItem = items.find((i) => i.key === "PLAN");
    if (planItem) planItem.value = String(plan);

    const breakHourItem = (Number(planItem.value) - actual) * cycleTime;
    let breakHourProcessItem = items.find((i) => i.key === "BREAK HOUR");
    breakHourProcessItem.process = breakHourItem.toString();
    const settingColor = items.find((i) => i.key === "SETTING");
    settingColor.process = "blue";

    const OEE =
      (((actual / plan) *
        ((actual - reject) / actual) *
        (workingTime - Number(breakHourItem))) /
        workingTime) *
      100;
    oeeItem.value = Math.floor(OEE);
  } else if (process.processId === "DD/R/010") {
    // Sync process statuses from DD/R/012 (Detailed NPD Checklist)
    const d12Process = await Process.findOne({ processId: "DD/R/012" });
    if (d12Process) {
      const d12Row = d12Process.data.find(
        (r) => r.rowDataId && r.rowDataId.toString() === rowId.toString(),
      );
      if (d12Row) {
        const d12Items = d12Row.items;
        const protoItem = items.find((i) => i.key === "PROTO");
        const validationItem = items.find((i) => i.key === "VALIDATION");
        const masterPieceItem =
          items.find((i) => i.key === "MASTER PIECE") ||
          items.find((i) => i.key === "MASTER");

        const hasPending = d12Items.some((i) => i.value === "Pending");
        const hasInProgress = d12Items.some((i) => i.value === "In Progress");
        const allCompleted =
          d12Items.length > 0 && d12Items.every((i) => i.value === "Completed");

        const validationColor = d12Items.find((i) => i.key === "VALIDATION");
        const masterColor =
          d12Items.find((i) => i.key === "MASTER PIECE") ||
          d12Items.find((i) => i.key === "MASTER");

        // VALIDATION Sync
        if (validationItem) {
          // if (validationColor) validationItem.value = validationColor.value;
          const status = validationColor?.value;
          if (status === "Pending") validationItem.process = "red";
          else if (status === "In Progress") validationItem.process = "orange";
          else if (status === "Completed") validationItem.process = "green";
          else validationItem.process = "red";
        }

        // MASTER PIECE Sync
        if (masterPieceItem) {
          // if (masterColor) masterPieceItem.value = masterColor.value;
          const status = masterColor?.value;
          if (status === "Pending") masterPieceItem.process = "red";
          else if (status === "In Progress") masterPieceItem.process = "orange";
          else if (status === "Completed") masterPieceItem.process = "green";
          else masterPieceItem.process = "red";
        }

        // PROTO Summary Status Sync
        if (protoItem) {
          if (hasPending) {
            protoItem.process = "red";
            // protoItem.value = "Pending";
          } else if (hasInProgress) {
            protoItem.process = "orange";
            // protoItem.value = "In Progress";
          } else if (allCompleted) {
            protoItem.process = "green";
            // protoItem.value = "Completed";
          } else {
            protoItem.process = "gray";
            // protoItem.value = "Pending";
          }
        }
      }
    }
  } else if (process.processId === "DD/R/007") {
    // (QTY RETURNED / QTY SOLD) * 100 calculate this item row and store in the item SUCCESS RATE
    const qtyReturned = items.find((i) => i.key === "QTY RETURNED")?.value;
    const qtySold = items.find((i) => i.key === "QTY SOLD")?.value;
    const successRate = items.find((i) => i.key === "SUCCESS RATE");
    if (successRate)
      successRate.value = String(
        100 - (Number(qtyReturned) / Number(qtySold)) * 100,
      );
  } else if (process.processId === "MS/R/006A") {
    const orderProcess = await Process.findOne({
      processId: "MS/R/006",
    });

    const sourceRowId = row.rowDataId;
    if (orderProcess && sourceRowId) {
      const orderRow = orderProcess.data.find(
        (r) => r._id.toString() === sourceRowId.toString(),
      );

      if (orderRow) {
        // Sum of all DELIVERY QTY for this order except current row
        let totalDeliveryQty = process.data.reduce((sum, r) => {
          if (
            r._id.toString() !== rowId.toString() &&
            r.rowDataId &&
            r.rowDataId.toString() === sourceRowId.toString()
          ) {
            const qty = r.items.find(
              (item) => item.key === "DELIVERY QTY",
            )?.value;
            return sum + Number(qty || 0);
          }
          return sum;
        }, 0);

        // Add current updated delivery qty
        const currentDeliveryQty = Number(
          items.find((i) => i.key === "DELIVERY QTY")?.value || 0,
        );
        totalDeliveryQty += currentDeliveryQty;

        // current row order qty's PENDING QTY === QTY - total delivery qty
        const orderQty = Number(
          orderRow.items.find((item) => item.key === "QTY")?.value || 0,
        );
        const pendingQty = orderQty - totalDeliveryQty;

        // PENDING QTY lives on Order List only (not Dockets headers)
        const orderPendingQtyItem = orderRow.items.find(
          (item) => item.key === "PENDING QTY",
        );
        if (orderPendingQtyItem) {
          orderPendingQtyItem.value = String(pendingQty);
        } else {
          orderRow.items.push({
            key: "PENDING QTY",
            value: String(pendingQty),
            process: "value",
          });
        }

        const customerName = orderRow.items.find(
          (item) => item.key === "CUSTOMER NAME",
        )?.value;
        const partNo = orderRow.items.find(
          (item) => item.key === "PART NO",
        )?.value;
        const partName = orderRow.items.find(
          (item) => item.key === "PART NAME",
        )?.value;
        const poNo = orderRow.items.find((item) => item.key === "PO NO")?.value;

        const name = items.find((i) => i.key === "CUSTOMER NAME");
        const part = items.find((i) => i.key === "PART NO");
        const partNameItem = items.find((i) => i.key === "PART NAME");
        const PO = items.find((i) => i.key === "PO NO");

        if (name) name.value = customerName || "";
        if (part) part.value = partNo || "";
        if (partNameItem) partNameItem.value = partName || "";
        if (PO) PO.value = poNo || "";

        if (pendingQty <= 0) {
          const orderStatusItem = orderRow.items.find(
            (item) => item.key === "ORDER STATUS",
          );
          if (orderStatusItem) {
            orderStatusItem.value = "CLOSED";
          } else {
            orderRow.items.push({
              key: "ORDER STATUS",
              value: "CLOSED",
              process: "value",
            });
          }
        }

        orderProcess.markModified("data");
        await orderProcess.save();
      }
    }
  } else if (process.processId === "PR/R/003A") {
    const procurmentRegisterProcess = await Process.findOne({
      processId: "PR/R/003",
    });

    if (!procurmentRegisterProcess)
      throw new ErrorHandler(
        "Procurement Register Process (PR/R/003) not found",
        404,
      );

    const matchedRow = procurmentRegisterProcess.data.find((itemRow) => {
      return itemRow._id.toString() === row.rowDataId?.toString();
    });

    const vendorName = matchedRow?.items.find(
      (item) => item.key === "VENDOR-NAME",
    )?.value;
    const itemName = matchedRow?.items.find(
      (item) => item.key === "ITEM NAME",
    )?.value;
    const poNo = matchedRow?.items.find((item) => item.key === "PO NO")?.value;

    const name = items.find((i) => i.key === "VENDOR NAME");
    const part = items.find((i) => i.key === "ITEM NAME");
    const PO = items.find((i) => i.key === "PO NO");

    if (name) name.value = vendorName || "";
    if (part) part.value = itemName || "";
    if (PO) PO.value = poNo || "";
  }

  // Update row data
  const previousItems = oldData?.items || JSON.parse(JSON.stringify(row.items));
  row.items = items;
  process.updatedBy = req.user._id;

  let intersectionResponse;

  if (process.processId !== "DD/R/014") {
    intersectionResponse = await handleUpdateIntersection(
      process,
      items,
      row,
      req.user._id,
      rowId,
      previousItems,
    );
  } else {
    intersectionResponse = { success: true };
  }

  if (intersectionResponse && intersectionResponse.success) {
    // Save process only if intersection succeeds
    await process.save();

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
  } else {
    return next(
      new ErrorHandler(
        intersectionResponse?.message || "Intersection Processing Failed",
        intersectionResponse?.statusCode || 400,
      ),
    );
  }
});

// DELETE row by rowId
exports.deleteData = catchAsyncErrors(async (req, res, next) => {
  const process = await Process.findById(req.params.id);
  const { rowId, userId } = req.body;

  if (!process) {
    return next(new ErrorHandler("Process not found", 404));
  }

  const currentRow = process.data.id(rowId);
  const intersectionResponse = await handleDeleteIntersection(
    process,
    rowId,
    req.user._id,
    currentRow,
  );

  if (intersectionResponse && !intersectionResponse.success) {
    return next(
      new ErrorHandler(
        intersectionResponse?.message || "Intersection Delete Failed",
        intersectionResponse?.statusCode || 400,
      ),
    );
  }

  if (!currentRow) {
    return next(new ErrorHandler("Row not found", 404));
  }

  if (process.processId === "MR/R/001") {
    const procurementProcess = await Process.findOne({
      processId: "PR/R/003",
    });

    const planNumber = currentRow.items.find(
      (item) => item.key === "PLAN NO",
    )?.value;

    if (procurementProcess) {
      const rowsToDelete = procurementProcess.data.filter(
        (r) => r.items.find((i) => i.key === "PL NO")?.value === planNumber,
      );
      procurementProcess.data = procurementProcess.data.filter(
        (r) => !rowsToDelete.includes(r),
      );
      procurementProcess.updatedBy = req.user._id ?? userId;
      await procurementProcess.save();
    }
  }

  const oldData = { ...currentRow.toObject() };

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
    .populate("changedBy", "name email")
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
    .populate("changedBy", "name email")
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
  const productionPlanProcess = await Process.findOne({
    processId: "MR/R/001",
  });
  const employeeHistory = await Process.findOne({ processId: "HR/R/001" });

  if (
    !productsProcess ||
    !itemListProcess ||
    !vendorListProcess ||
    !customerListProcess ||
    !employeeHistory
  ) {
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
  const itemCode = new Set();

  // Use Sets to remove duplicates from vendor list
  const vendorName = new Set();

  // Use Sets to remove duplicates from customer list
  const customerName = new Set();

  // Use Sets to remove duplicates from production plan
  const planNumber = new Set();

  // Use Sets to remove the duplciates from name
  const employeeName = new Set();

  let groupOfItems = [];
  productsProcess.data.forEach((row) => {
    const pNo = row.items.find((i) => i.key === "PART NO")?.value;
    const pName = row.items.find((i) => i.key === "PART NAME")?.value;
    const pType = row.items.find((i) => i.key === "TYPE")?.value;
    const pMaterial = row.items.find((i) => i.key === "MATERIAL")?.value;

    groupOfItems.push([
      {
        "PART-NO": pNo,
        "PART-NAME": pName,
        TYPE: pType,
        MATERIAL: pMaterial,
      },
    ]);

    if (pNo) partNo.add(pNo);
    if (pName) partName.add(pName);
    if (pType) type.add(pType);
    if (pMaterial) material.add(pMaterial);
  });

  let groupOfItemList = [];
  itemListProcess.data.forEach((row) => {
    const iName = row.items.find((i) => i.key === "ITEM NAME")?.value;
    const grade = row.items.find((i) => i.key === "ITEM GRADE")?.value;
    const iCode = row.items.find((i) => i.key === "ITEM CODE")?.value;

    const itemCategory = row.items.find(
      (i) => i.key === "ITEM CATEGORY",
    )?.value;

    groupOfItemList.push([
      {
        "ITEM-NAME": iName,
        GRADE: grade,
        "ITEM-CODE": iCode,
      },
    ]);

    if (iName) itemName.add(iName);
    if (grade) itemGrade.add(grade);
    if (iCode && itemCategory === "FINISHED GOOD") itemCode.add(iCode);
  });

  let groupOfVendorList = [];
  vendorListProcess.data.forEach((row) => {
    const vName = row.items.find((i) => i.key === "VENDOR NAME")?.value;
    const vAddress =
      row.items.find((i) => i.key === "ADDRESS")?.value ||
      row.items.find((i) => i.key === "Address")?.value ||
      "";
    groupOfVendorList.push([
      {
        "VENDOR-NAME": vName,
        "VENDOR NAME": vName,
        ADDRESS: vAddress,
      },
    ]);
    if (vName) vendorName.add(vName);
  });

  let groupOfCustomerList = [];
  customerListProcess.data.forEach((row) => {
    const cName = row.items.find((i) => i.key === "CUSTOMER NAME")?.value;
    const cLocation = row.items.find((i) => i.key === "LOCATION")?.value;
    groupOfCustomerList.push([
      {
        "CUSTOMER-NAME": cName,
        "CUSTOMER NAME": cName,
        LOCATION: cLocation || "",
      },
    ]);
    if (cName) customerName.add(cName);
  });

  let groupOfProductionPlan = [];
  productionPlanProcess.data.forEach((row) => {
    const planNo = row.items.find((i) => i.key === "PLAN NO")?.value;
    const assembly = row.items.find((i) => i.key === "ASSEMBLY")?.value;

    groupOfProductionPlan.push([
      {
        "PLAN-NO": planNo,
      },
    ]);

    if (planNo && assembly !== "COMPLETED") planNumber.add(planNo);
  });

  let groupOfEmployeeName = [];
  employeeHistory.data.forEach((row) => {
    const Name = row.items.find((i) => i.key === "NAME")?.value;
    groupOfEmployeeName.push([
      {
        "GENERAL SHIFT": Name,
      },
    ]);
    if (Name) employeeName.add(Name);
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
    { key: "CUSTOMER NAME", value: Array.from(customerName) },
    { key: "ENQ BY", value: Array.from(employeeName) },
    { key: "ITEM_CODE", value: Array.from(itemCode) },
    { key: "PLAN-NO", value: Array.from(planNumber) },
    { key: "GENERAL SHIFT", value: Array.from(employeeName) },
    { key: "1 SHIFT", value: Array.from(employeeName) },
    { key: "2 SHIFT", value: Array.from(employeeName) },
    { key: "3 SHIFT", value: Array.from(employeeName) },
  ];

  res.status(200).json({
    success: true,
    data: response,
    groupOfItems,
    groupOfItemList,
    groupOfVendorList,
    groupOfCustomerList,
    groupOfProductionPlan,
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

// ─── Individual Dashboard Controllers ───────────────────────────────────────
// Each controller fetches only the data for its own section.

// GET /dashboard/production-plan
exports.getDashboardProductionPlan = catchAsyncErrors(
  async (req, res, next) => {
    const { startDate, endDate } = req.query ?? {};
    const now = new Date();
    const effectiveStart = startDate
      ? Number(startDate)
      : new Date(now.getFullYear(), 0, 1).getTime();
    const effectiveEnd = endDate
      ? Number(endDate)
      : new Date(now.getFullYear() + 1, 11, 31, 23, 59, 59, 999).getTime();

    const productionPlanProcess = await Process.findOne({
      processId: "MR/R/001",
    });
    if (!productionPlanProcess)
      return res.status(200).json({ success: true, data: {} });

    // A plan is pending until EVERY stage is completed (any stage not completed → pending)
    const PLAN_STAGES = ["RM", "INCOMING INSPECTION", "MACHINE", "ASSEMBLY", "OUT PROCESS"];
    const isStageCompleted = (row, stage) =>
      String(row.items.find((item) => item.key === stage)?.value || "")
        .trim()
        .toLowerCase() === "completed";
    const pendingDetails = productionPlanProcess.data.filter(
      (row) => !PLAN_STAGES.every((stage) => isStageCompleted(row, stage)),
    );

    const planQtyOf = (row) =>
      Number(row.items.find((item) => item.key === "PLAN QTY")?.value) || 0;

    // One bar per part number: PLAN QTY summed across all plans for that part
    const byPart = new Map();
    productionPlanProcess.data.forEach((row) => {
      const partNo =
        String(row.items.find((item) => item.key === "PART-NO")?.value || "").trim() || "N/A";
      byPart.set(partNo, (byPart.get(partNo) || 0) + planQtyOf(row));
    });
    const reportGraph = [...byPart.entries()].map(([partNo, planQty]) => ({
      partNo,
      planQty,
    }));

    const totalPlanQty = productionPlanProcess.data.reduce(
      (acc, row) => acc + planQtyOf(row),
      0,
    );
    const pendingPlanQty = pendingDetails.reduce(
      (acc, row) => acc + planQtyOf(row),
      0,
    );

    res
      .status(200)
      .json({
        success: true,
        data: { pendingDetails, reportGraph, totalPlanQty, pendingPlanQty },
      });
  },
);

// GET /dashboard/production-report
exports.getDashboardProductionReport = catchAsyncErrors(
  async (req, res, next) => {
    const { startDate, endDate } = req.query ?? {};
    const now = new Date();
    const effectiveStart = startDate
      ? Number(startDate)
      : new Date(now.getFullYear(), 0, 1).getTime();
    const effectiveEnd = endDate
      ? Number(endDate)
      : new Date(now.getFullYear() + 1, 11, 31, 23, 59, 59, 999).getTime();

    const productionReportProcess = await Process.findOne({
      processId: "MR/R/002",
    });
    if (!productionReportProcess)
      return res
        .status(200)
        .json({ success: true, data: { totalFiltered: 0 } });

    const filteredRows = productionReportProcess.data.filter((row) => {
      const dateItem = row.items.find((item) => item.key === "DATE");
      if (!dateItem || !dateItem.value) return false;
      const epochMs = Number(dateItem.value);
      if (isNaN(epochMs)) return false;
      return epochMs >= effectiveStart && epochMs <= effectiveEnd;
    });

    res
      .status(200)
      .json({ success: true, data: { totalFiltered: filteredRows.length } });
  },
);

// GET /dashboard/reject-report
exports.getDashboardRejectReport = catchAsyncErrors(async (req, res, next) => {
  const [rejectReportProcess, productionReportProcess, actionTakenProcess] =
    await Promise.all([
      Process.findOne({ processId: "MR/R/003" }),
      Process.findOne({ processId: "MR/R/002" }),
      Process.findOne({ processId: "MR/R/003B" }),
    ]);

  if (!rejectReportProcess)
    return res
      .status(200)
      .json({
        success: true,
        data: { totalFiltered: 0, data: [], chartResult: 0 },
      });

  const openData = actionTakenProcess
    ? actionTakenProcess.data.filter(
        (row) =>
          row.items
            .find((item) => item.key === "ACTION PLAN STATUS")
            ?.value?.toLowerCase() === "open",
      )
    : [];

  const resultData = rejectReportProcess.data.filter((row) =>
    openData.some(
      (openRow) => openRow.rowDataId?.toString() === row._id.toString(),
    ),
  );

  let chartResult = 0;
  if (productionReportProcess && productionReportProcess.data.length > 0) {
    const sumOfReject = rejectReportProcess.data.reduce(
      (acc, row) =>
        acc +
        (Number(row.items.find((item) => item.key === "REJECT QTY")?.value) ||
          0),
      0,
    );
    const sumOfActual = productionReportProcess.data.reduce(
      (acc, row) =>
        acc +
        (Number(row.items.find((item) => item.key === "ACTUAL QTY")?.value) ||
          0),
      0,
    );
    chartResult = sumOfActual > 0 ? sumOfReject / sumOfActual : 0;
  }

  res
    .status(200)
    .json({
      success: true,
      data: { totalFiltered: resultData.length, data: resultData, chartResult },
    });
});

// GET /dashboard/rework-report
exports.getDashboardReworkReport = catchAsyncErrors(async (req, res, next) => {
  const reworkReportProcess = await Process.findOne({ processId: "MR/R/003A" });
  if (!reworkReportProcess)
    return res
      .status(200)
      .json({ success: true, data: { totalFiltered: 0, data: [] } });

  const openData = reworkReportProcess.data.filter(
    (row) =>
      row.items
        .find((item) => item.key === "RR STATUS")
        ?.value?.toLowerCase() === "open",
  );

  res
    .status(200)
    .json({
      success: true,
      data: { totalFiltered: openData.length, data: openData },
    });
});

// GET /dashboard/dispatch
exports.getDashboardDispatch = catchAsyncErrors(async (req, res, next) => {
  const { startDate, endDate } = req.query ?? {};
  const now = new Date();
  const effectiveStart = startDate
    ? Number(startDate)
    : new Date(now.getFullYear(), 0, 1).getTime();
  const effectiveEnd = endDate
    ? Number(endDate)
    : new Date(now.getFullYear() + 1, 11, 31, 23, 59, 59, 999).getTime();

  const dispatchProcess = await Process.findOne({ processId: "MR/R/006" });
  if (!dispatchProcess)
    return res
      .status(200)
      .json({
        success: true,
        data: {
          totalFiltered: 0,
          data: [],
          totalQuantity: 0,
          graphChart: { monthWise: [], yearWise: [] },
        },
      });

  const filteredRows = dispatchProcess.data.filter((row) => {
    const dateItem = row.items.find((item) => item.key === "DATE");
    if (!dateItem || !dateItem.value) return false;
    const epochMs = Number(dateItem.value);
    if (isNaN(epochMs)) return false;
    return epochMs >= effectiveStart && epochMs <= effectiveEnd;
  });

  const data = filteredRows.map((row) => ({
    partNo: row.items.find((item) => item.key === "PART-NO")?.value || "N/A",
    qty: Number(row.items.find((item) => item.key === "QTY")?.value) || 0,
    date: row.items.find((item) => item.key === "DATE")?.value || null,
  }));

  const monthMap = {};
  const yearMap = {};
  filteredRows.forEach((row) => {
    const epochMs = Number(
      row.items.find((item) => item.key === "DATE")?.value,
    );
    const qty =
      Number(row.items.find((item) => item.key === "QTY")?.value) || 0;
    const d = new Date(epochMs);
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, "0");
    const monthKey = `${year}-${month}`;
    monthMap[monthKey] = (monthMap[monthKey] || 0) + qty;
    yearMap[year] = (yearMap[year] || 0) + qty;
  });

  const monthWise = Object.entries(monthMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, qty]) => ({ label, qty }));
  const yearWise = Object.entries(yearMap)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([label, qty]) => ({ label: String(label), qty }));
  const totalQuantity = filteredRows.reduce(
    (acc, row) =>
      acc + (Number(row.items.find((item) => item.key === "QTY")?.value) || 0),
    0,
  );

  res
    .status(200)
    .json({
      success: true,
      data: {
        totalFiltered: filteredRows.length,
        data,
        totalQuantity,
        graphChart: { monthWise, yearWise },
      },
    });
});

// GET /dashboard/calibration
exports.getDashboardCalibration = catchAsyncErrors(async (req, res, next) => {
  const calibrationReportProcess = await Process.findOne({
    processId: "QA/R/002A",
  });
  if (!calibrationReportProcess)
    return res
      .status(200)
      .json({
        success: true,
        data: { totalFiltered: 0, data: [], doneCount: 0, dueCount: 0 },
      });

  const filteredCalibration = calibrationReportProcess.data.filter((row) => {
    const certificate = row.items.find(
      (item) => item.key === "CERTIFICATE",
    )?.value;
    const date = row.items.find((item) => item.key === "DATE")?.value;
    return (
      certificate === "" ||
      certificate === null ||
      date <= Date.now() - 10 * 24 * 60 * 60 * 1000
    );
  });

  const doneCount = filteredCalibration.filter(
    (row) =>
      row.items.find((item) => item.key === "DONE")?.value?.toLowerCase() ===
      "done",
  ).length;
  const dueCount = filteredCalibration.filter(
    (row) =>
      row.items.find((item) => item.key === "DONE")?.value?.toLowerCase() ===
      "due",
  ).length;

  res
    .status(200)
    .json({
      success: true,
      data: {
        totalFiltered: filteredCalibration.length,
        data: filteredCalibration,
        doneCount,
        dueCount,
      },
    });
});

// GET /dashboard/incoming-inspection
exports.getDashboardIncomingInspection = catchAsyncErrors(
  async (req, res, next) => {
    const incomingInspectionProcess = await Process.findOne({
      processId: "QA/R/003",
    });
    if (!incomingInspectionProcess)
      return res
        .status(200)
        .json({ success: true, data: { totalFiltered: 0, data: [] } });

    const filteredInspection = incomingInspectionProcess.data.filter((row) => {
      const status = row.items.find(
        (item) => item.key === "INSPECTION-STATUS",
      )?.value;
      return status?.toLowerCase() !== "done";
    });

    res
      .status(200)
      .json({
        success: true,
        data: {
          totalFiltered: filteredInspection.length,
          data: filteredInspection,
        },
      });
  },
);

// GET /dashboard/customer-complaints
exports.getDashboardCustomerComplaints = catchAsyncErrors(
  async (req, res, next) => {
    const customerComplientRegisterProcess = await Process.findOne({
      processId: "QA/R/007",
    });
    if (!customerComplientRegisterProcess)
      return res
        .status(200)
        .json({ success: true, data: { totalFiltered: 0, data: [] } });

    const filteredCustomer = customerComplientRegisterProcess.data.map(
      (row) => {
        const suppliedQty = row.items.find(
          (item) => item.key === "SUPPLIED QTY",
        )?.value;
        const failedQty = row.items.find(
          (item) => item.key === "FAILED QTY",
        )?.value;
        const date = row.items.find((item) => item.key === "DATE")?.value;
        return { ratio: suppliedQty ? failedQty / suppliedQty : 0, date };
      },
    );

    res
      .status(200)
      .json({
        success: true,
        data: {
          totalFiltered: filteredCustomer.length,
          data: filteredCustomer,
        },
      });
  },
);

// GET /dashboard/customer-list
exports.getDashboardCustomerList = catchAsyncErrors(async (req, res, next) => {
  const { salesPerson, location } = req.query ?? {};
  const customerListProcess = await Process.findOne({ processId: "MS/R/004" });
  if (!customerListProcess)
    return res
      .status(200)
      .json({ success: true, data: { totalFiltered: 0, data: [] } });

  const filteredCustomer = customerListProcess.data.filter((row) => {
    const salesPersonValue = row.items.find(
      (item) => item.key === "SALES PERSON",
    )?.value;
    const locationValue = row.items.find(
      (item) => item.key === "LOCATION",
    )?.value;
    const matchSales =
      !salesPerson ||
      salesPerson === "" ||
      salesPersonValue?.toLowerCase() === salesPerson.toLowerCase();
    const matchLocation =
      !location ||
      location === "" ||
      locationValue?.toLowerCase() === location.toLowerCase();
    return matchSales && matchLocation;
  });

  res
    .status(200)
    .json({
      success: true,
      data: { totalFiltered: filteredCustomer.length, data: filteredCustomer },
    });
});

// GET /dashboard/quotation-list
exports.getDashboardQuotationList = catchAsyncErrors(async (req, res, next) => {
  const quotationListProcess = await Process.findOne({ processId: "MS/R/005" });
  if (!quotationListProcess)
    return res
      .status(200)
      .json({ success: true, data: { totalFiltered: 0, data: [] } });

  const filteredQuotation = quotationListProcess.data.filter((row) => {
    const status = row.items
      .find((item) => item.key === "QL STATUS")
      ?.value?.toLowerCase();
    return status === "waiting for quote" || status === "waiting for order";
  });

  res
    .status(200)
    .json({
      success: true,
      data: {
        totalFiltered: filteredQuotation.length,
        data: filteredQuotation,
      },
    });
});

// GET /dashboard/order-list
exports.getDashboardOrderList = catchAsyncErrors(async (req, res, next) => {
  const orderListProcess = await Process.findOne({ processId: "MS/R/006" });
  if (!orderListProcess)
    return res
      .status(200)
      .json({
        success: true,
        data: { totalFiltered: 0, data: [], totalOrderQty: 0 },
      });

  // Order List keeps its status in "ORDER STATUS" (older data may use "STATUS")
  const filteredOrder = orderListProcess.data.filter((row) => {
    const status =
      row.items.find((item) => item.key === "ORDER STATUS")?.value ??
      row.items.find((item) => item.key === "STATUS")?.value;
    return String(status || "").trim().toLowerCase() !== "closed";
  });

  const totalOrderQty = filteredOrder.reduce(
    (acc, row) =>
      acc + (Number(row.items.find((item) => item.key === "QTY")?.value) || 0),
    0,
  );

  res
    .status(200)
    .json({
      success: true,
      data: {
        totalFiltered: filteredOrder.length,
        data: filteredOrder,
        totalOrderQty,
      },
    });
});

// GET /dashboard/procurement
exports.getDashboardProcurement = catchAsyncErrors(async (req, res, next) => {
  const procurementProcess = await Process.findOne({ processId: "PR/R/003" });
  if (!procurementProcess)
    return res
      .status(200)
      .json({
        success: true,
        data: { totalFiltered: 0, data: [], totalPendingQty: 0 },
      });

  const filteredProcurement = procurementProcess.data.filter((row) => {
    const status = row.items.find((item) => item.key === "PR STATUS")?.value;
    return status?.toLowerCase() === "pending";
  });

  const totalPendingQty = filteredProcurement.reduce(
    (acc, row) =>
      acc + (Number(row.items.find((item) => item.key === "QTY")?.value) || 0),
    0,
  );

  res
    .status(200)
    .json({
      success: true,
      data: {
        totalFiltered: filteredProcurement.length,
        data: filteredProcurement,
        totalPendingQty,
      },
    });
});

// GET /dashboard/stock
exports.getDashboardStock = catchAsyncErrors(async (req, res, next) => {
  const stockDataProcess = await Process.findOne({ processId: "ST/R/006" });
  if (!stockDataProcess)
    return res
      .status(200)
      .json({
        success: true,
        data: { totalFiltered: 0, data: [], totalStockQty: 0 },
      });

  const filteredStock = stockDataProcess.data.filter((row) => {
    const itemCategory = row.items.find(
      (item) => item.key === "ITEM CATEGORY",
    )?.value;
    return (
      itemCategory?.toLowerCase() === "finished good" ||
      itemCategory?.toLowerCase() === "finsihed good"
    );
  });

  const totalStockQty = filteredStock.reduce(
    (acc, row) =>
      acc +
      (Number(row.items.find((item) => item.key === "STOCK")?.value) || 0),
    0,
  );

  res
    .status(200)
    .json({
      success: true,
      data: {
        totalFiltered: filteredStock.length,
        data: filteredStock,
        totalStockQty,
      },
    });
});

exports.getMainNPDRegisterDashboard = catchAsyncErrors(
  async (req, res, next) => {
    const npdProcess = await Process.findOne({ processId: "DD/R/010" });

    if (!npdProcess) {
      return next(
        new ErrorHandler("NPD Register Process (DD/R/010) not found", 404),
      );
    }

    const filteredData = npdProcess.data
      .filter((row) => {
        const proto = row.items.find((i) => i.key === "PROTO")?.process;
        const validation = row.items.find(
          (i) => i.key === "VALIDATION",
        )?.process;
        const master = (
          row.items.find((i) => i.key === "MASTER PIECE") ||
          row.items.find((i) => i.key === "MASTER")
        )?.process;
        const status = row.items.find((i) => i.key === 'NPD STATUS')?.value;

        // Filter: return rows where PROTO, VALIDATION, or MASTER is NOT green
        return (
          (proto !== "green" || validation !== "green" || master !== "green") && status !== "Not Feasible"
        );
      })
      .map((row) => {
        const items = row.items;
        return {
          from: items.find((i) => i.key === "FROM")?.value || "",
          date: items.find((i) => i.key === "TARGET DATE")?.value || "",
          part:
            items.find((i) => i.key === "PART")?.value ||
            items.find((i) => i.key === "PART NAME")?.value ||
            "",
          proto: items.find((i) => i.key === "PROTO")?.process || "",
          validation: items.find((i) => i.key === "VALIDATION")?.process || "",
          master:
            (
              items.find((i) => i.key === "MASTER PIECE") ||
              items.find((i) => i.key === "MASTER")
            )?.process || "",
          // Days left to TARGET DATE; without a target, how long since the enquiry DATE
          due: (() => {
            const target = toEpoch(items.find((i) => i.key === "TARGET DATE")?.value);
            const enquiry = toEpoch(items.find((i) => i.key === "DATE")?.value);
            const plural = (n) => (Math.abs(n) === 1 ? "" : "s");
            const today = startOfDay(Date.now());
            if (target !== null) {
              const d = Math.round((startOfDay(target) - today) / DAY_MS);
              if (d === 0) return "Due today";
              return d > 0 ? `${d} day${plural(d)} left` : `${-d} day${plural(d)} overdue`;
            }
            if (enquiry !== null) {
              const d = Math.max(0, Math.round((today - startOfDay(enquiry)) / DAY_MS));
              return `Open ${d} day${plural(d)}`;
            }
            return null;
          })(),
        };
      });

    res.status(200).json({
      success: true,
      count: filteredData.length,
      data: filteredData,
    });
  },
);

exports.getMainProductListDashboard = catchAsyncErrors(
  async (req, res, next) => {
    const productListProcess = await Process.findOne({ processId: "DD/R/001" });
    const BOMProcess = await Process.findOne({ processId: "DD/R/002" });

    if (!productListProcess || !BOMProcess) {
      return next(
        new ErrorHandler(
          "Product List Process (DD/R/001) or BOM Process (DD/R/002) not found",
          404,
        ),
      );
    }

    // GET THE COUNT OF THE RECORDS.
    const totalProducts = productListProcess.data.length;
    const totalBOMs = BOMProcess.data.length;

    res.status(200).json({
      success: true,
      totalProducts,
      totalBOMs,
    });
  },
);

exports.getMainRevisionControlDashboard = catchAsyncErrors(
  async (req, res, next) => {
    const revisionControlProcess = await Process.findOne({
      processId: "DD/R/005",
    });

    if (!revisionControlProcess) {
      return next(
        new ErrorHandler("Revision Control Process (DD/R/003) not found", 404),
      );
    }

    const filteredData = revisionControlProcess.data
      .filter((row) => {
        const status = row.items.find(
          (i) => i.key === "REVISION STATUS",
        )?.value;
        return status?.toLowerCase() !== "revised";
      })
      .map((row) => {
        const items = row.items;
        return {
          date: items.find((i) => i.key === "DATE")?.value || "",
          part: items.find((i) => i.key === "PART NO")?.value || "",
          status: items.find((i) => i.key === "REVISION STATUS")?.value || "",
          // How long the revision has been open: today − entered DATE
          due: (() => {
            const epoch = toEpoch(items.find((i) => i.key === "DATE")?.value);
            if (epoch === null) return null;
            const days = Math.max(0, Math.round((startOfDay(Date.now()) - startOfDay(epoch)) / DAY_MS));
            return `${days} day${days === 1 ? "" : "s"} open`;
          })(),
        };
      });

    res.status(200).json({
      success: true,
      count: filteredData.length,
      data: filteredData,
    });
  },
);

exports.getMainOrderListDashboard = catchAsyncErrors(async (req, res, next) => {
  const orderListProcess = await Process.findOne({ processId: "MS/R/006" });

  if (!orderListProcess) {
    return next(
      new ErrorHandler("Order List Process (MS/R/006) not found", 404),
    );
  }

  const { startDate, endDate } = req.query;
  const now = new Date();
  const effectiveStart = startDate
    ? Number(startDate)
    : new Date(now.getFullYear(), 0, 1).getTime();
  const effectiveEnd = endDate
    ? Number(endDate)
    : new Date(now.getFullYear() + 1, 11, 31, 23, 59, 59, 999).getTime();

  const filteredData = orderListProcess.data.filter((row) => {
    const dateItem = row.items.find((i) => i.key === "DATE");
    if (!dateItem || !dateItem.value) return false;
    const epochMs = Number(dateItem.value);
    return epochMs >= effectiveStart && epochMs <= effectiveEnd;
  });

  res.status(200).json({
    success: true,
    count: filteredData.length,
    data: filteredData,
  });
});

exports.getMainDocketsDashboard = catchAsyncErrors(async (req, res, next) => {
  // Using PR/R/003A as per the provided JSON snippet for Inward
  const docketsProcess = await Process.findOne({ processId: "MS/R/006A" });

  if (!docketsProcess) {
    return next(new ErrorHandler("Dockets Process (MS/R/006A) not found", 404));
  }

  const { startDate, endDate } = req.query;
  const now = new Date();
  // 1. Initial status filter: PAYMENT === "OPEN"
  let filteredData = docketsProcess.data.filter((row) => {
    const payment = row.items.find((i) => i.key === "PAYMENT")?.value;
    return payment?.toUpperCase() !== "CLOSED";
  });

  // 2. Filter by DELIVERY DATE if both startDate and endDate are provided
  if (startDate && endDate) {
    const start = Number(startDate);
    const end = Number(endDate);

    filteredData = filteredData.filter((row) => {
      const dateItem = row.items.find((i) => i.key === "DELIVERY DATE");
      if (!dateItem || !dateItem.value) return false;
      const epochMs = Number(dateItem.value);
      return epochMs >= start && epochMs <= end;
    });
  }

  res.status(200).json({
    success: true,
    data: {
      totalOpen: filteredData.length,
      openRecords: filteredData,
    },
  });
});

exports.getProductSuccessDashboard = catchAsyncErrors(
  async (req, res, next) => {
    const productSuccessProcess = await Process.findOne({
      processId: "DD/R/007",
    });

    if (!productSuccessProcess) {
      return next(
        new ErrorHandler("Product Success Process (DD/R/007) not found", 404),
      );
    }

    const filteredData = productSuccessProcess.data.filter((row) => {
      const status = row.items.find((i) => i.key === "STATUS")?.value;
      return status?.toUpperCase() !== "CLOSED";
    });

    let totalSuccessRate = 0;
    let count = 0;

    filteredData.forEach((row) => {
      const successRateItem = row.items.find((i) => i.key === "SUCCESS RATE");
      if (successRateItem && successRateItem.value) {
        const val = parseFloat(successRateItem.value);
        if (!isNaN(val)) {
          totalSuccessRate += val;
          count++;
        }
      }
    });

    const avgSuccessRate = count > 0 ? totalSuccessRate / count : 0;

    res.status(200).json({
      success: true,
      data: {
        totalOpen: filteredData.length,
        avgSuccessRate: Number(avgSuccessRate.toFixed(2)),
        openRecords: filteredData,
      },
    });
  },
);

exports.getMainSettings = catchAsyncErrors(async (req, res, next) => {
  const settingsProcess = await Process.findOne({ processId: "MR/R/002A" });

  if (!settingsProcess) {
    return next(
      new ErrorHandler("Settings Process (MR/R/002A) not found", 404),
    );
  }

  const filteredData = settingsProcess.data.filter((row) => {
    const status = row.items.find((i) => i.key === "STATUS OF SETTINGS")?.value;
    return status?.toUpperCase() !== "UNDER PROCESS";
  });

  res.status(200).json({
    success: true,
    data: filteredData,
  });
});

exports.getSettingsDashboard = catchAsyncErrors(async (req, res, next) => {
  const settingsProcess = await Process.findOne({ processId: "MR/R/002A" });

  if (!settingsProcess) {
    return next(
      new ErrorHandler("Settings Process (MR/R/002A) not found", 404),
    );
  }

  const { startDate, endDate } = req.query;
  let filteredData = settingsProcess.data;

  // if (startDate && endDate) {
  //   const start = Number(startDate);
  //   const end = Number(endDate);
  //   filteredData = filteredData.filter((row) => {
  //     const dateItem = row.items.find((i) => i.key === "DATE");
  //     if (!dateItem || !dateItem.value) return false;
  //     const epochMs = Number(dateItem.value);
  //     return epochMs >= start && epochMs <= end;
  //   });
  // }

  let totalSettingTime = 0;
  let totalSetupLoss = 0;
  let settingTimeCount = 0;
  let setupLossCount = 0;

  filteredData.forEach((row) => {
    const settingTimeItem = row.items.find((i) => i.key === "SETTING TIME");
    const setupLossItem = row.items.find((i) => i.key === "SET UP LOSS");

    if (settingTimeItem && settingTimeItem.value) {
      const val = parseFloat(settingTimeItem.value);
      if (!isNaN(val)) {
        totalSettingTime += val;
        settingTimeCount++;
      }
    }

    if (setupLossItem && setupLossItem.value) {
      const val = parseFloat(setupLossItem.value);
      if (!isNaN(val)) {
        totalSetupLoss += val;
        setupLossCount++;
      }
    }
  });

  res.status(200).json({
    success: true,
    data: {
      noOfSettings: filteredData.length,
      averageSettingTime:
        settingTimeCount > 0
          ? Number((totalSettingTime / settingTimeCount).toFixed(2))
          : 0,
      avgSetupLoss:
        setupLossCount > 0
          ? Number((totalSetupLoss / setupLossCount).toFixed(2))
          : 0,
    },
  });
});

exports.getCalibrationDueDashboard = catchAsyncErrors(
  async (req, res, next) => {
    const calibrationProcess = await Process.findOne({
      processId: "QA/R/002A",
    });

    if (!calibrationProcess) {
      return next(
        new ErrorHandler("Calibration Process (QA/R/002A) not found", 404),
      );
    }

    // An instrument needs attention when its calibration is overdue, due within
    // the next 10 days, or it has no calibration certificate uploaded.
    const DUE_SOON_DAYS = 10;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayEpoch = today.getTime();
    const dueSoonLimit = todayEpoch + (DUE_SOON_DAYS + 1) * 24 * 60 * 60 * 1000 - 1;

    const classify = (row) => {
      const certificate = row.items.find((item) => item.key === "CERTIFICATE")?.value;
      const dueValue =
        row.items.find((item) => item.key === "DUE")?.value ||
        row.items.find((item) => item.key === "DATE")?.value;
      const dueEpoch = Number(dueValue);
      const hasDue = dueValue !== undefined && dueValue !== "" && !isNaN(dueEpoch) && dueEpoch > 0;
      return {
        noCertificate: certificate === undefined || certificate === null || String(certificate).trim() === "",
        overdue: hasDue && dueEpoch < todayEpoch,
        dueSoon: hasDue && dueEpoch >= todayEpoch && dueEpoch <= dueSoonLimit,
        dueEpoch: hasDue ? dueEpoch : null,
      };
    };

    const flagged = calibrationProcess.data
      .map((row) => ({ row, flags: classify(row) }))
      .filter(({ flags }) => flags.overdue || flags.dueSoon || flags.noCertificate)
      // Most urgent first: overdue, then due soonest; rows with no due date last
      .sort((a, b) => (a.flags.dueEpoch ?? Infinity) - (b.flags.dueEpoch ?? Infinity));

    const overdueCount = flagged.filter(({ flags }) => flags.overdue).length;
    const dueSoonCount = flagged.filter(({ flags }) => flags.dueSoon).length;
    const noCertificateCount = flagged.filter(({ flags }) => flags.noCertificate).length;

    // Instrument name/number live on the parent Instrument & Calibration row (QA/R/002)
    const instrumentsProcess = await Process.findOne({ processId: "QA/R/002" }).lean();
    const instrumentRows = instrumentsProcess?.data || [];
    const instrumentById = new Map(instrumentRows.map((r) => [String(r._id), r]));
    const valueOf = (items, key) => items?.find((i) => i.key === key)?.value || "";
    const calibratedIds = new Set(
      calibrationProcess.data.map((r) => (r.rowDataId ? String(r.rowDataId) : null)).filter(Boolean),
    );
    // Active instruments that have no calibration record at all yet
    const notRecordedCount = instrumentRows.filter((r) => {
      const status = String(valueOf(r.items, "CR-STATUS")).trim().toUpperCase();
      return status !== "INACTIVE" && !calibratedIds.has(String(r._id));
    }).length;

    const openRecords = flagged.map(({ row, flags }) => {
      const plain = typeof row.toObject === "function" ? row.toObject() : row;
      const parent = row.rowDataId ? instrumentById.get(String(row.rowDataId)) : null;
      const name = valueOf(parent?.items, "INSTRUMENT NAME");
      const no = valueOf(parent?.items, "INSTRUMENT NO");
      return {
        ...plain,
        instrumentName: [no, name].filter(Boolean).join(" · ") || "",
        overdue: flags.overdue,
        dueSoon: flags.dueSoon,
        noCertificate: flags.noCertificate,
      };
    });

    res.status(200).json({
      success: true,
      data: {
        totalFiltered: flagged.length,
        overdueCount,
        dueSoonCount,
        noCertificateCount,
        notRecordedCount,
        dueSoonDays: DUE_SOON_DAYS,
        openRecords,
      },
    });
  },
);

exports.getProcessControlPlanDashboard = catchAsyncErrors(
  async (req, res, next) => {
    const pcpProcess = await Process.findOne({ processId: "QA/R/009" });

    if (!pcpProcess) {
      return next(
        new ErrorHandler(
          "Process Control Plan Process (QA/R/009) not found",
          404,
        ),
      );
    }

    const { startDate, endDate } = req.query;
    let filteredData = pcpProcess.data;

    const totalRecords = filteredData.length;
    const pendingRecordsData = filteredData.filter((row) => {
      const fileUpload = row.items.find((i) => i.key === "FILE UPLOAD")?.value;
      return fileUpload === "" || fileUpload === null;
    });

    res.status(200).json({
      success: true,
      data: {
        totalRecords,
        pendingCount: pendingRecordsData.length,
        pendingRecords: pendingRecordsData,
      },
    });
  },
);

exports.getCertificateRenewalDashboard = catchAsyncErrors(
  async (req, res, next) => {
    const certificateProcess = await Process.findOne({ processId: "QA/R/011" });

    if (!certificateProcess) {
      return next(
        new ErrorHandler(
          "Certificate Renewal Process (QA/R/011) not found",
          404,
        ),
      );
    }

    // Renewal history lives in Certificate Renewal Details (QA/R/011A), linked by rowDataId
    const detailsProcess = await Process.findOne({ processId: "QA/R/011A" }).lean();
    const keyOf = (k) => String(k || "").trim().toUpperCase();
    const epochOf = (items, keys) => {
      const hit = (items || []).find((i) => keys.includes(keyOf(i.key)));
      const n = Number(hit?.value);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    const EXPIRY_KEYS = ["EXPIRY DATE", "EXPIRY", "VALID TILL", "VALID UPTO", "DUE DATE", "DUE"];
    const RENEWAL_KEYS = ["NEXT RENEVAL", "NEXT RENEWAL"];
    // Latest expiry per certificate (the most recent renewal decides the current validity)
    const latestExpiryByCert = new Map();
    for (const d of detailsProcess?.data || []) {
      const certId = d.rowDataId ? String(d.rowDataId) : null;
      if (!certId) continue;
      const expiry = epochOf(d.items, EXPIRY_KEYS) ?? epochOf(d.items, RENEWAL_KEYS);
      if (expiry === null) continue;
      if (!latestExpiryByCert.has(certId) || expiry > latestExpiryByCert.get(certId)) {
        latestExpiryByCert.set(certId, expiry);
      }
    }

    let filteredData = certificateProcess.data;

    const results = filteredData.map((row) => {
      const items = row.items;
      const certName =
        items.find((i) => i.key === "CERTIFICATE NAME")?.value || "N/A";
      const certNo =
        items.find((i) => keyOf(i.key) === "CERTIFICATE NO")?.value || "N/A";
      const department =
        items.find((i) => i.key === "DEPARTMENT")?.value || "N/A";
      const status = items.find((i) => i.key === "CRS-STATUS")?.value || "N/A";

      // Expiry: latest renewal record first; otherwise an expiry/due column on the certificate
      // itself (an issue date is never used as the due date).
      const epoch =
        latestExpiryByCert.get(String(row._id)) ??
        epochOf(items, EXPIRY_KEYS) ??
        epochOf(items, RENEWAL_KEYS);
      let reminder = "No date set";
      let isDue = false;

      if (epoch && !isNaN(epoch)) {
        const daysLeft = Math.ceil(
          (epoch - Date.now()) / (1000 * 60 * 60 * 24),
        );
        if (daysLeft < 0) {
          reminder = `${Math.abs(daysLeft)} days overdue`;
          isDue = true;
        } else if (daysLeft === 0) {
          reminder = "Expires today";
          isDue = true;
        } else if (daysLeft <= 30) {
          reminder = `Due in ${daysLeft} days`;
          isDue = true;
        } else {
          reminder = `${daysLeft} days remaining`;
        }
      }

      return {
        certName,
        certNo,
        department,
        status,
        dueDate: epoch,
        reminder,
        isDue,
      };
    });

    // Most urgent first (overdue → expiring soonest); certificates with no date go last
    results.sort((a, b) => (a.dueDate ?? Infinity) - (b.dueDate ?? Infinity));

    res.status(200).json({
      success: true,
      data: results,
    });
  },
);

// 1. NPD Dashboard
exports.getNPDDashboardDetails = catchAsyncErrors(async (req, res, next) => {
  const npdProcess = await Process.findOne({ processId: "DD/R/010" });

  if (!npdProcess) {
    return next(
      new ErrorHandler("NPD Register Process (DD/R/010) not found", 404),
    );
  }

  const filteredData = npdProcess.data
    .filter((row) => {
      const proto = row.items.find((i) => i.key === "PROTO")?.process;
      const validation = row.items.find((i) => i.key === "VALIDATION")?.process;
      const master = (
        row.items.find((i) => i.key === "MASTER PIECE") ||
        row.items.find((i) => i.key === "MASTER")
      )?.process;

      // Filter: return rows where PROTO, VALIDATION, or MASTER is NOT green
      return proto !== "green" || validation !== "green" || master !== "green";
    })
    .map((row) => {
      const items = row.items;
      return {
        from: items.find((i) => i.key === "FROM")?.value || "",
        date: items.find((i) => i.key === "TARGET DATE")?.value || "",
        part:
          items.find((i) => i.key === "PART")?.value ||
          items.find((i) => i.key === "PART NAME")?.value ||
          "",
        proto: items.find((i) => i.key === "PROTO")?.process || "",
        validation: items.find((i) => i.key === "VALIDATION")?.process || "",
        master:
          (
            items.find((i) => i.key === "MASTER PIECE") ||
            items.find((i) => i.key === "MASTER")
          )?.process || "",
        due: (() => {
          const epoch = Number(
            items.find((i) => i.key === "TARGET DATE")?.value,
          );
          if (!epoch) return null;
          return `${Math.ceil((epoch - Date.now()) / (1000 * 60 * 60 * 24))} days`;
        })(),
      };
    });

  res.status(200).json({
    success: true,
    count: filteredData.length,
    data: filteredData,
  });
});

// 2. Product Dashboard
exports.getProductDashboard = catchAsyncErrors(async (req, res, next) => {
  const ProductsProcess = await Process.findOne({ processId: "DD/R/001" });
  const BOMProcess = await Process.findOne({ processId: "DD/R/002" });

  if (!ProductsProcess || !BOMProcess) {
    return next(
      new ErrorHandler(
        "Product List (DD/R/001) or BOM (DD/R/002) Process not found",
        404,
      ),
    );
  }

  const uniqueProductParts = new Set();
  ProductsProcess.data.forEach((row) => {
    const partNo = row.items.find(
      (i) => i.key === "PART NO" || i.key === "PART-NO",
    )?.value;
    if (partNo) uniqueProductParts.add(partNo.trim());
  });

  const uniqueBOMParts = new Set();
  BOMProcess.data.forEach((row) => {
    const partNo = row.items.find(
      (i) => i.key === "PART NO" || i.key === "PART-NO",
    )?.value;
    if (partNo) uniqueBOMParts.add(partNo.trim());
  });

  res.status(200).json({
    success: true,
    data: {
      totalProducts: uniqueProductParts.size,
      totalBOM: uniqueBOMParts.size,
    },
  });
});

// 3. Revision Control Dashboard
exports.getRevisionControlDashboard = catchAsyncErrors(
  async (req, res, next) => {
    const revisionControlProcess = await Process.findOne({
      processId: "DD/R/005",
    });

    if (!revisionControlProcess) {
      return next(
        new ErrorHandler("Revision Control Process (DD/R/005) not found", 404),
      );
    }

    const filteredData = revisionControlProcess.data
      .filter((row) => {
        const status = row.items.find(
          (i) => i.key === "REVISION STATUS",
        )?.value;
        return status === "INREVISION";
      })
      .map((row) => {
        const items = row.items;
        return {
          partNo:
            items.find((i) => i.key === "PART NO" || i.key === "PART-NO")
              ?.value || "",
          partName:
            items.find((i) => i.key === "PART NAME" || i.key === "PART-NAME")
              ?.value || "",
          revisionStatus:
            items.find((i) => i.key === "REVISION STATUS")?.value || "",
          dueDate:
            items.find((i) => i.key === "DUE DATE" || i.key === "DUE")?.value ||
            "",
        };
      });

    res.status(200).json({
      success: true,
      count: filteredData.length,
      data: filteredData,
    });
  },
);

// Design Department Dashboard (single call for the whole Design dashboard)
// GET /design/dashboard
const DAY_MS = 24 * 60 * 60 * 1000;
const normKey = (k) => String(k || "").replace(/\s+/g, " ").trim().toUpperCase();
const designVal = (items = [], keys = []) => {
  const wanted = keys.map(normKey);
  const hit = items.find((i) => wanted.includes(normKey(i.key)));
  const v = hit?.value;
  return Array.isArray(v) ? v.join(", ") : typeof v === "string" ? v.trim() : v;
};
const designItem = (items = [], keys = []) => {
  const wanted = keys.map(normKey);
  return items.find((i) => wanted.includes(normKey(i.key)));
};
const toEpoch = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const startOfDay = (ms) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const countDistinct = (rows = [], keys = []) => {
  const set = new Set();
  rows.forEach((row) => {
    const v = designVal(row.items, keys);
    if (v) set.add(String(v).toUpperCase());
  });
  return set.size;
};

exports.getDesignDashboard = catchAsyncErrors(async (req, res, next) => {
  const ids = ["DD/R/001", "DD/R/002A", "DD/R/007", "DD/R/005", "DD/R/010"];
  const processes = await Process.find({ processId: { $in: ids } })
    .select("processId data")
    .lean();
  const byId = Object.fromEntries(processes.map((p) => [p.processId, p]));
  const rowsOf = (id) => byId[id]?.data || [];
  const today = startOfDay(Date.now());

  // 1. Product counts
  // Series + main products from Product List (DD/R/001); sub products from Products (DD/R/002A)
  const productCounts = {
    seriesCount: countDistinct(rowsOf("DD/R/001"), ["SERIES"]),
    mainProductCount: countDistinct(rowsOf("DD/R/001"), ["PART NO", "PART-NO"]),
    subProductCount: countDistinct(rowsOf("DD/R/002A"), ["PART NO", "PART-NO"]),
  };

  // 2. Product Success Rate (DD/R/007): average + lowest 5
  const successRows = rowsOf("DD/R/007")
    .filter((row) => String(designVal(row.items, ["STATUS"]) || "").toUpperCase() !== "CLOSED")
    .map((row) => {
      const items = row.items || [];
      const sold = Number(designVal(items, ["QTY SOLD"])) || 0;
      const returned = Number(designVal(items, ["QTY RETURNED"])) || 0;
      let rate = null;
      if (sold > 0) {
        rate = ((sold - returned) / sold) * 100;
      } else {
        const stored = parseFloat(designVal(items, ["SUCCESS RATE"]));
        // Older rows may store a fraction (0.97) instead of a percent (97)
        if (Number.isFinite(stored)) rate = stored > 0 && stored <= 1 ? stored * 100 : stored;
      }
      return {
        series: designVal(items, ["SERIES"]) || "-",
        partNo: designVal(items, ["PART NO", "PART-NO"]) || "-",
        partName: designVal(items, ["PART NAME", "PART-NAME"]) || "-",
        qtySold: sold,
        qtyReturned: returned,
        successRate: rate === null ? null : Number(rate.toFixed(2)),
      };
    })
    .filter((r) => r.successRate !== null);

  const avgSuccessRate = successRows.length
    ? Number(
        (successRows.reduce((s, r) => s + r.successRate, 0) / successRows.length).toFixed(2),
      )
    : 0;
  const lowest = [...successRows].sort((a, b) => a.successRate - b.successRate).slice(0, 5);

  // 3. Revision Control (DD/R/005): rows IN REVISION, due = days open since entered DATE
  const revisionRows = rowsOf("DD/R/005")
    .filter((row) => {
      const s = String(designVal(row.items, ["REVISION STATUS"]) || "")
        .replace(/[\s_-]/g, "")
        .toUpperCase();
      return s === "INREVISION";
    })
    .map((row) => {
      const items = row.items || [];
      const entered = toEpoch(designVal(items, ["DATE"]));
      const daysOpen = entered === null ? null : Math.max(0, Math.round((today - startOfDay(entered)) / DAY_MS));
      return {
        rowId: row._id,
        partNo: designVal(items, ["PART NO", "PART-NO"]) || "-",
        problemDescription: designVal(items, ["PROBLEM DESCRIPTION"]) || "-",
        date: entered,
        daysOpen,
        due: daysOpen === null ? "-" : `${daysOpen} day${daysOpen === 1 ? "" : "s"} open`,
      };
    })
    .sort((a, b) => (b.daysOpen ?? -1) - (a.daysOpen ?? -1));

  // 4. NPD Register (DD/R/010): pending rows (any of PROTO / VALIDATION / MASTER not green)
  // Due = days left to TARGET DATE; when there is no TARGET DATE, days since enquiry DATE.
  const npdRows = rowsOf("DD/R/010")
    .filter((row) => {
      const items = row.items || [];
      const proto = designItem(items, ["PROTO"])?.process;
      const validation = designItem(items, ["VALIDATION"])?.process;
      const master = designItem(items, ["MASTER PIECE", "MASTER"])?.process;
      const status = String(designVal(items, ["NPD STATUS"]) || "").toUpperCase();
      return (proto !== "green" || validation !== "green" || master !== "green") && status !== "NOT FEASIBLE";
    })
    .map((row) => {
      const items = row.items || [];
      const target = toEpoch(designVal(items, ["TARGET DATE"]));
      const enquiry = toEpoch(designVal(items, ["DATE"]));
      let dueDays = null;
      let dueBasis = null;
      let due = "-";
      if (target !== null) {
        dueDays = Math.round((startOfDay(target) - today) / DAY_MS);
        dueBasis = "target";
        due =
          dueDays > 0
            ? `${dueDays} day${dueDays === 1 ? "" : "s"} left`
            : dueDays === 0
              ? "Due today"
              : `${Math.abs(dueDays)} day${dueDays === -1 ? "" : "s"} overdue`;
      } else if (enquiry !== null) {
        dueDays = Math.max(0, Math.round((today - startOfDay(enquiry)) / DAY_MS));
        dueBasis = "enquiry";
        due = `Open ${dueDays} day${dueDays === 1 ? "" : "s"}`;
      }
      return {
        rowId: row._id,
        no: designVal(items, ["NO"]) || "",
        from: designVal(items, ["FROM"]) || "-",
        enquiryDate: enquiry,
        targetDate: target,
        part: designVal(items, ["PART", "PART NAME"]) || "-",
        npdStatus: designVal(items, ["NPD STATUS"]) || "",
        proto: designItem(items, ["PROTO"])?.process || "",
        validation: designItem(items, ["VALIDATION"])?.process || "",
        master: designItem(items, ["MASTER PIECE", "MASTER"])?.process || "",
        dueDays,
        dueBasis,
        due,
      };
    });

  res.status(200).json({
    success: true,
    data: {
      productCounts,
      productSuccess: {
        totalRecords: successRows.length,
        avgSuccessRate,
        lowest,
      },
      revision: { count: revisionRows.length, rows: revisionRows },
      npd: { count: npdRows.length, rows: npdRows },
    },
  });
});

// Sales Department Dashboard (single call for the whole Sales dashboard)
// GET /sales/dashboard?groupBy=day|month|year&startDate=<epoch>&endDate=<epoch>&enqBy=<name>
const dueInfo = (baseEpoch, days) => {
  if (baseEpoch === null) return { dueDate: null, dueDays: null, due: "-" };
  const dueDate = baseEpoch + (Number(days) || 0) * DAY_MS;
  const dueDays = Math.round((startOfDay(dueDate) - startOfDay(Date.now())) / DAY_MS);
  const plural = (n) => (Math.abs(n) === 1 ? "" : "s");
  const due =
    dueDays > 0
      ? `${dueDays} day${plural(dueDays)} left`
      : dueDays === 0
        ? "Due today"
        : `${Math.abs(dueDays)} day${plural(dueDays)} overdue`;
  return { dueDate, dueDays, due };
};
const pad2 = (n) => String(n).padStart(2, "0");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const periodOf = (epoch, groupBy) => {
  const d = new Date(epoch);
  if (groupBy === "year") return { key: `${d.getFullYear()}`, label: `${d.getFullYear()}` };
  if (groupBy === "day")
    return {
      key: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
      label: `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`,
    };
  return {
    key: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`,
    label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
  };
};

exports.getSalesDashboard = catchAsyncErrors(async (req, res, next) => {
  const groupBy = ["day", "month", "year"].includes(req.query.groupBy)
    ? req.query.groupBy
    : "month";
  const startDate = toEpoch(req.query.startDate);
  const endDate = toEpoch(req.query.endDate);
  const enqByFilter = String(req.query.enqBy || "").trim().toUpperCase();

  const ids = ["MS/R/004", "MS/R/005", "MS/R/006", "MS/R/006A"];
  const processes = await Process.find({ processId: { $in: ids } })
    .select("processId data")
    .lean();
  const byId = Object.fromEntries(processes.map((p) => [p.processId, p]));
  const rowsOf = (id) => byId[id]?.data || [];

  // 1. Customer count (Customer List MS/R/004) — all customers
  const customerCount = countDistinct(rowsOf("MS/R/004"), ["CUSTOMER NAME", "CUSTOMER-NAME"]);

  // 2. Quotation status counts (Quotation List MS/R/005, QL STATUS)
  const quotation = { waitingForOrder: 0, waitingForQuote: 0 };
  rowsOf("MS/R/005").forEach((row) => {
    const s = String(designVal(row.items, ["QL STATUS"]) || "").replace(/\s+/g, " ").toUpperCase();
    if (s === "WAITING FOR ORDER") quotation.waitingForOrder += 1;
    else if (s === "WAITING FOR QUOTE") quotation.waitingForQuote += 1;
  });

  // 3. Pending orders (Order List MS/R/006): PENDING QTY > 0 and not CLOSED
  const orderRows = rowsOf("MS/R/006");
  const enqByOfOrder = new Map(
    orderRows.map((row) => [String(row._id), designVal(row.items, ["ENQ BY"]) || ""]),
  );
  const pendingOrders = orderRows
    .map((row) => {
      const items = row.items || [];
      const pendingQty = Number(designVal(items, ["PENDING QTY"])) || 0;
      const unitPrice = Number(designVal(items, ["VALUE"])) || 0;
      const status = String(designVal(items, ["ORDER STATUS"]) || "").toUpperCase();
      const orderDate = toEpoch(designVal(items, ["ORDER DATE"]));
      const leadTimeRaw = String(designVal(items, ["LEAD TIME"]) ?? "").trim();
      const leadTime = leadTimeRaw === "" ? NaN : Number(leadTimeRaw);
      return {
        rowId: row._id,
        status,
        customer: designVal(items, ["CUSTOMER NAME", "CUSTOMER-NAME"]) || "-",
        partName: designVal(items, ["PART NAME", "PART-NAME"]) || "-",
        partNo: designVal(items, ["PART NO", "PART-NO"]) || "-",
        pendingQty,
        // VALUE on Order List is the unit price
        pendingValue: Number((pendingQty * unitPrice).toFixed(2)),
        leadTimeMissing: !Number.isFinite(leadTime),
        ...dueInfo(orderDate, Number.isFinite(leadTime) ? leadTime : 0),
      };
    })
    .filter((r) => r.pendingQty > 0 && r.status !== "CLOSED")
    .sort((a, b) => (a.dueDays ?? Infinity) - (b.dueDays ?? Infinity));

  // 4. Pending payments (Dockets MS/R/006A): PAYMENT not CLOSED; due = DELIVERY DATE + CREDIT PERIOD
  const docketRows = rowsOf("MS/R/006A");
  const pendingPayments = docketRows
    .filter((row) => String(designVal(row.items, ["PAYMENT"]) || "").toUpperCase() !== "CLOSED")
    .map((row) => {
      const items = row.items || [];
      const creditPeriod = Number(designVal(items, ["CREDIT PERIOD"])) || 0;
      return {
        rowId: row._id,
        customer: designVal(items, ["CUSTOMER NAME", "CUSTOMER-NAME"]) || "-",
        partNo: designVal(items, ["PART NO", "PART-NO"]) || "-",
        invoiceNo: designVal(items, ["INVOICE NO"]) || "-",
        value: Number(designVal(items, ["VALUE"])) || 0,
        creditPeriod,
        ...dueInfo(toEpoch(designVal(items, ["DELIVERY DATE"])), creditPeriod),
      };
    })
    .sort((a, b) => (a.dueDays ?? Infinity) - (b.dueDays ?? Infinity));

  // 5. Sales trend (Dockets): VALUE + DELIVERY QTY per day / month / year of DELIVERY DATE.
  // ENQ BY comes from the linked Order List row (docket.rowDataId = order row _id).
  const buckets = new Map();
  docketRows.forEach((row) => {
    const items = row.items || [];
    const delivered = toEpoch(designVal(items, ["DELIVERY DATE"]));
    if (delivered === null) return;
    if (startDate !== null && delivered < startDate) return;
    if (endDate !== null && delivered > endDate) return;
    if (enqByFilter) {
      const enqBy = String(enqByOfOrder.get(String(row.rowDataId)) || "").toUpperCase();
      if (enqBy !== enqByFilter) return;
    }
    const { key, label } = periodOf(delivered, groupBy);
    const b = buckets.get(key) || { key, period: label, value: 0, deliveryQty: 0 };
    b.value += Number(designVal(items, ["VALUE"])) || 0;
    b.deliveryQty += Number(designVal(items, ["DELIVERY QTY"])) || 0;
    buckets.set(key, b);
  });
  const trend = [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key));

  const enqByOptions = [
    ...new Set(
      [...orderRows, ...rowsOf("MS/R/005")]
        .map((row) => designVal(row.items, ["ENQ BY"]))
        .filter(Boolean),
    ),
  ].sort();

  res.status(200).json({
    success: true,
    data: {
      customerCount,
      quotation,
      pendingOrders: { count: pendingOrders.length, rows: pendingOrders },
      pendingPayments: { count: pendingPayments.length, rows: pendingPayments },
      salesTrend: { groupBy, data: trend, enqByOptions },
    },
  });
});

// Purchase Department Dashboard (single call for the whole Purchase dashboard)
// GET /purchase/dashboard?vendor=&itemName=&partNo=&supplier=
//   vendor / itemName / partNo → filter Procurement Detail; supplier → filter Supplier Payment
exports.getPurchaseDashboard = catchAsyncErrors(async (req, res, next) => {
  const norm = (v) => String(v ?? "").replace(/\s+/g, " ").trim().toUpperCase();
  const want = {
    vendor: norm(req.query.vendor),
    itemName: norm(req.query.itemName),
    partNo: norm(req.query.partNo),
    supplier: norm(req.query.supplier),
  };
  // Unique dropdown values; "xxx" and "XXX" are the same choice (filters match case-insensitively)
  const sortedUnique = (values) => {
    const seen = new Map();
    values.forEach((v) => {
      const text = String(v || "").trim();
      if (text && !seen.has(norm(text))) seen.set(norm(text), text);
    });
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  };

  const processes = await Process.find({ processId: { $in: ["PR/R/003", "PR/R/003A"] } })
    .select("processId data")
    .lean();
  const byId = Object.fromEntries(processes.map((p) => [p.processId, p]));
  const procurementRows = byId["PR/R/003"]?.data || [];
  const inwardRows = byId["PR/R/003A"]?.data || [];

  // 1. Procurement Detail (PR/R/003): not CLOSED and still has quantity to receive.
  // An empty PENDING QTY means nothing has been received yet → the full QTY is pending.
  const pendingAll = procurementRows
    .map((row) => {
      const items = row.items || [];
      const qty = Number(designVal(items, ["QTY"])) || 0;
      const pendingRaw = designVal(items, ["PENDING QTY"]);
      const pendingQty =
        pendingRaw === undefined || pendingRaw === null || String(pendingRaw).trim() === ""
          ? qty
          : Number(pendingRaw) || 0;
      const unitPrice = Number(designVal(items, ["VALUE"])) || 0;
      const leadTimeRaw = String(designVal(items, ["LEAD TIME"]) ?? "").trim();
      const leadTime = leadTimeRaw === "" ? NaN : Number(leadTimeRaw);
      return {
        rowId: row._id,
        status: String(designVal(items, ["PR STATUS"]) || "").toUpperCase(),
        vendor: designVal(items, ["VENDOR-NAME", "VENDOR NAME"]) || "",
        partNo: designVal(items, ["PART NO", "PART-NO"]) || "",
        itemName: designVal(items, ["ITEM NAME"]) || "",
        grade: designVal(items, ["GRADE"]) || "",
        poNo: designVal(items, ["PO NO"]) || "",
        pendingQty,
        // VALUE on Procurement Register is the price per unit
        pendingValue: Number((pendingQty * unitPrice).toFixed(2)),
        leadTimeMissing: !Number.isFinite(leadTime),
        ...dueInfo(
          toEpoch(designVal(items, ["DATE"])),
          Number.isFinite(leadTime) ? leadTime : 0,
        ),
      };
    })
    .filter((r) => r.pendingQty > 0 && r.status !== "CLOSED");

  const procurementRowsFiltered = pendingAll
    .filter(
      (r) =>
        (!want.vendor || norm(r.vendor) === want.vendor) &&
        (!want.itemName || norm(r.itemName) === want.itemName) &&
        (!want.partNo || norm(r.partNo) === want.partNo),
    )
    .sort((a, b) => (a.dueDays ?? Infinity) - (b.dueDays ?? Infinity));

  // 2. Supplier Payment (Inward PR/R/003A): PAYMENT = OPEN.
  // VENDOR NAME is often blank on Inward → fall back to the linked procurement row's VENDOR-NAME.
  const procurementVendorById = new Map(
    procurementRows.map((row) => [
      String(row._id),
      designVal(row.items, ["VENDOR-NAME", "VENDOR NAME"]) || "",
    ]),
  );
  const openPaymentsAll = inwardRows
    .filter((row) => norm(designVal(row.items, ["PAYMENT"])) === "OPEN")
    .map((row) => {
      const items = row.items || [];
      const creditPeriod = Number(designVal(items, ["CREDIT PERIOD"])) || 0;
      const vendor =
        designVal(items, ["VENDOR NAME", "VENDOR-NAME"]) ||
        procurementVendorById.get(String(row.rowDataId)) ||
        "";
      return {
        rowId: row._id,
        vendor,
        invoiceNo: designVal(items, ["INVOICE NO"]) || "",
        poNo: designVal(items, ["PO NO"]) || "",
        itemName: designVal(items, ["ITEM NAME"]) || "",
        value: Number(designVal(items, ["VALUE"])) || 0,
        creditPeriod,
        creditPeriodMissing: String(designVal(items, ["CREDIT PERIOD"]) ?? "").trim() === "",
        ...dueInfo(toEpoch(designVal(items, ["DELIVERY DATE"])), creditPeriod),
      };
    });

  const paymentRows = openPaymentsAll
    .filter((r) => !want.supplier || norm(r.vendor) === want.supplier)
    .sort((a, b) => (a.dueDays ?? Infinity) - (b.dueDays ?? Infinity));

  res.status(200).json({
    success: true,
    data: {
      procurement: {
        pendingCount: procurementRowsFiltered.length,
        totalPendingQty: Number(
          procurementRowsFiltered.reduce((s, r) => s + r.pendingQty, 0).toFixed(2),
        ),
        totalPendingValue: Number(
          procurementRowsFiltered.reduce((s, r) => s + r.pendingValue, 0).toFixed(2),
        ),
        rows: procurementRowsFiltered,
        // Dropdown options come from every pending row, so a filter never hides its own choices
        options: {
          vendor: sortedUnique(pendingAll.map((r) => r.vendor)),
          itemName: sortedUnique(pendingAll.map((r) => r.itemName)),
          partNo: sortedUnique(pendingAll.map((r) => r.partNo)),
        },
      },
      supplierPayment: {
        totalValue: Number(paymentRows.reduce((s, r) => s + r.value, 0).toFixed(2)),
        supplierCount: new Set(paymentRows.map((r) => norm(r.vendor)).filter(Boolean)).size,
        withoutSupplier: paymentRows.filter((r) => !r.vendor).length,
        openCount: paymentRows.length,
        rows: paymentRows,
        options: { supplier: sortedUnique(openPaymentsAll.map((r) => r.vendor)) },
      },
    },
  });
});

// Quality Department Dashboard (single call for the whole Quality dashboard)
// GET /quality/dashboard?trendBy=month|year&period=<YYYY-MM | YYYY>&ciYear=<YYYY>&ciMonth=<1-12>
exports.getQualityDepartmentDashboard = catchAsyncErrors(async (req, res, next) => {
  const trendBy = req.query.trendBy === "year" ? "year" : "month";
  const ids = [
    "QA/R/007", "MS/R/006A", "MR/R/005", "MR/R/005A", "QA/R/003",
    "QA/F/005", "QA/R/002A", "QA/R/011", "QA/R/011A", "DD/R/001", "QA/R/009",
  ];
  const processes = await Process.find({ processId: { $in: ids } })
    .select("processId data")
    .lean();
  const byId = Object.fromEntries(processes.map((p) => [p.processId, p]));
  const rowsOf = (id) => byId[id]?.data || [];
  const today = startOfDay(Date.now());
  const norm = (v) => String(v ?? "").replace(/\s+/g, " ").trim().toUpperCase();
  const plural = (n) => (Math.abs(n) === 1 ? "" : "s");

  // 1. Customer rejection rate: FAILED QTY (Customer Complient Register) ÷ DELIVERY QTY
  //    (Dockets raised against Order List) × 100, per month or per year.
  const buckets = new Map();
  const bucket = (epoch) => {
    const { key, label } = periodOf(epoch, trendBy);
    if (!buckets.has(key)) buckets.set(key, { key, period: label, failedQty: 0, deliveredQty: 0 });
    return buckets.get(key);
  };
  let openComplaints = 0;
  rowsOf("QA/R/007").forEach((row) => {
    const items = row.items || [];
    if (norm(designVal(items, ["CCR STATUS"])) !== "CLOSED") openComplaints += 1;
    const date = toEpoch(designVal(items, ["DATE"]));
    if (date !== null) bucket(date).failedQty += Number(designVal(items, ["FAILED QTY"])) || 0;
  });
  rowsOf("MS/R/006A").forEach((row) => {
    const date = toEpoch(designVal(row.items, ["DELIVERY DATE"]));
    if (date !== null) bucket(date).deliveredQty += Number(designVal(row.items, ["DELIVERY QTY"])) || 0;
  });
  const rate = (failed, delivered) =>
    delivered > 0 ? Number(((failed / delivered) * 100).toFixed(2)) : null;
  const trend = [...buckets.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((b) => ({ ...b, rate: rate(b.failedQty, b.deliveredQty) }));
  const currentKey = periodOf(Date.now(), trendBy).key;
  const requested = String(req.query.period || "");
  const periodKey =
    requested === "all" ? "all" : trend.some((t) => t.key === requested) ? requested : currentKey;
  const inPeriod = periodKey === "all" ? trend : trend.filter((t) => t.key === periodKey);
  const overallFailed = inPeriod.reduce((s, t) => s + t.failedQty, 0);
  const overallDelivered = inPeriod.reduce((s, t) => s + t.deliveredQty, 0);
  const periodOptions = [...new Set([currentKey, ...trend.map((t) => t.key)])]
    .sort()
    .reverse()
    .map((key) => ({
      key,
      label: trend.find((t) => t.key === key)?.period ||
        periodOf(Date.now(), trendBy).label,
    }));

  // 2. Continuous improvement by department (DEPARTMENT is on the Improvement Status child rows,
  //    MR/R/005A; each improvement is counted once per department, dated by the improvement's DATE)
  const ciYear = Number(req.query.ciYear) || null;
  const ciMonth = Number(req.query.ciMonth) || null; // 1-12
  const deptsByImprovement = new Map();
  rowsOf("MR/R/005A").forEach((row) => {
    const dept = String(designVal(row.items, ["DEPARTMENT"]) || "").trim();
    if (!row.rowDataId || !dept) return;
    const key = String(row.rowDataId);
    if (!deptsByImprovement.has(key)) deptsByImprovement.set(key, new Set());
    deptsByImprovement.get(key).add(dept);
  });
  const ciCounts = new Map();
  const ciYears = new Set();
  let ciTotal = 0;
  rowsOf("MR/R/005").forEach((row) => {
    const date = toEpoch(designVal(row.items, ["DATE"]));
    if (date !== null) ciYears.add(new Date(date).getFullYear());
    if (ciYear || ciMonth) {
      if (date === null) return;
      const d = new Date(date);
      if (ciYear && d.getFullYear() !== ciYear) return;
      if (ciMonth && d.getMonth() + 1 !== ciMonth) return;
    }
    ciTotal += 1;
    const depts = deptsByImprovement.get(String(row._id));
    (depts && depts.size ? [...depts] : ["Not assigned"]).forEach((dept) =>
      ciCounts.set(dept, (ciCounts.get(dept) || 0) + 1),
    );
  });
  const improvements = [...ciCounts.entries()]
    .map(([department, count]) => ({ department, count }))
    .sort((a, b) => b.count - a.count || a.department.localeCompare(b.department));

  // 3. Incoming inspection pending: INSPECTION-STATUS not Done
  const incomingPending = rowsOf("QA/R/003").filter(
    (row) => norm(designVal(row.items, ["INSPECTION-STATUS"])) !== "DONE",
  ).length;

  // 4. Quality audits pending: AUDIT STATUS not CLOSED; DUE = days open since audit DATE
  const audits = rowsOf("QA/F/005")
    .filter((row) => norm(designVal(row.items, ["AUDIT STATUS"])) !== "CLOSED")
    .map((row) => {
      const items = row.items || [];
      const date = toEpoch(designVal(items, ["DATE"]));
      const daysOpen = date === null ? null : Math.max(0, Math.round((today - startOfDay(date)) / DAY_MS));
      return {
        rowId: row._id,
        department: designVal(items, ["DEPARTMENT"]) || "-",
        nc: Number(designVal(items, ["NC"])) || 0,
        responsible: designVal(items, ["RESPONSIBLE"]) || "-",
        date,
        daysOpen,
        due: daysOpen === null ? "-" : `${daysOpen} day${plural(daysOpen)} open`,
      };
    })
    .sort((a, b) => (b.daysOpen ?? -1) - (a.daysOpen ?? -1));

  // 5. Instruments pending: calibration DUE already passed or within the next 10 days
  const DUE_SOON_DAYS = 10;
  let instrumentsOverdue = 0;
  let instrumentsDueSoon = 0;
  rowsOf("QA/R/002A").forEach((row) => {
    const due = toEpoch(designVal(row.items, ["DUE"]) || designVal(row.items, ["DATE"]));
    if (due === null) return;
    const d = Math.round((startOfDay(due) - today) / DAY_MS);
    if (d < 0) instrumentsOverdue += 1;
    else if (d <= DUE_SOON_DAYS) instrumentsDueSoon += 1;
  });

  // 6. Certificate renewal pending: latest EXPIRY DATE (renewal records) overdue or within 30 days
  const EXPIRY_KEYS = ["EXPIRY DATE", "EXPIRY", "VALID TILL", "VALID UPTO", "DUE DATE", "DUE"];
  const latestExpiry = new Map();
  rowsOf("QA/R/011A").forEach((d) => {
    if (!d.rowDataId) return;
    const exp =
      toEpoch(designVal(d.items, EXPIRY_KEYS)) ??
      toEpoch(designVal(d.items, ["NEXT RENEVAL", "NEXT RENEWAL"]));
    if (exp === null) return;
    const k = String(d.rowDataId);
    if (!latestExpiry.has(k) || exp > latestExpiry.get(k)) latestExpiry.set(k, exp);
  });
  let certificatesDue = 0;
  let certificatesOverdue = 0;
  rowsOf("QA/R/011").forEach((row) => {
    const exp =
      latestExpiry.get(String(row._id)) ??
      toEpoch(designVal(row.items, EXPIRY_KEYS)) ??
      toEpoch(designVal(row.items, ["NEXT RENEVAL", "NEXT RENEWAL"]));
    if (exp === null) return;
    const d = Math.ceil((exp - Date.now()) / DAY_MS);
    if (d <= 30) certificatesDue += 1;
    if (d < 0) certificatesOverdue += 1;
  });

  // 7. Process Control Plan pending: products whose number of revisions (Product List REV NO
  //    entries) does not match the number of Process Control Plan entries made for that product
  const pcpCountByProduct = new Map();
  rowsOf("QA/R/009").forEach((r) => {
    if (!r.rowDataId) return;
    const k = String(r.rowDataId);
    pcpCountByProduct.set(k, (pcpCountByProduct.get(k) || 0) + 1);
  });
  const pcpPendingRows = rowsOf("DD/R/001")
    .map((row) => {
      const rev = (row.items || []).find((i) => norm(i.key) === "REV NO")?.value;
      const revisions = Array.isArray(rev)
        ? rev.filter((v) => String(v).trim() !== "").length
        : String(rev ?? "").trim()
          ? 1
          : 0;
      const pcpEntries = pcpCountByProduct.get(String(row._id)) || 0;
      return {
        rowId: row._id,
        partNo: designVal(row.items, ["PART NO", "PART-NO"]) || "-",
        partName: designVal(row.items, ["PART NAME", "PART-NAME"]) || "-",
        revisions,
        pcpEntries,
        missing: revisions - pcpEntries,
      };
    })
    .filter((r) => r.revisions !== r.pcpEntries)
    .sort((a, b) => b.missing - a.missing);

  res.status(200).json({
    success: true,
    data: {
      customerRejection: {
        trendBy,
        trend,
        openComplaints,
        period: periodKey,
        periodOptions,
        overall: {
          failedQty: overallFailed,
          deliveredQty: overallDelivered,
          rate: rate(overallFailed, overallDelivered),
        },
      },
      continuousImprovement: {
        total: ciTotal,
        data: improvements,
        years: [...ciYears].sort((a, b) => b - a),
        filter: { year: ciYear, month: ciMonth },
      },
      incomingInspection: { pendingCount: incomingPending },
      qualityAudits: { pendingCount: audits.length, rows: audits },
      instruments: {
        pendingCount: instrumentsOverdue + instrumentsDueSoon,
        overdue: instrumentsOverdue,
        dueSoon: instrumentsDueSoon,
        dueSoonDays: DUE_SOON_DAYS,
      },
      certificates: { pendingCount: certificatesDue, overdue: certificatesOverdue },
      processControlPlan: { pendingCount: pcpPendingRows.length, rows: pcpPendingRows },
    },
  });
});

// HR Department Dashboard (single call for the whole HR dashboard)
// GET /hr/dashboard?department=&groupBy=day|month|year&startDate=&endDate=&safetyMonth=YYYY-MM
//                  &fiveSYear=YYYY&fiveSMonth=1-12
const HR_DEPARTMENTS = [
  "DESIGN", "MANUFACTURING", "QUALITY", "PURCHASE", "SALES", "STORES", "HR", "MAINTENANCE", "ADMIN",
];
// Employee History uses older names for some departments
const HR_DEPT_ALIASES = {
  PRODUCTION: "MANUFACTURING",
  FINANCE: "ADMIN",
  "HUMAN RESOURCES": "HR",
  STORE: "STORES",
  MAINTAINANCE: "MAINTENANCE",
};
const hrDept = (value) => {
  const v = String(value ?? "").replace(/\s+/g, " ").trim().toUpperCase();
  return HR_DEPT_ALIASES[v] || v;
};

exports.getHrDepartmentDashboard = catchAsyncErrors(async (req, res, next) => {
  const department = hrDept(req.query.department);
  const deptFilter = HR_DEPARTMENTS.includes(department) ? department : "";
  // Attendance has its own department filter (falls back to `department`)
  const attendanceDept =
    req.query.attendanceDepartment !== undefined ? hrDept(req.query.attendanceDepartment) : department;
  const attDeptFilter = HR_DEPARTMENTS.includes(attendanceDept) ? attendanceDept : "";
  const groupBy = ["day", "month", "year"].includes(req.query.groupBy) ? req.query.groupBy : "month";
  const startDate = toEpoch(req.query.startDate);
  const endDate = toEpoch(req.query.endDate);
  const now = new Date();
  const today = startOfDay(now.getTime());

  const ids = ["HR/R/001", "HR/R/002", "HR/R/007", "HR/R/008", "HR/R/010"];
  const processes = await Process.find({ processId: { $in: ids } })
    .select("processId data")
    .lean();
  const byId = Object.fromEntries(processes.map((p) => [p.processId, p]));
  const rowsOf = (id) => byId[id]?.data || [];
  const num = (v) => {
    const n = parseFloat(String(v ?? "").replace("%", ""));
    return Number.isFinite(n) ? n : null;
  };

  // 1. Employee strength: active employees (STATUS not INACTIVE and no relieving date)
  const employees = rowsOf("HR/R/001").map((row) => {
    const status = String(designVal(row.items, ["STATUS"]) || "").trim().toUpperCase();
    const relieved = String(designVal(row.items, ["DATE OF RELELIVING", "DATE OF RELIEVING"]) || "").trim();
    return {
      dept: hrDept(designVal(row.items, ["DEPARTMENT"])),
      active: status ? status !== "INACTIVE" : relieved === "",
    };
  });
  const activeByDept = {};
  employees.forEach((e) => {
    if (e.active) activeByDept[e.dept || "NOT ASSIGNED"] = (activeByDept[e.dept || "NOT ASSIGNED"] || 0) + 1;
  });
  const employeeCount = deptFilter
    ? activeByDept[deptFilter] || 0
    : Object.values(activeByDept).reduce((s, n) => s + n, 0);

  // Standard overhead: the Overhead row whose FROM–TO covers today (latest FROM wins);
  // if none covers today, the latest row that has already started.
  const overheadRows = rowsOf("HR/R/010")
    .map((row) => ({
      from: toEpoch(designVal(row.items, ["FROM"])),
      to: toEpoch(designVal(row.items, ["TO"])),
      values: Object.fromEntries(HR_DEPARTMENTS.map((d) => [d, num(designVal(row.items, [d])) || 0])),
    }))
    .filter((r) => r.from !== null);
  const covering = overheadRows
    .filter((r) => r.from <= now.getTime() && (r.to === null || r.to + DAY_MS > now.getTime()))
    .sort((a, b) => b.from - a.from)[0];
  const started = overheadRows.filter((r) => r.from <= now.getTime()).sort((a, b) => b.from - a.from)[0];
  const overhead = covering || started || null;
  const standardOverhead = overhead
    ? deptFilter
      ? overhead.values[deptFilter] || 0
      : Object.values(overhead.values).reduce((s, n) => s + n, 0)
    : null;

  // 2. Attendance trend (Attendance Register: DATE, DEPARTMENT, TOTAL EMPLOYEES, PRESENT)
  const attBuckets = new Map();
  let attTotal = 0;
  let attPresent = 0;
  rowsOf("HR/R/002").forEach((row) => {
    const date = toEpoch(designVal(row.items, ["DATE"]));
    if (date === null) return;
    if (startDate !== null && date < startDate) return;
    if (endDate !== null && date > endDate) return;
    if (attDeptFilter && hrDept(designVal(row.items, ["DEPARTMENT"])) !== attDeptFilter) return;
    const total = num(designVal(row.items, ["TOTAL EMPLOYEES"])) || 0;
    const present = Math.min(num(designVal(row.items, ["PRESENT"])) || 0, total || Infinity);
    const { key, label } = periodOf(date, groupBy);
    const b = attBuckets.get(key) || { key, period: label, total: 0, present: 0 };
    b.total += total;
    b.present += present;
    attBuckets.set(key, b);
    attTotal += total;
    attPresent += present;
  });
  const attendanceTrend = [...attBuckets.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((b) => ({ ...b, rate: b.total ? Number(((b.present / b.total) * 100).toFixed(1)) : null }));

  // 3. Safety calendar for one month (Safety Follow Ups: DATE, PPE FOLLOWS, NEAR MISS, IMPROVEMENTS, REMARK)
  const [sy, sm] = String(req.query.safetyMonth || "").split("-").map(Number);
  const safetyYear = sy && sm ? sy : now.getFullYear();
  const safetyMonthIdx = sy && sm ? sm - 1 : now.getMonth();
  const daysInMonth = new Date(safetyYear, safetyMonthIdx + 1, 0).getDate();
  const dayMap = new Map();
  const safetyMonths = new Set();
  rowsOf("HR/R/008").forEach((row) => {
    const date = toEpoch(designVal(row.items, ["DATE"]));
    if (date === null) return;
    const d = new Date(date);
    safetyMonths.add(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}`);
    if (d.getFullYear() !== safetyYear || d.getMonth() !== safetyMonthIdx) return;
    const day = d.getDate();
    const entry = dayMap.get(day) || { ppe: null, nearMiss: 0, improvements: 0, remarks: [] };
    const ppe = num(designVal(row.items, ["PPE FOLLOWS"]));
    if (ppe !== null) entry.ppe = entry.ppe === null ? ppe : Math.min(entry.ppe, ppe); // worst of the day
    entry.nearMiss += num(designVal(row.items, ["NEAR MISS"])) || 0;
    entry.improvements += num(designVal(row.items, ["IMPROVEMENTS"])) || 0;
    const remark = String(designVal(row.items, ["REMARK", "REMARKS"]) || "").trim();
    if (remark) entry.remarks.push(remark);
    dayMap.set(day, entry);
  });
  const safetyDays = Array.from({ length: daysInMonth }, (_, i) => {
    const day = i + 1;
    const e = dayMap.get(day);
    if (!e) return { day, status: "none" };
    const status = e.nearMiss > 0 ? "nearMiss" : e.ppe === null || e.ppe < 100 ? "ppe" : "safe";
    return { day, status, ppe: e.ppe, nearMiss: e.nearMiss, improvements: e.improvements, remark: e.remarks.join("; ") };
  });
  const recordedDays = safetyDays.filter((d) => d.status !== "none").length;
  const safeDays = safetyDays.filter((d) => d.status === "safe").length;
  safetyMonths.add(`${now.getFullYear()}-${pad2(now.getMonth() + 1)}`);

  // 4. 5S scores (5s: 5S, DATE, one 0–5 rating per department) — average per department, target 5
  const fiveSYear = Number(req.query.fiveSYear) || null;
  const fiveSMonth = Number(req.query.fiveSMonth) || null;
  const FIVE_S_TARGET = 5;
  const scoreSums = {};
  const scoreCounts = {};
  const fiveSYears = new Set();
  rowsOf("HR/R/007").forEach((row) => {
    const date = toEpoch(designVal(row.items, ["DATE"]));
    if (date !== null) fiveSYears.add(new Date(date).getFullYear());
    if (fiveSYear || fiveSMonth) {
      if (date === null) return;
      const d = new Date(date);
      if (fiveSYear && d.getFullYear() !== fiveSYear) return;
      if (fiveSMonth && d.getMonth() + 1 !== fiveSMonth) return;
    }
    HR_DEPARTMENTS.forEach((dept) => {
      const v = num(designVal(row.items, [dept]));
      if (v === null) return;
      scoreSums[dept] = (scoreSums[dept] || 0) + v;
      scoreCounts[dept] = (scoreCounts[dept] || 0) + 1;
    });
  });
  const fiveS = HR_DEPARTMENTS.filter((d) => scoreCounts[d]).map((dept) => ({
    department: dept,
    score: Number((scoreSums[dept] / scoreCounts[dept]).toFixed(2)),
    target: FIVE_S_TARGET,
  }));
  const fiveSAvg = fiveS.length ? fiveS.reduce((s, r) => s + r.score, 0) / fiveS.length : null;

  res.status(200).json({
    success: true,
    data: {
      departments: HR_DEPARTMENTS,
      department: deptFilter,
      employeeStrength: {
        employeeCount,
        standardOverhead,
        overheadPeriod: overhead ? { from: overhead.from, to: overhead.to } : null,
        byDepartment: activeByDept,
      },
      attendance: {
        department: attDeptFilter,
        groupBy,
        rate: attTotal ? Number(((attPresent / attTotal) * 100).toFixed(1)) : null,
        present: attPresent,
        total: attTotal,
        trend: attendanceTrend,
      },
      safety: {
        month: `${safetyYear}-${pad2(safetyMonthIdx + 1)}`,
        months: [...safetyMonths].sort().reverse(),
        days: safetyDays,
        recordedDays,
        safeDays,
        safePct: recordedDays ? Number(((safeDays / recordedDays) * 100).toFixed(1)) : null,
      },
      fiveS: {
        target: FIVE_S_TARGET,
        data: fiveS,
        averageScore: fiveSAvg === null ? null : Number(fiveSAvg.toFixed(2)),
        pct: fiveSAvg === null ? null : Number(((fiveSAvg / FIVE_S_TARGET) * 100).toFixed(1)),
        years: [...fiveSYears].sort((a, b) => b - a),
        filter: { year: fiveSYear, month: fiveSMonth },
      },
    },
  });
});

// Store Department Dashboard
const stockRowView = (row) => {
  const items = row.items || [];
  const num = (keys) => Number(designVal(items, keys)) || 0;
  return {
    rowId: row._id,
    itemCategory: designVal(items, ["ITEM CATEGORY"]) || "",
    itemCode: designVal(items, ["ITEM CODE"]) || "",
    itemName: designVal(items, ["ITEM NAME"]) || "",
    in: num(["IN"]),
    out: num(["OUT"]),
    reject: num(["REJECT"]),
    stock: num(["STOCK"]),
  };
};
const isFinishedGood = (category) => {
  // Accepts FINISHED GOOD(S) and the common misspelling FINSIHED GOOD(S)
  const c = String(category || "").replace(/\s+/g, " ").trim().toUpperCase();
  return /^(FINISHED|FINSIHED) GOODS?$/.test(c) || c === "FG";
};

// GET /store/dashboard → finished-goods stock table
exports.getStoreDashboard = catchAsyncErrors(async (req, res, next) => {
  const stockProcess = await Process.findOne({ processId: "ST/R/006" })
    .select("data")
    .lean();
  const rows = (stockProcess?.data || [])
    .map(stockRowView)
    .filter((r) => isFinishedGood(r.itemCategory))
    .sort((a, b) => a.itemCode.localeCompare(b.itemCode));

  res.status(200).json({
    success: true,
    data: {
      finishedGoods: {
        itemCount: rows.length,
        totalStock: rows.reduce((s, r) => s + r.stock, 0),
        rows,
      },
    },
  });
});

// GET /store/stock-search?q=<item code or name>&limit=50
// Searches ALL stock items (any category); matches ITEM CODE or ITEM NAME containing q.
exports.searchStoreStock = catchAsyncErrors(async (req, res, next) => {
  const q = String(req.query.q || "").replace(/\s+/g, " ").trim().toUpperCase();
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  if (!q) {
    return res.status(200).json({ success: true, data: { query: "", total: 0, rows: [] } });
  }

  const stockProcess = await Process.findOne({ processId: "ST/R/006" })
    .select("data")
    .lean();
  const matches = (stockProcess?.data || [])
    .map(stockRowView)
    .filter(
      (r) =>
        r.itemCode.toUpperCase().includes(q) || r.itemName.toUpperCase().includes(q),
    )
    // Exact code/name matches first, then codes that start with the text, then the rest
    .sort((a, b) => {
      const rank = (r) =>
        r.itemCode.toUpperCase() === q || r.itemName.toUpperCase() === q
          ? 0
          : r.itemCode.toUpperCase().startsWith(q) || r.itemName.toUpperCase().startsWith(q)
            ? 1
            : 2;
      return rank(a) - rank(b) || a.itemCode.localeCompare(b.itemCode);
    });

  res.status(200).json({
    success: true,
    data: {
      query: req.query.q,
      total: matches.length,
      totalStock: matches.reduce((s, r) => s + r.stock, 0),
      rows: matches.slice(0, limit),
    },
  });
});

// 4. OEE Dashboard
exports.getOEEDashboard = catchAsyncErrors(async (req, res, next) => {
  const productionReportProcess = await Process.findOne({
    processId: "MR/R/002",
  });

  if (!productionReportProcess) {
    return next(
      new ErrorHandler("Production Report Process (MR/R/002) not found", 404),
    );
  }

  const { startDate, endDate } = req.query;

  const now = new Date();
  const effectiveStart = startDate
    ? Number(startDate)
    : new Date(now.getFullYear(), 0, 1).getTime();
  const effectiveEnd = endDate
    ? Number(endDate)
    : new Date(now.getFullYear() + 1, 11, 31, 23, 59, 59, 999).getTime();

  const filteredData = productionReportProcess.data.filter((row) => {
    const dateItem = row.items.find((i) => i.key === "DATE");
    if (!dateItem || !dateItem.value) return false;
    const epochMs = Number(dateItem.value);
    return epochMs >= effectiveStart && epochMs <= effectiveEnd;
  });

  let totalOEE = 0;
  let oeeCount = 0;

  filteredData.forEach((row) => {
    const oeeItem = row.items.find((i) => i.key === "OEE");
    if (oeeItem && oeeItem.value) {
      // Handle potential % sign and ensure it's a number
      const oeeValue = parseFloat(String(oeeItem.value).replace("%", ""));
      if (!isNaN(oeeValue)) {
        totalOEE += oeeValue;
        oeeCount++;
      }
    }
  });

  const averageOEE = oeeCount > 0 ? totalOEE / oeeCount : 0;

  res.status(200).json({
    success: true,
    data: {
      totalRecords: oeeCount,
      averageOEE: Number(averageOEE.toFixed(2)),
      remaining: Number((100 - averageOEE).toFixed(2)),
    },
  });
});

// 5. Production Report Dashboard
exports.getDashboardProductReport = catchAsyncErrors(async (req, res, next) => {
  const productionReportProcess = await Process.findOne({
    processId: "MR/R/002",
  });

  if (!productionReportProcess) {
    return next(
      new ErrorHandler("Production Report Process (MR/R/002) not found", 404),
    );
  }

  const { startDate, endDate } = req.query;

  const now = new Date();
  const effectiveStart = startDate
    ? Number(startDate)
    : new Date(now.getFullYear(), 0, 1).getTime();
  const effectiveEnd = endDate
    ? Number(endDate)
    : new Date(now.getFullYear() + 1, 11, 31, 23, 59, 59, 999).getTime();

  const filteredData = productionReportProcess.data.filter((row) => {
    const dateItem = row.items.find((i) => i.key === "DATE");
    if (!dateItem || !dateItem.value) return false;
    const epochMs = Number(dateItem.value);
    return epochMs >= effectiveStart && epochMs <= effectiveEnd;
  });

  const dateMap = {}; // { "YYYY-MM-DD": { totalOEE: 0, count: 0 } }

  filteredData.forEach((row) => {
    const dateItem = row.items.find((i) => i.key === "DATE");
    const oeeItem = row.items.find((i) => i.key === "OEE");

    if (dateItem && dateItem.value && oeeItem && oeeItem.value) {
      const epochMs = Number(dateItem.value);
      const dateKey = new Date(epochMs).toISOString().split("T")[0];
      const oeeValue = parseFloat(String(oeeItem.value).replace("%", ""));

      if (!isNaN(oeeValue)) {
        if (!dateMap[dateKey]) {
          dateMap[dateKey] = { totalOEE: 0, count: 0 };
        }
        dateMap[dateKey].totalOEE += oeeValue;
        dateMap[dateKey].count++;
      }
    }
  });

  const chartData = Object.entries(dateMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, stats]) => {
      const avgOEE = Number((stats.totalOEE / stats.count).toFixed(2));
      let color = "blue";
      if (avgOEE < 45) {
        color = "red";
      } else if (avgOEE > 65) {
        color = "green";
      }

      return {
        date,
        oee: avgOEE,
        color,
      };
    });

  res.status(200).json({
    success: true,
    data: chartData,
  });
});

// 6. Inhouse Dashboard
exports.getInhouseDashboard = catchAsyncErrors(async (req, res, next) => {
  const [
    productionReportProcess,
    rejectReportProcess,
    reworkReportProcess,
    actionTakenProcess,
  ] = await Promise.all([
    Process.findOne({ processId: "MR/R/002" }),
    Process.findOne({ processId: "MR/R/003" }),
    Process.findOne({ processId: "MR/R/003A" }),
    Process.findOne({ processId: "MR/R/003B" }),
  ]);

  if (
    !productionReportProcess ||
    !rejectReportProcess ||
    !reworkReportProcess
  ) {
    return next(
      new ErrorHandler("Required processes for dashboard not found", 404),
    );
  }

  const { startDate, endDate } = req.query;
  const now = new Date();
  const effectiveStart = startDate
    ? Number(startDate)
    : new Date(now.getFullYear(), 0, 1).getTime();
  const effectiveEnd = endDate
    ? Number(endDate)
    : new Date(now.getFullYear() + 1, 11, 31, 23, 59, 59, 999).getTime();

  // 1. In House Rejection Ratio logic
  const filteredProduction = productionReportProcess.data.filter((row) => {
    const dateItem = row.items.find((i) => i.key === "DATE");
    if (!dateItem || !dateItem.value) return false;
    const epochMs = Number(dateItem.value);
    return epochMs >= effectiveStart && epochMs <= effectiveEnd;
  });

  const filteredRejection = rejectReportProcess.data.filter((row) => {
    const dateItem = row.items.find((i) => i.key === "DATE");
    if (!dateItem || !dateItem.value) return false;
    const epochMs = Number(dateItem.value);
    return epochMs >= effectiveStart && epochMs <= effectiveEnd;
  });

  const sumOfRejectQty = filteredRejection.reduce((acc, row) => {
    // Referring to image: "REJECTION REPORT SUM OF ACTUAL QTY"
    // Referring to snippet: "REJECT QTY"
    const val =
      row.items.find((item) => item.key === "ACTUAL QTY") ||
      row.items.find((item) => item.key === "REJECT QTY");
    return acc + (Number(val?.value) || 0);
  }, 0);

  const sumOfActualQtyP = filteredProduction.reduce((acc, row) => {
    const val = row.items.find((item) => item.key === "ACTUAL");
    return acc + (Number(val?.value) || 0);
  }, 0);

  const rejectionRatio =
    sumOfActualQtyP > 0 ? (sumOfRejectQty / sumOfActualQtyP) * 100 : 0;

  // 2. Action Pending logic
  const openActionPlans = actionTakenProcess
    ? actionTakenProcess.data.filter(
        (row) =>
          row.items
            .find((item) => item.key === "ACTION PLAN STATUS")
            ?.value?.toLowerCase() === "open",
      )
    : [];

  const actionPendingRows = rejectReportProcess.data.filter((row) =>
    openActionPlans.some(
      (ap) => ap.rowDataId?.toString() === row._id.toString(),
    ),
  );

  const actionPendingSum = actionPendingRows.reduce((acc, row) => {
    const val =
      row.items.find((item) => item.key === "ACTUAL QTY") ||
      row.items.find((item) => item.key === "REJECT QTY");
    return acc + (Number(val?.value) || 0);
  }, 0);

  // 3. Rework Pending logic
  const reworkPendingRows = reworkReportProcess.data.filter(
    (row) =>
      row.items
        .find((item) => item.key === "RR STATUS")
        ?.value?.toLowerCase() === "open",
  );

  const reworkPendingSum = reworkPendingRows.reduce((acc, row) => {
    const val = row.items.find((item) => item.key === "REWORK QTY");
    return acc + (Number(val?.value) || 0);
  }, 0);

  res.status(200).json({
    success: true,
    data: {
      rejectionRatio: Number(rejectionRatio.toFixed(2)),
      actionPending: actionPendingSum,
      reworkPending: reworkPendingSum,
    },
  });
});

// 7. Customer Quality Dashboard
exports.getCustomerQualityDashboard = catchAsyncErrors(
  async (req, res, next) => {
    const [compliantProcess, orderListProcess] = await Promise.all([
      Process.findOne({ processId: "QA/R/007" }),
      Process.findOne({ processId: "MS/R/006" }),
    ]);

    if (!compliantProcess || !orderListProcess) {
      return next(
        new ErrorHandler("Required processes for dashboard not found", 404),
      );
    }

    const { startDate, endDate } = req.query;
    const now = new Date();
    const effectiveStart = startDate
      ? Number(startDate)
      : new Date(now.getFullYear(), 0, 1).getTime();
    const effectiveEnd = endDate
      ? Number(endDate)
      : new Date(now.getFullYear() + 1, 11, 31, 23, 59, 59, 999).getTime();

    // 1. Customer Rejection Rate Logic
    const filteredCompliant = compliantProcess.data.filter((row) => {
      const dateItem = row.items.find((i) => i.key === "DATE");
      if (!dateItem || !dateItem.value) return false;
      const epochMs = Number(dateItem.value);
      return epochMs >= effectiveStart && epochMs <= effectiveEnd;
    });

    const filteredOrders = orderListProcess.data.filter((row) => {
      const dateItem = row.items.find((i) => i.key === "DATE");
      if (!dateItem || !dateItem.value) return false;
      const epochMs = Number(dateItem.value);
      return epochMs >= effectiveStart && epochMs <= effectiveEnd;
    });

    const totalFailedQty = filteredCompliant.reduce((acc, row) => {
      const val = row.items.find((item) => item.key === "FAILED QTY");
      return acc + (Number(val?.value) || 0);
    }, 0);

    const totalOrderQty = filteredOrders.reduce((acc, row) => {
      const val = row.items.find((item) => item.key === "QTY");
      return acc + (Number(val?.value) || 0);
    }, 0);

    const rejectionRate =
      totalOrderQty > 0 ? (totalFailedQty / totalOrderQty) * 100 : 0;

    // 2. Action Pending Logic (Unclosed complaints)
    const actionPendingCount = compliantProcess.data.filter((row) => {
      const status = row.items.find((i) => i.key === "CCR STATUS")?.value;
      return status?.toLowerCase() !== "closed";
    }).length;

    res.status(200).json({
      success: true,
      data: {
        rejectionRate: Number(rejectionRate.toFixed(2)),
        actionPending: actionPendingCount,
      },
    });
  },
);

// 8. Incoming Inspection Dashboard
exports.getIncomingInspectionDashboard = catchAsyncErrors(
  async (req, res, next) => {
    const incomingInspectionProcess = await Process.findOne({
      processId: "QA/R/003",
    });

    if (!incomingInspectionProcess) {
      return next(
        new ErrorHandler(
          "Incoming Inspection Process (QA/R/003) not found",
          404,
        ),
      );
    }
    const pendingCount = incomingInspectionProcess.data.filter((row) => {
      const status = row.items.find(
        (i) => i.key === "INSPECTION-STATUS",
      )?.value;
      return status?.toLowerCase() !== "done";
    }).length;

    res.status(200).json({
      success: true,
      data: {
        pendingCount: pendingCount,
      },
    });
  },
);

// 9. Quality audit.
exports.getQualityAuditsDashboard = catchAsyncErrors(async (req, res, next) => {
  // Using QA/F/005 as per the provided JSON snippet for Quality Audits
  const qualityAuditsProcess = await Process.findOne({ processId: "QA/F/005" });

  if (!qualityAuditsProcess) {
    return next(
      new ErrorHandler("Quality Audits Process (QA/F/005) not found", 404),
    );
  }

  const today = new Date();

  // Filter unclosed audits (AUDIT STATUS !== "Closed")
  const unclosedAudits = qualityAuditsProcess.data.filter((row) => {
    const status = row.items.find((i) => i.key === "AUDIT STATUS")?.value;
    return status?.toLowerCase() !== "closed";
  });

  // Count closed audits
  const closedAuditsCount = qualityAuditsProcess.data.filter((row) => {
    const status = row.items.find((i) => i.key === "AUDIT STATUS")?.value;
    return status?.toLowerCase() === "closed";
  }).length;

  // Requirement: Left Box (Audit Pending) - Format: Date
  // We'll return dates of pending audits.
  const pendingDates = unclosedAudits
    .map((row) => {
      const dateItem = row.items.find((i) => i.key === "DATE");
      return dateItem ? dateItem.value : null;
    })
    .filter(Boolean);

  // Requirement: Right Table (Quality Audit Pendings)
  // Headers: DEPARTMENT, NO OF NC, RESPONSIBLE, DUE (Today - Date)
  const pendingTableData = unclosedAudits.map((row) => {
    const items = row.items;
    const dateVal = items.find((i) => i.key === "DATE")?.value;
    const department =
      items.find((i) => i.key === "DEPARTMENT")?.value || "N/A";
    const ncValue = items.find((i) => i.key === "NC")?.value || "0";
    const responsible =
      items.find((i) => i.key === "RESPONSIBLE")?.value || "N/A";

    let due = "N/A";
    if (dateVal) {
      const auditDate = new Date(Number(dateVal));
      if (!isNaN(auditDate.getTime())) {
        const diffTime = today - auditDate;
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        due = diffDays > 0 ? `${diffDays} days` : "Today";
      }
    }

    return {
      department,
      noOfNC: Number(ncValue),
      responsible,
      due,
      date: dateVal, // Epoch as string
    };
  });

  // Requirement: View Department Wise (Sorting by Department)
  pendingTableData.sort((a, b) => a.department.localeCompare(b.department));

  res.status(200).json({
    success: true,
    data: {
      totalPending: unclosedAudits.length,
      totalClosed: closedAuditsCount,
      pendingDates: pendingDates, // For the "Format: Date" box
      table: pendingTableData, // For the "Format: Table" box
    },
  });
});

// 10. Continuous Improvement
exports.getContinuousImprovementDashboard = catchAsyncErrors(
  async (req, res, next) => {
    // Using MR/R/005 as per the provided JSON snippet for Continuous Improvement
    const continuousImprovementProcess = await Process.findOne({
      processId: "MR/R/005",
    });

    if (!continuousImprovementProcess) {
      return next(
        new ErrorHandler(
          "Continuous Improvement Process (MR/R/005) not found",
          404,
        ),
      );
    }

    const { startDate, endDate } = req.query;

    let filteredData = continuousImprovementProcess.data;

    // Filter by date if both startDate and endDate are provided
    if (startDate && endDate) {
      const start = Number(startDate);
      const end = Number(endDate);

      filteredData = filteredData.filter((row) => {
        const dateItem = row.items.find((i) => i.key === "DATE");
        if (!dateItem || !dateItem.value) return false;
        const epochMs = Number(dateItem.value);
        return epochMs >= start && epochMs <= end;
      });
    }

    res.status(200).json({
      success: true,
      data: {
        improvementCount: filteredData.length,
      },
    });
  },
);

// 11. Employee Overhead Dashboard
exports.getEmployeeOverheadDashboard = catchAsyncErrors(
  async (req, res, next) => {
    const employeeHistoryProcess = await Process.findOne({
      processId: "HR/R/001",
    });

    if (!employeeHistoryProcess) {
      return next(
        new ErrorHandler("Employee History Process (HR/R/001) not found", 404),
      );
    }

    const { department } = req.query;

    // The column is spelled "DATE OF RELELIVING" in the live schema; accept the correct spelling too
    const RELIEVING_KEYS = ["DATE OF RELELIVING", "DATE OF RELIEVING"];
    const relievingOf = (row) => {
      const v = row.items.find((i) => RELIEVING_KEYS.includes(String(i.key || "").trim().toUpperCase()))?.value;
      return v === undefined || v === null ? "" : String(v).trim();
    };
    const epochField = (row, key) => {
      const n = Number(row.items.find((i) => i.key === key)?.value);
      return Number.isFinite(n) && n > 0 ? n : null;
    };

    let employees = employeeHistoryProcess.data;
    if (department) {
      employees = employees.filter((row) => {
        const dept = row.items.find((i) => i.key === "DEPARTMENT")?.value;
        return dept?.toLowerCase() === department.toLowerCase();
      });
    }

    // Active = STATUS is not INACTIVE (when STATUS is filled), otherwise no relieving date
    const isActive = (row) => {
      const status = String(row.items.find((i) => String(i.key || "").trim().toUpperCase() === "STATUS")?.value || "")
        .trim()
        .toUpperCase();
      return status ? status !== "INACTIVE" : relievingOf(row) === "";
    };

    // Actual OverHead = Count of active employees
    const activeEmployees = employees.filter(isActive);

    // 12-month retention: of the people on staff 12 months ago, how many are still with us.
    // On staff 12 months ago = joined on/before that date and not relieved before it.
    const yearAgo = new Date();
    yearAgo.setFullYear(yearAgo.getFullYear() - 1);
    const yearAgoEpoch = yearAgo.getTime();
    const onStaffYearAgo = employees.filter((row) => {
      const joined = epochField(row, "DATE OF JOINING");
      if (joined === null || joined > yearAgoEpoch) return false;
      const relieved = relievingOf(row);
      const relievedEpoch = Number(relieved);
      if (relieved === "") return true;
      // Relieving date that is not a valid date: treat as left (cannot place it in time)
      return Number.isFinite(relievedEpoch) && relievedEpoch > yearAgoEpoch;
    });
    const stillHere = onStaffYearAgo.filter(isActive);
    const retentionRate = onStaffYearAgo.length
      ? Number(((stillHere.length / onStaffYearAgo.length) * 100).toFixed(1))
      : null;

    res.status(200).json({
      success: true,
      data: {
        actualOverHead: activeEmployees.length,
        retentionRate,
        retentionBase: onStaffYearAgo.length,
        leftInLast12Months: onStaffYearAgo.length - stillHere.length,
      },
    });
  },
);

// 12. Employee Attendance % (Department Wise % for Pie Chart)
exports.getEmployeeAttendanceDashboard = catchAsyncErrors(
  async (req, res, next) => {
    const employeeHistoryProcess = await Process.findOne({
      processId: "HR/R/001",
    });

    if (!employeeHistoryProcess) {
      return next(
        new ErrorHandler("Employee History Process (HR/R/001) not found", 404),
      );
    }

    const { startDate, endDate } = req.query;

    // Filter active employees within the date range
    const now = Date.now();
    const effectiveStart = startDate ? Number(startDate) : 0;
    const effectiveEnd = endDate ? Number(endDate) : now;

    let activeDuringRange = employeeHistoryProcess.data.filter((row) => {
      const joinValue = row.items.find(
        (i) => i.key === "DATE OF JOINING",
      )?.value;
      const reliefValue = row.items.find((i) =>
        ["DATE OF RELELIVING", "DATE OF RELIEVING"].includes(
          String(i.key || "").trim().toUpperCase(),
        ),
      )?.value;

      const joinEpoch = Number(joinValue);
      const reliefEpoch = reliefValue ? Number(reliefValue) : Infinity;

      // Check if employee tenure overlaps with the range
      return joinEpoch <= effectiveEnd && reliefEpoch >= effectiveStart;
    });

    // Calculate department distribution
    const departmentStats = {};
    activeDuringRange.forEach((row) => {
      const dept =
        row.items.find((i) => i.key === "DEPARTMENT")?.value || "Unassigned";
      departmentStats[dept] = (departmentStats[dept] || 0) + 1;
    });

    const total = activeDuringRange.length;
    const chartData = Object.entries(departmentStats).map(([label, count]) => {
      const percentage = total > 0 ? (count / total) * 100 : 0;
      return {
        label,
        value: count,
        percentage: Number(percentage.toFixed(2)),
      };
    });

    res.status(200).json({
      success: true,
      data: chartData,
    });
  },
);

// 13. Procurement Register
exports.getProcurementRegisterDashboard = catchAsyncErrors(
  async (req, res, next) => {
    // Using PR/R/003 as per the provided JSON snippet for Procurement Register
    const procurementProcess = await Process.findOne({ processId: "PR/R/003" });

    if (!procurementProcess) {
      return next(
        new ErrorHandler("Procurement Process (PR/R/003) not found", 404),
      );
    }

    const { startDate, endDate } = req.query;

    // 1. Initial status filter: PR STATUS === "PENDING"
    let filteredData = procurementProcess.data.filter((row) => {
      const status = row.items.find((i) => i.key === "PR STATUS")?.value;
      return status?.toUpperCase() !== "CLOSED";
    });

    // 2. Filter by date if both startDate and endDate are provided
    if (startDate && endDate) {
      const start = Number(startDate);
      const end = Number(endDate);

      filteredData = filteredData.filter((row) => {
        const dateItem = row.items.find((i) => i.key === "DATE");
        if (!dateItem || !dateItem.value) return false;
        const epochMs = Number(dateItem.value);
        return epochMs >= start && epochMs <= end;
      });
    }

    res.status(200).json({
      success: true,
      data: {
        totalPending: filteredData.length,
        pendingRecords: filteredData,
      },
    });
  },
);

// 14. Inward Dashboard
exports.getInwardDashboard = catchAsyncErrors(async (req, res, next) => {
  // Using PR/R/003A as per the provided JSON snippet for Inward
  const inwardProcess = await Process.findOne({ processId: "PR/R/003A" });

  if (!inwardProcess) {
    return next(new ErrorHandler("Inward Process (PR/R/003A) not found", 404));
  }

  const { startDate, endDate } = req.query;

  // 1. Initial status filter: PAYMENT === "OPEN"
  let filteredData = inwardProcess.data.filter((row) => {
    const payment = row.items.find((i) => i.key === "PAYMENT")?.value;
    return payment?.toUpperCase() !== "CLOSED";
  });

  // 2. Filter by DELIVERY DATE if both startDate and endDate are provided
  if (startDate && endDate) {
    const start = Number(startDate);
    const end = Number(endDate);

    filteredData = filteredData.filter((row) => {
      const dateItem = row.items.find((i) => i.key === "DELIVERY DATE");
      if (!dateItem || !dateItem.value) return false;
      const epochMs = Number(dateItem.value);
      return epochMs >= start && epochMs <= end;
    });
  }

  res.status(200).json({
    success: true,
    data: {
      totalOpen: filteredData.length,
      openRecords: filteredData,
    },
  });
});

// 15. Sales Dashboard - Customer Count
exports.getSalesCustomerCount = catchAsyncErrors(async (req, res, next) => {
  const customerListProcess = await Process.findOne({ processId: "MS/R/004" });
  if (!customerListProcess) {
    return next(
      new ErrorHandler("Customer List Process (MS/R/004) not found", 404),
    );
  }
  res.status(200).json({
    success: true,
    data: { totalCustomers: customerListProcess.data.length },
  });
});

// 16. Sales Dashboard - Sales Trend
exports.getSalesTrend = catchAsyncErrors(async (req, res, next) => {
  const orderListProcess = await Process.findOne({ processId: "MS/R/006" });
  if (!orderListProcess) {
    return next(
      new ErrorHandler("Order List Process (MS/R/006) not found", 404),
    );
  }
  const { startDate, endDate } = req.query;
  const effectiveStart = startDate ? Number(startDate) : 0;
  const effectiveEnd = endDate ? Number(endDate) : Infinity;

  const salesTrend = {};
  orderListProcess.data.forEach((row) => {
    const dateVal = row.items.find(
      (i) => i.key === "DATE" || i.key === "ORDER DATE",
    )?.value;
    const value = parseFloat(
      row.items.find((i) => i.key === "VALUE")?.value || 0,
    );
    if (dateVal && !isNaN(value)) {
      const date = new Date(Number(dateVal));
      if (date.getTime() >= effectiveStart && date.getTime() <= effectiveEnd) {
        const monthYear = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        salesTrend[monthYear] = (salesTrend[monthYear] || 0) + value;
      }
    }
  });

  res.status(200).json({
    success: true,
    data: Object.entries(salesTrend).map(([month, value]) => ({
      month,
      value,
    })),
  });
});

// 17. Sales Dashboard - Quotation Status
exports.getQuotationStatus = catchAsyncErrors(async (req, res, next) => {
  const quotationListProcess = await Process.findOne({ processId: "MS/R/005" });
  if (!quotationListProcess) {
    return next(
      new ErrorHandler("Quotation List Process (MS/R/005) not found", 404),
    );
  }
  const quotationStatus = {};
  quotationListProcess.data.forEach((row) => {
    const status =
      row.items.find((i) => i.key === "QL STATUS")?.value || "UNKNOWN";
    quotationStatus[status] = (quotationStatus[status] || 0) + 1;
  });
  res.status(200).json({
    success: true,
    data: quotationStatus,
  });
});

// 18. Sales Dashboard - Order Details
exports.getSalesOrderDetails = catchAsyncErrors(async (req, res, next) => {
  const orderListProcess = await Process.findOne({ processId: "MS/R/006" });
  if (!orderListProcess) {
    return next(
      new ErrorHandler("Order List Process (MS/R/006) not found", 404),
    );
  }
  let totalOrderQty = 0;
  let totalPendingQty = 0;
  orderListProcess.data.forEach((row) => {
    const qty = parseFloat(row.items.find((i) => i.key === "QTY")?.value || 0);
    const pendingQty = parseFloat(
      row.items.find((i) => i.key === "PENDING QTY")?.value || 0,
    );
    totalOrderQty += isNaN(qty) ? 0 : qty;
    totalPendingQty += isNaN(pendingQty) ? 0 : pendingQty;
  });
  res.status(200).json({
    success: true,
    data: { totalOrderQty, totalPendingQty },
  });
});

// 19. Sales Dashboard - Payment and Delivery
exports.getSalesPaymentAndDelivery = catchAsyncErrors(
  async (req, res, next) => {
    const docketsProcess = await Process.findOne({ processId: "MS/R/006A" });
    if (!docketsProcess) {
      return next(
        new ErrorHandler("Dockets Process (MS/R/006A) not found", 404),
      );
    }

    let paymentPendingCount = 0;
    let totalLeadTime = 0;
    let leadTimeCount = 0;

    docketsProcess.data.forEach((row) => {
      const payment = row.items.find((i) => i.key === "PAYMENT")?.value;
      if (
        payment &&
        (payment.toUpperCase() === "OPEN" ||
          payment.toUpperCase() === "PENDING")
      ) {
        paymentPendingCount++;
      }

      const orderDateVal = row.items.find((i) => i.key === "ORDER DATE")?.value;
      const deliveryDateVal = row.items.find(
        (i) => i.key === "DELIVERY DATE",
      )?.value;
      if (orderDateVal && deliveryDateVal) {
        const diff =
          (Number(deliveryDateVal) - Number(orderDateVal)) /
          (1000 * 60 * 60 * 24);
        if (diff >= 0) {
          totalLeadTime += diff;
          leadTimeCount++;
        }
      }
    });

    res.status(200).json({
      success: true,
      data: {
        paymentPendingCount,
        averageLeadTime:
          leadTimeCount > 0
            ? Number((totalLeadTime / leadTimeCount).toFixed(1))
            : 0,
      },
    });
  },
);

// 20. Sales Dashboard - Trail Status
exports.getSalesTrailStatus = catchAsyncErrors(async (req, res, next) => {
  const customerTrailProcess = await Process.findOne({ processId: "MS/R/001" });
  if (!customerTrailProcess) {
    return next(
      new ErrorHandler("Customer Trail Process (MS/R/001) not found", 404),
    );
  }
  const trailStatus = {};
  customerTrailProcess.data.forEach((row) => {
    const status =
      row.items.find((i) => i.key.includes("STATUS"))?.value || "UNKNOWN";
    trailStatus[status] = (trailStatus[status] || 0) + 1;
  });
  res.status(200).json({
    success: true,
    data: trailStatus,
  });
});
