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

  // Load create-target process (config.processId) so Incoming page gets QI headers
  const createProcessId = config.processId || processId;
  const target = await Process.findOne({ processId: createProcessId }).select(
    "headers process processId",
  );
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
      instructions: config.instructions || "",
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

  // Fetch filter validation (blankMultiCreate + optional-filter parentFetchCreate)
  if ((config.filterHeaders || []).length) {
    if (config.filtersOptional) {
      // PR/R/003 / PR/R/003A: any subset; require at least one filled
      const hasAny = (config.filterHeaders || []).some((key) => {
        const val = filters?.[key];
        return val !== undefined && val !== null && String(val).trim() !== "";
      });
      if (!hasAny) {
        return next(
          new ErrorHandler(
            `Enter at least one filter (${(config.filterHeaders || []).join(", ")})`,
            400,
          ),
        );
      }
    } else if (config.mode === "blankMultiCreate") {
      // Quotation: all configured filterHeaders required
      for (const key of config.filterHeaders || []) {
        const val = filters?.[key];
        if (val === undefined || val === null || String(val).trim() === "") {
          return next(
            new ErrorHandler(
              `Filter "${key}" is required to fetch records for edit`,
              400,
            ),
          );
        }
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

  const excludeByParentValues = (row) => {
    const excludes = config.excludeParentValues || {};
    for (const [key, banned] of Object.entries(excludes)) {
      const item = (row.items || []).find((i) => i.key === key);
      const val = String(item?.value ?? "").trim().toUpperCase();
      const list = Array.isArray(banned) ? banned : [banned];
      if (
        list.some(
          (b) => String(b ?? "").trim().toUpperCase() === val,
        )
      ) {
        return false;
      }
    }
    return true;
  };

  const matched = (source.data || [])
    .filter(matchFilters)
    .filter(excludeByParentValues);
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

  // Create-target process (may differ from page processId, e.g. Incoming → QI)
  const createProcessId = config.processId || processId;
  const target = await Process.findOne({ processId: createProcessId });
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
          await updateProcessRow(createProcessId, row.rowId, items, userId);
          updated += 1;
        } else {
          await createProcessRow(createProcessId, items, null, userId);
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
          throw new Error("sourceRowId (parent row id) is required");
        }

        if (createProcessId === "MS/R/006A") {
          const deliveryQty = Number(row.items?.["DELIVERY QTY"] ?? 0);
          if (!(deliveryQty > 0)) {
            throw new Error("DELIVERY QTY must be greater than 0");
          }

          const orderProcess = await Process.findOne({ processId: "MS/R/006" });
          const orderRow =
            orderProcess?.data?.id?.(sourceRowId) ||
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
            createProcessId,
            items,
            sourceRowId,
            userId,
          );
          created += 1;
          if (result.closed) closedOrders += 1;
        } else if (createProcessId === "PR/R/003A") {
          const qty = Number(row.items?.["QTY"] ?? 0);
          if (!(qty > 0)) {
            throw new Error("QTY must be greater than 0");
          }

          const procurementProcess = await Process.findOne({
            processId: "PR/R/003",
          });
          const parentRow =
            procurementProcess?.data?.id?.(sourceRowId) ||
            procurementProcess?.data?.find(
              (r) => r._id.toString() === sourceRowId.toString(),
            );
          if (!parentRow) {
            throw new Error("Parent procurement row not found");
          }

          const parentMap = itemsToMap(parentRow.items);
          const pendingQty = Number(
            parentMap["PENDING QTY"] ?? parentMap["QTY"] ?? 0,
          );
          if (pendingQty > 0 && qty > pendingQty) {
            throw new Error(
              `QTY (${qty}) exceeds PENDING QTY (${pendingQty})`,
            );
          }

          const valueMap = {
            ...singleEntry,
            ...(row.items || {}),
            "ITEM NAME":
              singleEntry["ITEM NAME"] || parentMap["ITEM NAME"] || "",
            "VENDOR NAME":
              singleEntry["VENDOR NAME"] ||
              parentMap["VENDOR-NAME"] ||
              parentMap["VENDOR NAME"] ||
              "",
            "PO NO":
              singleEntry["PO NO"] || parentMap["PO NO"] || "",
          };

          const items = buildOrderedItems(headers, valueMap);
          await createProcessRow(createProcessId, items, sourceRowId, userId);
          created += 1;
        } else if (createProcessId === "QA/R/003A") {
          const incomingProcess = await Process.findOne({
            processId: "QA/R/003",
          });
          const parentRow =
            incomingProcess?.data?.id?.(sourceRowId) ||
            incomingProcess?.data?.find(
              (r) => r._id.toString() === sourceRowId.toString(),
            );
          if (!parentRow) {
            throw new Error("Parent Incoming Inspection row not found");
          }

          const parentMap = itemsToMap(parentRow.items);
          const status = String(
            parentMap["INSPECTION-STATUS"] ?? "",
          ).trim();
          if (status.toUpperCase() === "DONE") {
            throw new Error(
              "Incoming Inspection row is already Done; skip or refresh Fetch",
            );
          }

          const valueMap = {
            ...singleEntry,
            ...(row.items || {}),
          };
          const items = buildOrderedItems(headers, valueMap);
          // Store as string so Done intersection can match rowDataId === parent._id.toString()
          const parentIdStr = sourceRowId.toString();
          await createProcessRow(createProcessId, items, parentIdStr, userId);
          created += 1;

          if (config.markParentDone) {
            try {
              const updatedItems = (parentRow.items || []).map((it) => {
                const plain = it.toObject?.() || { ...it };
                if (plain.key === "INSPECTION-STATUS") {
                  return { ...plain, value: "Done" };
                }
                return plain;
              });
              const hasStatus = updatedItems.some(
                (it) => it.key === "INSPECTION-STATUS",
              );
              if (!hasStatus) {
                updatedItems.push({
                  key: "INSPECTION-STATUS",
                  value: "Done",
                  process: "select",
                });
              }
              await updateProcessRow(
                "QA/R/003",
                parentIdStr,
                updatedItems,
                userId,
              );
            } catch (markErr) {
              throw new Error(
                `Quality Inspection created, but failed to mark Incoming Done: ${
                  markErr.message || "unknown error"
                }`,
              );
            }
          }
        } else {
          throw new Error(
            `Unsupported parentFetchCreate process: ${createProcessId}`,
          );
        }
      } catch (err) {
        failed.push({
          index: i,
          message: err.message || "Failed to create child row",
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
