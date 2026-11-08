const Process = require("../models/process");
const ErrorHandler = require("../utils/errorHandler");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const {
  getBulkConfig,
  buildOrderedItems,
  itemsToMap,
  createProcessRow,
  updateProcessRow,
} = require("../utils/bulkProcessService");

exports.getBulkConfigByProcessId = catchAsyncErrors(async (req, res, next) => {
  const { processId } = req.params;
  const config = getBulkConfig(processId);
  if (!config) {
    return next(new ErrorHandler("Bulk entry not configured for this process", 404));
  }

  const target = await Process.findOne({ processId }).select("headers process processId");
  if (!target) {
    return next(new ErrorHandler("Process not found", 404));
  }

  const singleSet = new Set(config.singleEntryHeaders || []);
  const multiEntryHeaders =
    config.multipleEntryHeaders ||
    (target.headers || []).filter((h) => !singleSet.has(h));

  res.status(200).json({
    success: true,
    data: {
      ...config,
      headers: target.headers || [],
      processName: target.process,
      multiEntryHeaders,
    },
  });
});

exports.bulkFetch = catchAsyncErrors(async (req, res, next) => {
  const { processId, filters, page = 1, limit = 500 } = req.body || {};
  const config = getBulkConfig(processId);
  if (!config) {
    return next(new ErrorHandler("Bulk entry not configured for this process", 404));
  }

  const sourceProcessId = config.sourceProcessId || processId;
  if (!sourceProcessId) {
    return next(new ErrorHandler("No source process configured for fetch", 400));
  }

  // Quotation self-edit: require ENQUIRY NO (or any filterHeaders) to be provided
  if (config.mode === "blankMultiCreate") {
    const requiredFilters = config.filterHeaders || [];
    for (const key of requiredFilters) {
      const val = filters?.[key];
      if (val === undefined || val === null || String(val).trim() === "") {
        return next(
          new ErrorHandler(`Filter "${key}" is required to fetch records for edit`, 400),
        );
      }
    }
  }

  const pageNum = Math.max(1, Number(page) || 1);
  const pageLimit = Math.min(2000, Math.max(1, Number(limit) || 500));
  const skip = (pageNum - 1) * pageLimit;

  const appliedFilters = {
    ...(config.defaultFilters || {}),
    ...(filters || {}),
  };

  const source = await Process.findOne({ processId: sourceProcessId }).lean();
  if (!source) {
    return next(
      new ErrorHandler(`Source process ${sourceProcessId} not found`, 404),
    );
  }

  const singleSet = new Set(config.singleEntryHeaders || []);
  const multiEntryHeaders =
    config.multipleEntryHeaders ||
    (source.headers || []).filter((h) => !singleSet.has(h));

  const displayKeys = [
    ...(config.parentDisplayHeaders || []),
    ...multiEntryHeaders,
    ...(config.singleEntryHeaders || []),
    ...(config.filterHeaders || []),
  ];
  const keySet = new Set(displayKeys);

  const matchFilters = (row) => {
    for (const [key, expected] of Object.entries(appliedFilters)) {
      if (expected === undefined || expected === null || expected === "") continue;
      const item = (row.items || []).find((i) => i.key === key);
      const val = item?.value;
      if (
        String(val ?? "").trim().toUpperCase() !==
        String(expected).trim().toUpperCase()
      ) {
        return false;
      }
    }
    return true;
  };

  const matched = (source.data || []).filter(matchFilters);
  const total = matched.length;
  const pageRows = matched.slice(skip, skip + pageLimit);

  const rows = pageRows.map((row) => {
    const items = {};
    for (const item of row.items || []) {
      if (keySet.size === 0 || keySet.has(item.key)) {
        items[item.key] = item.value;
      }
    }
    for (const key of keySet) {
      if (items[key] === undefined) items[key] = "";
    }
    return {
      rowId: row._id,
      sourceRowId: row._id,
      items,
    };
  });

  // Shared single-entry snapshot from first match (for bulk edit prefills)
  let singleEntryFromFetch = null;
  if (pageRows.length > 0 && (config.singleEntryHeaders || []).length) {
    singleEntryFromFetch = {};
    const firstMap = {};
    for (const item of pageRows[0].items || []) {
      firstMap[item.key] = item.value;
    }
    for (const key of config.singleEntryHeaders) {
      singleEntryFromFetch[key] = firstMap[key] ?? "";
    }
  }

  res.status(200).json({
    success: true,
    total,
    page: pageNum,
    limit: pageLimit,
    rows,
    singleEntryFromFetch,
  });
});

exports.bulkUpsert = catchAsyncErrors(async (req, res, next) => {
  const { processId, singleEntry = {}, rows = [] } = req.body || {};
  const config = getBulkConfig(processId);
  if (!config) {
    return next(new ErrorHandler("Bulk entry not configured for this process", 404));
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return next(new ErrorHandler("rows must be a non-empty array", 400));
  }

  const target = await Process.findOne({ processId });
  if (!target) {
    return next(new ErrorHandler("Process not found", 404));
  }

  const headers = target.headers || [];
  const userId = req.user._id;

  let created = 0;
  let updated = 0;
  let closedOrders = 0;
  const failed = [];

  if (config.mode === "blankMultiCreate") {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const valueMap = {
          ...singleEntry,
          ...(row.items || {}),
        };
        const items = buildOrderedItems(headers, valueMap);

        if (row.rowId) {
          await updateProcessRow(processId, row.rowId, items, userId);
          updated += 1;
        } else {
          await createProcessRow(processId, items, null, userId);
          created += 1;
        }
      } catch (err) {
        failed.push({
          index: i,
          message: err.message || "Failed to save row",
        });
      }
    }
  } else if (config.mode === "parentFetchCreate") {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const sourceRowId = row.sourceRowId || row.rowId;
        if (!sourceRowId) {
          throw new Error("sourceRowId (parent order id) is required");
        }

        const deliveryQty = Number(row.items?.["DELIVERY QTY"] ?? 0);
        if (!(deliveryQty > 0)) {
          throw new Error("DELIVERY QTY must be greater than 0");
        }

        const orderProcess = await Process.findOne({ processId: "MS/R/006" });
        const orderRow = orderProcess?.data?.id?.(sourceRowId) ||
          orderProcess?.data?.find(
            (r) => r._id.toString() === sourceRowId.toString(),
          );
        if (!orderRow) {
          throw new Error("Parent order row not found");
        }

        const pendingQty = Number(
          orderRow.items.find((it) => it.key === "PENDING QTY")?.value ??
            orderRow.items.find((it) => it.key === "QTY")?.value ??
            0,
        );
        if (deliveryQty > pendingQty) {
          throw new Error(
            `DELIVERY QTY (${deliveryQty}) exceeds PENDING QTY (${pendingQty})`,
          );
        }

        const parentMap = itemsToMap(orderRow.items);
        const valueMap = {
          ...parentMap,
          ...singleEntry,
          ...(row.items || {}),
          "CUSTOMER NAME": parentMap["CUSTOMER NAME"] || "",
          "PART NO": parentMap["PART NO"] || "",
          "PO NO": parentMap["PO NO"] || "",
        };

        const items = buildOrderedItems(headers, valueMap);
        const result = await createProcessRow(
          processId,
          items,
          sourceRowId,
          userId,
        );
        created += 1;
        if (result.closed) closedOrders += 1;
      } catch (err) {
        failed.push({
          index: i,
          message: err.message || "Failed to create docket",
        });
      }
    }
  } else {
    return next(new ErrorHandler(`Unsupported bulk mode: ${config.mode}`, 400));
  }

  res.status(200).json({
    success: true,
    created,
    updated,
    closedOrders,
    failed,
  });
});
