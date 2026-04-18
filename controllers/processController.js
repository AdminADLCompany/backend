const mongoose = require("mongoose");

const Process = require("../models/process");
const History = require("../models/history");

const ErrorHandler = require("../utils/errorHandler");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const cloudinary = require("../config/cloudinary");
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
        item.process = (item.key === "PROTO" || item.key === "VALIDATION" || item.key === "MASTER PIECE") ? "red" : "value";
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
      const breakMinutes = Object.values(breakValues).reduce((acc, val) => acc + val, 0);

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

      if (qlStatusItem && quotationItem !== "ORDER") {
        const quotationNo = quotationItem?.value?.trim() || "";
        qlStatusItem.value =
          quotationNo === "" ? "WAITING FOR QUOTE" : "WAITING FOR ORDER";
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
            if (row.rowDataId && row.rowDataId.toString() === rowDataId.toString()) {
              const qty = row.items.find((item) => item.key === "DELIVERY QTY")?.value;
              return sum + Number(qty || 0);
            }
            return sum;
          }, 0);

          // Add current row's delivery qty
          const currentDeliveryQty = Number(items.find((i) => i.key === "DELIVERY QTY")?.value || 0);
          totalDeliveryQty += currentDeliveryQty;

          // current row order qty's PENDING QTY === QTY - total delivery qty.
          const orderQty = Number(orderRow.items.find((item) => item.key === "QTY")?.value || 0);
          const pendingQty = orderQty - totalDeliveryQty;

          const pendingQtyItem = items.find((i) => i.key === "PENDING QTY");
          if (pendingQtyItem) pendingQtyItem.value = String(pendingQty);

          // update orderRow's PENDING QTY
          const orderPendingQtyItem = orderRow.items.find((item) => item.key === "PENDING QTY");
          if (orderPendingQtyItem) {
            orderPendingQtyItem.value = String(pendingQty);
          } else {
            orderRow.items.push({ key: "PENDING QTY", value: String(pendingQty), process: "value" });
          }

          const customerName = orderRow.items.find((item) => item.key === "CUSTOMER NAME")?.value;
          const partNo = orderRow.items.find((item) => item.key === "PART NO")?.value;
          const poNo = orderRow.items.find((item) => item.key === "PO NO")?.value;

          const name = items.find((i) => i.key === "CUSTOMER NAME");
          const part = items.find((i) => i.key === "PART NO");
          const PO = items.find((i) => i.key === "PO NO");

          if (name) name.value = customerName || "";
          if (part) part.value = partNo || "";
          if (PO) PO.value = poNo || "";

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
    }

    else if (process.processId === "DD/R/007") {
      // (QTY RETURNED / QTY SOLD) * 100 calculate this item row and store in the item SUCCESS RATE
      const qtyReturned = items.find((i) => i.key === "QTY RETURNED")?.value;
      const qtySold = items.find((i) => i.key === "QTY SOLD")?.value;
      const successRate = items.find((i) => i.key === "SUCCESS RATE");
      if (successRate)
        successRate.value = String(100 - (Number(qtyReturned) / Number(qtySold) * 100))
    }

    else if (process.processId === "PR/R/003A") {
      const procurmentRegisterProcess = await Process.findOne({
        processId: "PR/R/003",
      });

      if (!procurmentRegisterProcess)
        throw new ErrorHandler("Procurement Register Process (PR/R/003) not found", 404);

      const matchedRow = procurmentRegisterProcess.data.find((itemRow) => {
        return itemRow._id.toString() === rowDataId.toString();
      });

      const vendorName = matchedRow?.items.find((item) => item.key === "VENDOR-NAME")?.value;
      const itemName = matchedRow?.items.find((item) => item.key === "ITEM NAME")?.value;
      const poNo = matchedRow?.items.find((item) => item.key === "PO NO")?.value;

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
      const result = await cloudinary.uploader.upload(file.path, {
        folder: "process_images",
      });
      items[i].value = result.secure_url;
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

    const settings = Number(settingData?.items.find((item) => item.key === "SETTING TIME")?.value ?? 0);

    const end = endRaw < start ? endRaw + 1440 : endRaw;
    const totalTime = end - start;

    // ---- calculate break minutes ----
    const breakValues = calculateBreaks(start, end, sceduledLoss);
    const breakMinutes = Object.values(breakValues).reduce((acc, val) => acc + val, 0);

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
  } 
  
  else if (process.processId === "DD/R/010") {
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
  }

  else if (process.processId === "DD/R/007") {
      // (QTY RETURNED / QTY SOLD) * 100 calculate this item row and store in the item SUCCESS RATE
      const qtyReturned = items.find((i) => i.key === "QTY RETURNED")?.value;
      const qtySold = items.find((i) => i.key === "QTY SOLD")?.value;
      const successRate = items.find((i) => i.key === "SUCCESS RATE");
      if (successRate)
        successRate.value = String(100 - (Number(qtyReturned) / Number(qtySold) * 100));
  }

  else if (process.processId === "MS/R/006A") {
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
            const qty = r.items.find((item) => item.key === "DELIVERY QTY")?.value;
            return sum + Number(qty || 0);
          }
          return sum;
        }, 0);

        // Add current updated delivery qty
        const currentDeliveryQty = Number(items.find((i) => i.key === "DELIVERY QTY")?.value || 0);
        totalDeliveryQty += currentDeliveryQty;

        // current row order qty's PENDING QTY === QTY - total delivery qty
        const orderQty = Number(orderRow.items.find((item) => item.key === "QTY")?.value || 0);
        const pendingQty = orderQty - totalDeliveryQty;

        const pendingQtyItem = items.find((i) => i.key === "PENDING QTY");
        if (pendingQtyItem) pendingQtyItem.value = String(pendingQty);

        // update orderRow's PENDING QTY
        const orderPendingQtyItem = orderRow.items.find((item) => item.key === "PENDING QTY");
        if (orderPendingQtyItem) {
          orderPendingQtyItem.value = String(pendingQty);
        } else {
          orderRow.items.push({ key: "PENDING QTY", value: String(pendingQty), process: "value" });
        }

        const customerName = orderRow.items.find((item) => item.key === "CUSTOMER NAME")?.value;
        const partNo = orderRow.items.find((item) => item.key === "PART NO")?.value;
        const poNo = orderRow.items.find((item) => item.key === "PO NO")?.value;

        const name = items.find((i) => i.key === "CUSTOMER NAME");
        const part = items.find((i) => i.key === "PART NO");
        const PO = items.find((i) => i.key === "PO NO");

        if (name) name.value = customerName || "";
        if (part) part.value = partNo || "";
        if (PO) PO.value = poNo || "";

        orderProcess.markModified("data");
        await orderProcess.save();
      }
    }
  }

  else if (process.processId === "PR/R/003A") {
      const procurmentRegisterProcess = await Process.findOne({
        processId: "PR/R/003",
      });

      if (!procurmentRegisterProcess)
        throw new ErrorHandler("Procurement Register Process (PR/R/003) not found", 404);

      const matchedRow = procurmentRegisterProcess.data.find((itemRow) => {
        return itemRow._id.toString() === row.rowDataId?.toString();
      });

      const vendorName = matchedRow?.items.find((item) => item.key === "VENDOR-NAME")?.value;
      const itemName = matchedRow?.items.find((item) => item.key === "ITEM NAME")?.value;
      const poNo = matchedRow?.items.find((item) => item.key === "PO NO")?.value;

      const name = items.find((i) => i.key === "VENDOR NAME");
      const part = items.find((i) => i.key === "ITEM NAME");
      const PO = items.find((i) => i.key === "PO NO");

      if (name) name.value = vendorName || "";
      if (part) part.value = itemName || "";
      if (PO) PO.value = poNo || "";
    }

  // Update row data
  const previousItems = row.items;
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
    groupOfVendorList.push([
      {
        "VENDOR-NAME": vName,
      },
    ]);
    if (vName) vendorName.add(vName);
  });

  let groupOfCustomerList = [];
  customerListProcess.data.forEach((row) => {
    const cName = row.items.find((i) => i.key === "CUSTOMER NAME")?.value;
    groupOfCustomerList.push([
      {
        "CUSTOMER-NAME": cName,
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
exports.getDashboardProductionPlan = catchAsyncErrors(async (req, res, next) => {
  const { startDate, endDate } = req.query ?? {};
  const now = new Date();
  const effectiveStart = startDate ? Number(startDate) : new Date(now.getFullYear(), 0, 1).getTime();
  const effectiveEnd = endDate ? Number(endDate) : new Date(now.getFullYear() + 1, 11, 31, 23, 59, 59, 999).getTime();

  const productionPlanProcess = await Process.findOne({ processId: "MR/R/001" });
  if (!productionPlanProcess) return res.status(200).json({ success: true, data: {} });

  const pendingDetails = productionPlanProcess.data.filter((row) => {
    return (
      row.items.find((item) => item.key === "RM")?.value?.toLowerCase() !== "completed" &&
      row.items.find((item) => item.key === "INCOMING INSPECTION")?.value?.toLowerCase() !== "completed" &&
      row.items.find((item) => item.key === "MACHINE")?.value?.toLowerCase() !== "completed" &&
      row.items.find((item) => item.key === "ASSEMBLY")?.value?.toLowerCase() !== "completed" &&
      row.items.find((item) => item.key === "OUT PROCESS")?.value?.toLowerCase() !== "completed"
    );
  });

  const reportGraph = [];
  productionPlanProcess.data.forEach((row) => {
    const partNo = row.items.find((item) => item.key === "PART-NO")?.value || "N/A";
    const planQty = Number(row.items.find((item) => item.key === "PLAN QTY")?.value) || 0;
    reportGraph.push({ partNo, planQty });
  });

  const totalPlanQty = productionPlanProcess.data.reduce((acc, row) => {
    return acc + (Number(row.items.find((item) => item.key === "PLAN QTY")?.value) || 0);
  }, 0);

  res.status(200).json({ success: true, data: { pendingDetails, reportGraph, totalPlanQty } });
});

// GET /dashboard/production-report
exports.getDashboardProductionReport = catchAsyncErrors(async (req, res, next) => {
  const { startDate, endDate } = req.query ?? {};
  const now = new Date();
  const effectiveStart = startDate ? Number(startDate) : new Date(now.getFullYear(), 0, 1).getTime();
  const effectiveEnd = endDate ? Number(endDate) : new Date(now.getFullYear() + 1, 11, 31, 23, 59, 59, 999).getTime();

  const productionReportProcess = await Process.findOne({ processId: "MR/R/002" });
  if (!productionReportProcess) return res.status(200).json({ success: true, data: { totalFiltered: 0 } });

  const filteredRows = productionReportProcess.data.filter((row) => {
    const dateItem = row.items.find((item) => item.key === "DATE");
    if (!dateItem || !dateItem.value) return false;
    const epochMs = Number(dateItem.value);
    if (isNaN(epochMs)) return false;
    return epochMs >= effectiveStart && epochMs <= effectiveEnd;
  });

  res.status(200).json({ success: true, data: { totalFiltered: filteredRows.length } });
});

// GET /dashboard/reject-report
exports.getDashboardRejectReport = catchAsyncErrors(async (req, res, next) => {
  const [rejectReportProcess, productionReportProcess, actionTakenProcess] = await Promise.all([
    Process.findOne({ processId: "MR/R/003" }),
    Process.findOne({ processId: "MR/R/002" }),
    Process.findOne({ processId: "MR/R/003B" }),
  ]);

  if (!rejectReportProcess) return res.status(200).json({ success: true, data: { totalFiltered: 0, data: [], chartResult: 0 } });

  const openData = actionTakenProcess
    ? actionTakenProcess.data.filter((row) =>
        row.items.find((item) => item.key === "ACTION PLAN STATUS")?.value?.toLowerCase() === "open"
      )
    : [];

  const resultData = rejectReportProcess.data.filter((row) =>
    openData.some((openRow) => openRow.rowDataId?.toString() === row._id.toString())
  );

  let chartResult = 0;
  if (productionReportProcess && productionReportProcess.data.length > 0) {
    const sumOfReject = rejectReportProcess.data.reduce((acc, row) =>
      acc + (Number(row.items.find((item) => item.key === "REJECT QTY")?.value) || 0), 0);
    const sumOfActual = productionReportProcess.data.reduce((acc, row) =>
      acc + (Number(row.items.find((item) => item.key === "ACTUAL QTY")?.value) || 0), 0);
    chartResult = sumOfActual > 0 ? sumOfReject / sumOfActual : 0;
  }

  res.status(200).json({ success: true, data: { totalFiltered: resultData.length, data: resultData, chartResult } });
});

// GET /dashboard/rework-report
exports.getDashboardReworkReport = catchAsyncErrors(async (req, res, next) => {
  const reworkReportProcess = await Process.findOne({ processId: "MR/R/003A" });
  if (!reworkReportProcess) return res.status(200).json({ success: true, data: { totalFiltered: 0, data: [] } });

  const openData = reworkReportProcess.data.filter((row) =>
    row.items.find((item) => item.key === "RR STATUS")?.value?.toLowerCase() === "open"
  );

  res.status(200).json({ success: true, data: { totalFiltered: openData.length, data: openData } });
});

// GET /dashboard/dispatch
exports.getDashboardDispatch = catchAsyncErrors(async (req, res, next) => {
  const { startDate, endDate } = req.query ?? {};
  const now = new Date();
  const effectiveStart = startDate ? Number(startDate) : new Date(now.getFullYear(), 0, 1).getTime();
  const effectiveEnd = endDate ? Number(endDate) : new Date(now.getFullYear() + 1, 11, 31, 23, 59, 59, 999).getTime();

  const dispatchProcess = await Process.findOne({ processId: "MR/R/006" });
  if (!dispatchProcess) return res.status(200).json({ success: true, data: { totalFiltered: 0, data: [], totalQuantity: 0, graphChart: { monthWise: [], yearWise: [] } } });

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
    const epochMs = Number(row.items.find((item) => item.key === "DATE")?.value);
    const qty = Number(row.items.find((item) => item.key === "QTY")?.value) || 0;
    const d = new Date(epochMs);
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, "0");
    const monthKey = `${year}-${month}`;
    monthMap[monthKey] = (monthMap[monthKey] || 0) + qty;
    yearMap[year] = (yearMap[year] || 0) + qty;
  });

  const monthWise = Object.entries(monthMap).sort(([a], [b]) => a.localeCompare(b)).map(([label, qty]) => ({ label, qty }));
  const yearWise = Object.entries(yearMap).sort(([a], [b]) => Number(a) - Number(b)).map(([label, qty]) => ({ label: String(label), qty }));
  const totalQuantity = filteredRows.reduce((acc, row) => acc + (Number(row.items.find((item) => item.key === "QTY")?.value) || 0), 0);

  res.status(200).json({ success: true, data: { totalFiltered: filteredRows.length, data, totalQuantity, graphChart: { monthWise, yearWise } } });
});

// GET /dashboard/calibration
exports.getDashboardCalibration = catchAsyncErrors(async (req, res, next) => {
  const calibrationReportProcess = await Process.findOne({ processId: "QA/R/002A" });
  if (!calibrationReportProcess) return res.status(200).json({ success: true, data: { totalFiltered: 0, data: [], doneCount: 0, dueCount: 0 } });

  const filteredCalibration = calibrationReportProcess.data.filter((row) => {
    const certificate = row.items.find((item) => item.key === "CERTIFICATE")?.value;
    const date = row.items.find((item) => item.key === "DATE")?.value;
    return certificate === "" || certificate === null || date <= Date.now() - 10 * 24 * 60 * 60 * 1000;
  });

  const doneCount = filteredCalibration.filter((row) =>
    row.items.find((item) => item.key === "DONE")?.value?.toLowerCase() === "done"
  ).length;
  const dueCount = filteredCalibration.filter((row) =>
    row.items.find((item) => item.key === "DONE")?.value?.toLowerCase() === "due"
  ).length;

  res.status(200).json({ success: true, data: { totalFiltered: filteredCalibration.length, data: filteredCalibration, doneCount, dueCount } });
});

// GET /dashboard/incoming-inspection
exports.getDashboardIncomingInspection = catchAsyncErrors(async (req, res, next) => {
  const incomingInspectionProcess = await Process.findOne({ processId: "QA/R/003" });
  if (!incomingInspectionProcess) return res.status(200).json({ success: true, data: { totalFiltered: 0, data: [] } });

  const filteredInspection = incomingInspectionProcess.data.filter((row) => {
    const status = row.items.find((item) => item.key === "INSPECTION-STATUS")?.value;
    return status?.toLowerCase() !== "done";
  });

  res.status(200).json({ success: true, data: { totalFiltered: filteredInspection.length, data: filteredInspection } });
});

// GET /dashboard/customer-complaints
exports.getDashboardCustomerComplaints = catchAsyncErrors(async (req, res, next) => {
  const customerComplientRegisterProcess = await Process.findOne({ processId: "QA/R/007" });
  if (!customerComplientRegisterProcess) return res.status(200).json({ success: true, data: { totalFiltered: 0, data: [] } });

  const filteredCustomer = customerComplientRegisterProcess.data.map((row) => {
    const suppliedQty = row.items.find((item) => item.key === "SUPPLIED QTY")?.value;
    const failedQty = row.items.find((item) => item.key === "FAILED QTY")?.value;
    const date = row.items.find((item) => item.key === "DATE")?.value;
    return { ratio: suppliedQty ? failedQty / suppliedQty : 0, date };
  });

  res.status(200).json({ success: true, data: { totalFiltered: filteredCustomer.length, data: filteredCustomer } });
});

// GET /dashboard/customer-list
exports.getDashboardCustomerList = catchAsyncErrors(async (req, res, next) => {
  const { salesPerson, location } = req.query ?? {};
  const customerListProcess = await Process.findOne({ processId: "MS/R/004" });
  if (!customerListProcess) return res.status(200).json({ success: true, data: { totalFiltered: 0, data: [] } });

  const filteredCustomer = customerListProcess.data.filter((row) => {
    const salesPersonValue = row.items.find((item) => item.key === "SALES PERSON")?.value;
    const locationValue = row.items.find((item) => item.key === "LOCATION")?.value;
    const matchSales = !salesPerson || salesPerson === "" || salesPersonValue?.toLowerCase() === salesPerson.toLowerCase();
    const matchLocation = !location || location === "" || locationValue?.toLowerCase() === location.toLowerCase();
    return matchSales && matchLocation;
  });

  res.status(200).json({ success: true, data: { totalFiltered: filteredCustomer.length, data: filteredCustomer } });
});

// GET /dashboard/quotation-list
exports.getDashboardQuotationList = catchAsyncErrors(async (req, res, next) => {
  const quotationListProcess = await Process.findOne({ processId: "MS/R/005" });
  if (!quotationListProcess) return res.status(200).json({ success: true, data: { totalFiltered: 0, data: [] } });

  const filteredQuotation = quotationListProcess.data.filter((row) => {
    const status = row.items.find((item) => item.key === "QL STATUS")?.value?.toLowerCase();
    return status === "waiting for quote" || status === "waiting for order";
  });

  res.status(200).json({ success: true, data: { totalFiltered: filteredQuotation.length, data: filteredQuotation } });
});

// GET /dashboard/order-list
exports.getDashboardOrderList = catchAsyncErrors(async (req, res, next) => {
  const orderListProcess = await Process.findOne({ processId: "MS/R/006" });
  if (!orderListProcess) return res.status(200).json({ success: true, data: { totalFiltered: 0, data: [], totalOrderQty: 0 } });

  const filteredOrder = orderListProcess.data.filter((row) => {
    const status = row.items.find((item) => item.key === "STATUS")?.value;
    return status?.toLowerCase() !== "closed";
  });

  const totalOrderQty = filteredOrder.reduce((acc, row) =>
    acc + (Number(row.items.find((item) => item.key === "QTY")?.value) || 0), 0);

  res.status(200).json({ success: true, data: { totalFiltered: filteredOrder.length, data: filteredOrder, totalOrderQty } });
});

// GET /dashboard/procurement
exports.getDashboardProcurement = catchAsyncErrors(async (req, res, next) => {
  const procurementProcess = await Process.findOne({ processId: "PR/R/003" });
  if (!procurementProcess) return res.status(200).json({ success: true, data: { totalFiltered: 0, data: [], totalPendingQty: 0 } });

  const filteredProcurement = procurementProcess.data.filter((row) => {
    const status = row.items.find((item) => item.key === "PR STATUS")?.value;
    return status?.toLowerCase() === "pending";
  });

  const totalPendingQty = filteredProcurement.reduce((acc, row) =>
    acc + (Number(row.items.find((item) => item.key === "QTY")?.value) || 0), 0);

  res.status(200).json({ success: true, data: { totalFiltered: filteredProcurement.length, data: filteredProcurement, totalPendingQty } });
});

// GET /dashboard/stock
exports.getDashboardStock = catchAsyncErrors(async (req, res, next) => {
  const stockDataProcess = await Process.findOne({ processId: "ST/R/006" });
  if (!stockDataProcess) return res.status(200).json({ success: true, data: { totalFiltered: 0, data: [], totalStockQty: 0 } });

  const filteredStock = stockDataProcess.data.filter((row) => {
    const itemCategory = row.items.find((item) => item.key === "ITEM CATEGORY")?.value;
    return itemCategory?.toLowerCase() === "finished good" || itemCategory?.toLowerCase() === "finsihed good";
  });

  const totalStockQty = filteredStock.reduce((acc, row) =>
    acc + (Number(row.items.find((item) => item.key === "STOCK")?.value) || 0), 0);

  res.status(200).json({ success: true, data: { totalFiltered: filteredStock.length, data: filteredStock, totalStockQty } });
});

exports.getMainNPDRegisterDashboard = catchAsyncErrors(async (req, res, next) => {
  const npdProcess = await Process.findOne({ processId: "DD/R/010" });

  if (!npdProcess) {
    return next(new ErrorHandler("NPD Register Process (DD/R/010) not found", 404));
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
        part: items.find((i) => i.key === "PART")?.value || items.find((i) => i.key === "PART NAME")?.value || "",
        proto: items.find((i) => i.key === "PROTO")?.process || "",
        validation: items.find((i) => i.key === "VALIDATION")?.process || "",
        master: (items.find((i) => i.key === "MASTER PIECE") || items.find((i) => i.key === "MASTER"))?.process || "",
        due: (() => {
          const epoch = Number(items.find((i) => i.key === "TARGET DATE")?.value);
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

exports.getMainProductListDashboard = catchAsyncErrors(async (req, res, next) => {
  const productListProcess = await Process.findOne({ processId: "DD/R/001" });
  const BOMProcess = await Process.findOne({ processId: "DD/R/002" });

  if (!productListProcess || !BOMProcess) {
    return next(new ErrorHandler("Product List Process (DD/R/001) or BOM Process (DD/R/002) not found", 404));
  }

  // GET THE COUNT OF THE RECORDS.
  const totalProducts = productListProcess.data.length;
  const totalBOMs = BOMProcess.data.length;

  res.status(200).json({
    success: true,
    totalProducts,
    totalBOMs,
  });

});

exports.getMainRevisionControlDashboard = catchAsyncErrors(async (req, res, next) => {
  const revisionControlProcess = await Process.findOne({ processId: "DD/R/005" });

  if (!revisionControlProcess) {
    return next(new ErrorHandler("Revision Control Process (DD/R/003) not found", 404));
  }

  const filteredData = revisionControlProcess.data
    .filter((row) => {
      const status = row.items.find((i) => i.key === "REVISION STATUS")?.value;
      return status?.toLowerCase() !== "revised";
    })
    .map((row) => {
      const items = row.items;
      return {
        date: items.find((i) => i.key === "DATE")?.value || "",
        part: items.find((i) => i.key === "PART NO")?.value || "",
        status: items.find((i) => i.key === "REVISION STATUS")?.value || "",
        due: (() => {
          const epoch = Number(items.find((i) => i.key === "DATE")?.value);
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

exports.getMainOrderListDashboard = catchAsyncErrors( async (req, res, next) => {
  const orderListProcess = await Process.findOne({ processId: "MS/R/006" });

  if (!orderListProcess) {
    return next(new ErrorHandler("Order List Process (MS/R/006) not found", 404));
  }

  const { startDate, endDate } = req.query;
  const now = new Date();
  const effectiveStart = startDate
    ? Number(startDate)
    : new Date(now.getFullYear(), 0, 1).getTime();
  const effectiveEnd = endDate
    ? Number(endDate)
    : new Date(now.getFullYear() + 1, 11, 31, 23, 59, 59, 999).getTime();

  const filteredData = orderListProcess.data
    .filter((row) => {
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

exports.getProductSuccessDashboard = catchAsyncErrors(async (req, res, next) => {
  const productSuccessProcess = await Process.findOne({ processId: "DD/R/007" });

  if (!productSuccessProcess) {
    return next(new ErrorHandler("Product Success Process (DD/R/007) not found", 404));
  }

  const filteredData = productSuccessProcess.data
    .filter((row) => {
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
});

exports.getMainSettings = catchAsyncErrors(async (req, res, next) => {
  const settingsProcess = await Process.findOne({ processId: "MR/R/002A" });

  if (!settingsProcess) {
    return next(new ErrorHandler("Settings Process (MR/R/002A) not found", 404));
  }

  const filteredData = settingsProcess.data
    .filter((row) => {
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
    return next(new ErrorHandler("Settings Process (MR/R/002A) not found", 404));
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
      averageSettingTime: settingTimeCount > 0 ? Number((totalSettingTime / settingTimeCount).toFixed(2)) : 0,
      avgSetupLoss: setupLossCount > 0 ? Number((totalSetupLoss / setupLossCount).toFixed(2)) : 0,
    },
  });
});

exports.getCalibrationDueDashboard = catchAsyncErrors(async (req, res, next) => {
  const calibrationProcess = await Process.findOne({ processId: "QA/R/002A" });

  if (!calibrationProcess) {
    return next(new ErrorHandler("Calibration Process (QA/R/002A) not found", 404));
  }

  const filteredCalibration = calibrationProcess.data.filter((row) => {
    const certificate = row.items.find((item) => item.key === "CERTIFICATE")?.value;
    const date = row.items.find((item) => item.key === "DATE")?.value || row.items.find((item) => item.key === "DUE")?.value; // Supporting both DATE and DUE keys
    
    return (
      certificate === "" ||
      certificate === null ||
      (date && Number(date) <= Date.now() - 10 * 24 * 60 * 60 * 1000)
    );
  });

  const doneCount = filteredCalibration.filter((row) => {
    const status = row.items.find((item) => item.key === "DONE")?.value;
    return status?.toString().toLowerCase() !== "";
  }).length;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayEpoch = today.getTime();

  const dueCount = filteredCalibration.filter((row) => {
    const dueValue = row.items.find((item) => item.key === "DUE")?.value;
    if (!dueValue) return false;
    const dueEpoch = Number(dueValue);
    return !isNaN(dueEpoch) && dueEpoch > todayEpoch;
  }).length;

  res.status(200).json({
    success: true,
    data: {
      totalFiltered: filteredCalibration.length,
      doneCount,
      dueCount,
      openRecords: filteredCalibration,
    },
  });
});

exports.getProcessControlPlanDashboard = catchAsyncErrors(async (req, res, next) => {
  const pcpProcess = await Process.findOne({ processId: "QA/R/009" });

  if (!pcpProcess) {
    return next(new ErrorHandler("Process Control Plan Process (QA/R/009) not found", 404));
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
});

exports.getCertificateRenewalDashboard = catchAsyncErrors(async (req, res, next) => {
  const certificateProcess = await Process.findOne({ processId: "QA/R/011" });

  if (!certificateProcess) {
    return next(new ErrorHandler("Certificate Renewal Process (QA/R/011) not found", 404));
  }

  const { startDate, endDate } = req.query;
  let filteredData = certificateProcess.data;

  const results = filteredData.map((row) => {
    const items = row.items;
    const certName = items.find((i) => i.key === "CERTIFICATE NAME")?.value || "N/A";
    const certNo = items.find((i) => i.key === "CERTIFICATE NO ")?.value || "N/A";
    const department = items.find((i) => i.key === "DEPARTMENT")?.value || "N/A";
    const status = items.find((i) => i.key === "CRS-STATUS")?.value || "N/A";

    // Attempt to find any date fields for due calculation
    const dateItem = items.find((i) => 
      i.key.toLowerCase().includes("date") || 
      i.key.toLowerCase().includes("expiry") || 
      i.key.toLowerCase().includes("due")
    );
    
    const epoch = dateItem ? Number(dateItem.value) : null;
    let reminder = "No date set";
    let isDue = false;

    if (epoch && !isNaN(epoch)) {
      const daysLeft = Math.ceil((epoch - Date.now()) / (1000 * 60 * 60 * 24));
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
      isDue
    };
  });

  res.status(200).json({
    success: true,
    data: results,
  });
});

// 1. NPD Dashboard
exports.getNPDDashboardDetails = catchAsyncErrors(async (req, res, next) => {
  const npdProcess = await Process.findOne({ processId: "DD/R/010" });

  if (!npdProcess) {
    return next(new ErrorHandler("NPD Register Process (DD/R/010) not found", 404));
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
        part: items.find((i) => i.key === "PART")?.value || items.find((i) => i.key === "PART NAME")?.value || "",
        proto: items.find((i) => i.key === "PROTO")?.process || "",
        validation: items.find((i) => i.key === "VALIDATION")?.process || "",
        master: (items.find((i) => i.key === "MASTER PIECE") || items.find((i) => i.key === "MASTER"))?.process || "",
        due: (() => {
          const epoch = Number(items.find((i) => i.key === "TARGET DATE")?.value);
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
    return next(new ErrorHandler("Product List (DD/R/001) or BOM (DD/R/002) Process not found", 404));
  }

  const uniqueProductParts = new Set();
  ProductsProcess.data.forEach((row) => {
    const partNo = row.items.find((i) => i.key === "PART NO" || i.key === "PART-NO")?.value;
    if (partNo) uniqueProductParts.add(partNo.trim());
  });

  const uniqueBOMParts = new Set();
  BOMProcess.data.forEach((row) => {
    const partNo = row.items.find((i) => i.key === "PART NO" || i.key === "PART-NO")?.value;
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
exports.getRevisionControlDashboard = catchAsyncErrors(async (req, res, next) => {
  const revisionControlProcess = await Process.findOne({ processId: "DD/R/005" });

  if (!revisionControlProcess) {
    return next(new ErrorHandler("Revision Control Process (DD/R/005) not found", 404));
  }

  const filteredData = revisionControlProcess.data
    .filter((row) => {
      const status = row.items.find((i) => i.key === "REVISION STATUS")?.value;
      return status === "INREVISION";
    })
    .map((row) => {
      const items = row.items;
      return {
        partNo: items.find((i) => i.key === "PART NO" || i.key === "PART-NO")?.value || "",
        partName: items.find((i) => i.key === "PART NAME" || i.key === "PART-NAME")?.value || "",
        revisionStatus: items.find((i) => i.key === "REVISION STATUS")?.value || "",
        dueDate: items.find((i) => i.key === "DUE DATE" || i.key === "DUE")?.value || "",
      };
    });

  res.status(200).json({
    success: true,
    count: filteredData.length,
    data: filteredData,
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
    )
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
      row.items.find((item) => item.key === "RR STATUS")?.value?.toLowerCase() ===
      "open",
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
        new ErrorHandler("Incoming Inspection Process (QA/R/003) not found", 404),
      );
    }
    const pendingCount = incomingInspectionProcess.data.filter((row) => {

      const status = row.items.find((i) => i.key === "INSPECTION-STATUS")?.value;
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
    return next(new ErrorHandler("Quality Audits Process (QA/F/005) not found", 404));
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
    const department = items.find((i) => i.key === "DEPARTMENT")?.value || "N/A";
    const ncValue = items.find((i) => i.key === "NC")?.value || "0";
    const responsible = items.find((i) => i.key === "RESPONSIBLE")?.value || "N/A";

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
exports.getContinuousImprovementDashboard = catchAsyncErrors(async (req, res, next) => {
  // Using MR/R/005 as per the provided JSON snippet for Continuous Improvement
  const continuousImprovementProcess = await Process.findOne({ processId: "MR/R/005" });

  if (!continuousImprovementProcess) {
    return next(new ErrorHandler("Continuous Improvement Process (MR/R/005) not found", 404));
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
});

// 11. Employee Overhead Dashboard
exports.getEmployeeOverheadDashboard = catchAsyncErrors(async (req, res, next) => {
  const employeeHistoryProcess = await Process.findOne({ processId: "HR/R/001" });

  if (!employeeHistoryProcess) {
    return next(new ErrorHandler("Employee History Process (HR/R/001) not found", 404));
  }

  const { department } = req.query;

  // Actual OverHead = Count of active employees
  let activeEmployees = employeeHistoryProcess.data.filter((row) => {
    const relievingDate = row.items.find((i) => i.key === "DATE OF RELELIVING")?.value;
    return !relievingDate || relievingDate === "";
  });

  if (department) {
    activeEmployees = activeEmployees.filter((row) => {
      const dept = row.items.find((i) => i.key === "DEPARTMENT")?.value;
      return dept?.toLowerCase() === department.toLowerCase();
    });
  }

  res.status(200).json({
    success: true,
    data: {
      actualOverHead: activeEmployees.length,
    },
  });
});

// 12. Employee Attendance % (Department Wise % for Pie Chart)
exports.getEmployeeAttendanceDashboard = catchAsyncErrors(async (req, res, next) => {
  const employeeHistoryProcess = await Process.findOne({ processId: "HR/R/001" });

  if (!employeeHistoryProcess) {
    return next(new ErrorHandler("Employee History Process (HR/R/001) not found", 404));
  }

  const { startDate, endDate } = req.query;

  // Filter active employees within the date range
  const now = Date.now();
  const effectiveStart = startDate ? Number(startDate) : 0;
  const effectiveEnd = endDate ? Number(endDate) : now;

  let activeDuringRange = employeeHistoryProcess.data.filter((row) => {
    const joinValue = row.items.find((i) => i.key === "DATE OF JOINING")?.value;
    const reliefValue = row.items.find((i) => i.key === "DATE OF RELELIVING")?.value;

    const joinEpoch = Number(joinValue);
    const reliefEpoch = reliefValue ? Number(reliefValue) : Infinity;

    // Check if employee tenure overlaps with the range
    return joinEpoch <= effectiveEnd && reliefEpoch >= effectiveStart;
  });

  // Calculate department distribution
  const departmentStats = {};
  activeDuringRange.forEach((row) => {
    const dept = row.items.find((i) => i.key === "DEPARTMENT")?.value || "Unassigned";
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
});

// 13. Procurement Register
exports.getProcurementRegisterDashboard = catchAsyncErrors(async (req, res, next) => {
  // Using PR/R/003 as per the provided JSON snippet for Procurement Register
  const procurementProcess = await Process.findOne({ processId: "PR/R/003" });

  if (!procurementProcess) {
    return next(new ErrorHandler("Procurement Process (PR/R/003) not found", 404));
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
});

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
    return next(new ErrorHandler("Customer List Process (MS/R/004) not found", 404));
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
    return next(new ErrorHandler("Order List Process (MS/R/006) not found", 404));
  }
  const { startDate, endDate } = req.query;
  const effectiveStart = startDate ? Number(startDate) : 0;
  const effectiveEnd = endDate ? Number(endDate) : Infinity;

  const salesTrend = {};
  orderListProcess.data.forEach((row) => {
    const dateVal = row.items.find((i) => i.key === "DATE" || i.key === "ORDER DATE")?.value;
    const value = parseFloat(row.items.find((i) => i.key === "VALUE")?.value || 0);
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
    data: Object.entries(salesTrend).map(([month, value]) => ({ month, value })),
  });
});

// 17. Sales Dashboard - Quotation Status
exports.getQuotationStatus = catchAsyncErrors(async (req, res, next) => {
  const quotationListProcess = await Process.findOne({ processId: "MS/R/005" });
  if (!quotationListProcess) {
    return next(new ErrorHandler("Quotation List Process (MS/R/005) not found", 404));
  }
  const quotationStatus = {};
  quotationListProcess.data.forEach((row) => {
    const status = row.items.find((i) => i.key === "QL STATUS")?.value || "UNKNOWN";
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
    return next(new ErrorHandler("Order List Process (MS/R/006) not found", 404));
  }
  let totalOrderQty = 0;
  let totalPendingQty = 0;
  orderListProcess.data.forEach((row) => {
    const qty = parseFloat(row.items.find((i) => i.key === "QTY")?.value || 0);
    const pendingQty = parseFloat(row.items.find((i) => i.key === "PENDING QTY")?.value || 0);
    totalOrderQty += isNaN(qty) ? 0 : qty;
    totalPendingQty += isNaN(pendingQty) ? 0 : pendingQty;
  });
  res.status(200).json({
    success: true,
    data: { totalOrderQty, totalPendingQty },
  });
});

// 19. Sales Dashboard - Payment and Delivery
exports.getSalesPaymentAndDelivery = catchAsyncErrors(async (req, res, next) => {
  const docketsProcess = await Process.findOne({ processId: "MS/R/006A" });
  if (!docketsProcess) {
    return next(new ErrorHandler("Dockets Process (MS/R/006A) not found", 404));
  }

  let paymentPendingCount = 0;
  let totalLeadTime = 0;
  let leadTimeCount = 0;

  docketsProcess.data.forEach((row) => {
    const payment = row.items.find((i) => i.key === "PAYMENT")?.value;
    if (payment && (payment.toUpperCase() === "OPEN" || payment.toUpperCase() === "PENDING")) {
      paymentPendingCount++;
    }

    const orderDateVal = row.items.find((i) => i.key === "ORDER DATE")?.value;
    const deliveryDateVal = row.items.find((i) => i.key === "DELIVERY DATE")?.value;
    if (orderDateVal && deliveryDateVal) {
      const diff = (Number(deliveryDateVal) - Number(orderDateVal)) / (1000 * 60 * 60 * 24);
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
      averageLeadTime: leadTimeCount > 0 ? Number((totalLeadTime / leadTimeCount).toFixed(1)) : 0,
    },
  });
});

// 20. Sales Dashboard - Trail Status
exports.getSalesTrailStatus = catchAsyncErrors(async (req, res, next) => {
  const customerTrailProcess = await Process.findOne({ processId: "MS/R/001" });
  if (!customerTrailProcess) {
    return next(new ErrorHandler("Customer Trail Process (MS/R/001) not found", 404));
  }
  const trailStatus = {};
  customerTrailProcess.data.forEach((row) => {
    const status = row.items.find((i) => i.key.includes("STATUS"))?.value || "UNKNOWN";
    trailStatus[status] = (trailStatus[status] || 0) + 1;
  });
  res.status(200).json({
    success: true,
    data: trailStatus,
  });
});

