const mongoose = require("mongoose");
const Process = require("../models/process");
const History = require("../models/history");
const { bulkEntryConfigs } = require("./constants");
const {
  handleAddIntersection,
  handleUpdateIntersection,
} = require("./intersections");

const getBulkConfig = (processId) => bulkEntryConfigs[processId] || null;

const buildOrderedItems = (headers, valueMap = {}) =>
  (headers || []).map((key) => ({
    key,
    value:
      valueMap[key] !== undefined && valueMap[key] !== null
        ? valueMap[key]
        : "",
    process: "value",
  }));

const itemsToMap = (items = []) => {
  const map = {};
  for (const item of items) {
    if (item?.key) map[item.key] = item.value;
  }
  return map;
};

const getItemValue = (items, key) =>
  items.find((i) => i.key === key)?.value ?? "";

const setOrPushItem = (items, key, value, processType = "value") => {
  const existing = items.find((i) => i.key === key);
  if (existing) {
    existing.value = value;
  } else {
    items.push({ key, value, process: processType });
  }
};

/**
 * After docket create/update: sync PENDING QTY on order + docket, copy identity fields,
 * and CLOSE the order when pending <= 0.
 */
const syncDocketOrderPending = async (docketProcess, items, rowDataId) => {
  const orderProcess = await Process.findOne({ processId: "MS/R/006" });
  if (!orderProcess) return { pendingQty: null, closed: false };

  const orderRow = orderProcess.data.find(
    (row) => row._id.toString() === rowDataId.toString(),
  );
  if (!orderRow) return { pendingQty: null, closed: false };

  // Sum existing dockets for this order, then add current row (not yet in data on create)
  let totalDeliveryQty = docketProcess.data.reduce((sum, row) => {
    if (row.rowDataId && row.rowDataId.toString() === rowDataId.toString()) {
      const qty = row.items.find((item) => item.key === "DELIVERY QTY")?.value;
      return sum + Number(qty || 0);
    }
    return sum;
  }, 0);

  totalDeliveryQty += Number(
    items.find((i) => i.key === "DELIVERY QTY")?.value || 0,
  );

  const orderQty = Number(
    orderRow.items.find((item) => item.key === "QTY")?.value || 0,
  );
  const pendingQty = orderQty - totalDeliveryQty;

  setOrPushItem(items, "PENDING QTY", String(pendingQty));
  setOrPushItem(orderRow.items, "PENDING QTY", String(pendingQty));

  const customerName = getItemValue(orderRow.items, "CUSTOMER NAME");
  const partNo = getItemValue(orderRow.items, "PART NO");
  const poNo = getItemValue(orderRow.items, "PO NO");

  const name = items.find((i) => i.key === "CUSTOMER NAME");
  const part = items.find((i) => i.key === "PART NO");
  const PO = items.find((i) => i.key === "PO NO");
  if (name) name.value = customerName || "";
  if (part) part.value = partNo || "";
  if (PO) PO.value = poNo || "";

  let closed = false;
  if (pendingQty <= 0) {
    setOrPushItem(orderRow.items, "ORDER STATUS", "CLOSED");
    closed = true;
  }

  orderProcess.markModified("data");
  await orderProcess.save();

  return { pendingQty, closed };
};

const applyQuotationDefaults = (items) => {
  const quotationItem = items.find((i) => i.key === "QUOTATION NO");
  const qlStatusItem = items.find((i) => i.key === "QL STATUS");
  if (qlStatusItem && quotationItem !== "ORDER") {
    const quotationNo = quotationItem?.value?.trim() || "";
    qlStatusItem.value =
      quotationNo === "" ? "WAITING FOR QUOTE" : "WAITING FOR ORDER";
  }
};

/**
 * Create one process row using the same intersection + side-effect path as addData.
 */
const createProcessRow = async (processId, items, rowDataId, userId) => {
  const process = await Process.findOne({ processId });
  if (!process) {
    const err = new Error(`Process ${processId} not found`);
    err.statusCode = 404;
    throw err;
  }

  const rid = rowDataId || new mongoose.Types.ObjectId();
  const intersectionResponse = await handleAddIntersection(
    process,
    items,
    rid,
    userId,
  );

  if (!intersectionResponse?.success) {
    const err = new Error(
      intersectionResponse?.message || "Intersection Processing Failed",
    );
    err.statusCode = intersectionResponse?.statusCode || 400;
    throw err;
  }

  let closed = false;

  if (process.processId === "MS/R/005") {
    applyQuotationDefaults(items);
  } else if (process.processId === "MS/R/006A") {
    const sync = await syncDocketOrderPending(process, items, rid);
    closed = !!sync.closed;
  }

  const newRow = {
    items,
    rowDataId: rid,
    _id: intersectionResponse?.newRowId || undefined,
  };
  process.data.push(newRow);
  process.updatedBy = userId;
  await process.save();

  const savedId = process.data[process.data.length - 1]._id;
  await History.create({
    collectionName: "Process",
    documentId: process._id,
    rowId: savedId,
    operation: "create",
    oldData: null,
    newData: newRow,
    changedBy: userId,
  });

  return { rowId: savedId, closed };
};

/**
 * Update one process row (Quotation bulk edit path).
 */
const updateProcessRow = async (processId, rowId, items, userId) => {
  const process = await Process.findOne({ processId });
  if (!process) {
    const err = new Error(`Process ${processId} not found`);
    err.statusCode = 404;
    throw err;
  }

  const row = process.data.id(rowId);
  if (!row) {
    const err = new Error("Row not found");
    err.statusCode = 404;
    throw err;
  }

  const previousItems = row.items.map((i) => i.toObject?.() || { ...i });
  const intersectionResponse = await handleUpdateIntersection(
    process,
    items,
    row,
    userId,
    rowId,
    previousItems,
  );

  if (!intersectionResponse?.success) {
    const err = new Error(
      intersectionResponse?.message || "Intersection Processing Failed",
    );
    err.statusCode = intersectionResponse?.statusCode || 400;
    throw err;
  }

  if (process.processId === "MS/R/005") {
    applyQuotationDefaults(items);
  }

  const oldData = { ...row.toObject() };
  row.items = items;
  process.updatedBy = userId;
  await process.save();

  await History.create({
    collectionName: "Process",
    documentId: process._id,
    rowId,
    operation: "update",
    oldData,
    newData: row.toObject(),
    changedBy: userId,
  });

  return { rowId };
};

module.exports = {
  getBulkConfig,
  buildOrderedItems,
  itemsToMap,
  createProcessRow,
  updateProcessRow,
  syncDocketOrderPending,
};
