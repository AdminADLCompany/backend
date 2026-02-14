// utils/intersection.js
const Process = require("../models/process");
const History = require("../models/history");

const ErrorHandler = require("../utils/errorHandler");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");

function toMinutes(t) {
  if (!t || t === "nil" || typeof t !== "string") return null;
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

const linkProcessIdItems = async (rowItems) => {
  if (!rowItems || !Array.isArray(rowItems)) return rowItems;
  for (const item of rowItems) {
    if (item.process === "processId" && item.value) {
      const relatedProcess = await Process.findOne({ processId: item.value });
      if (relatedProcess?._id) {
        item.value = `processId - ${relatedProcess._id}`;
        item.process = "";
      }
    }
  }
  return rowItems;
};

exports.handleAddIntersection = async (process, items, rowDataId, userId) => {
  try {
    if (!Array.isArray(items))
      return { success: false, message: "Items must be an array" };
    // ---- MR/R/003B (Action Taken -> Rework) ----
    if (process.processId === "MR/R/003B") {
      const moveToItem = items.find((i) => i.key === "MOVE TO");

      if (moveToItem && moveToItem.value === "Rework") {
        const rejectionProcess = await Process.findOne({
          processId: "MR/R/003",
        });

        if (!rejectionProcess) {
          return {
            success: false,
            message: "Rejection Process (MR/R/003) not found",
            statusCode: 404,
          };
        }

        const rejectionRow = rejectionProcess.data.id(rowDataId);

        if (!rejectionRow) {
          return {
            success: false,
            message: `Row with ID ${rowDataId} not found in MR/R/003`,
            statusCode: 404,
          };
        }

        const partNo = rejectionRow.items.find(
          (i) => i.key === "PART NO",
        )?.value;
        const partName = rejectionRow.items.find(
          (i) => i.key === "PART NAME",
        )?.value;
        const problemDesc = rejectionRow.items.find(
          (i) => i.key === "PROBLEM DESCRIPTION",
        )?.value;
        const rejectStage = rejectionRow.items.find(
          (i) => i.key === "REJECT STAGE",
        )?.value;
        const rejectQty =
          rejectionRow.items.find((i) => i.key === "REJECT QTY")?.value || 0;

        const verifiedBy = items.find((i) => i.key === "VERIFIED BY")?.value;
        const status = items.find((i) => i.key === "ACTION PLAN STATUS")?.value;

        const reworkProcess = await Process.findOne({
          processId: "MR/R/003A",
        });

        if (!reworkProcess) {
          return {
            success: false,
            message: "Rework Process (MR/R/003A) not found",
            statusCode: 404,
          };
        }

        let reworkRow = {
          items: [
            { key: "PART NO", value: partNo, process: "value" },
            { key: "PART NAME", value: partName, process: "value" },
            {
              key: "PROBLEM DESCRIPTION",
              value: problemDesc,
              process: "value",
            },
            { key: "REWORK QTY", value: rejectQty, process: "value" },
            { key: "REJECT STAGE", value: rejectStage, process: "value" },
            {
              key: "ACTION PLAN",
              value: "QA/R/007A",
              process: "processId",
            },
            { key: "VERIFIED BY", value: verifiedBy, process: "value" },
            { key: "STATUS", value: status, process: "value" },
          ],
          rowDataId,
        };

        // Link internal process IDs safely
        reworkRow.items = await linkProcessIdItems(reworkRow.items);

        // Push row into rework process
        reworkProcess.data.push(reworkRow);
        reworkProcess.updatedBy = userId;
        await reworkProcess.save();

        // Log history
        await History.create({
          collectionName: "Process",
          documentId: reworkProcess._id,
          rowId: reworkProcess.data[reworkProcess.data.length - 1]._id,
          operation: "create",
          oldData: null,
          newData: reworkRow,
          changedBy: userId,
        });
      }
    }

    // ---- PR/R/003A → QA/R/003A ---- Procurement → Inspection
    else if (process.processId === "PR/R/003A") {
      const inspectionProcess = await Process.findOne({
        processId: "QA/R/003",
      });
      const procurementProcess = await Process.findOne({
        processId: "PR/R/003",
      });

      if (!inspectionProcess)
        return {
          success: false,
          message: "Inspection Process (QA/R/003) not found",
          statusCode: 404,
        };
      if (!procurementProcess)
        return {
          success: false,
          message: "Procurement Process (PR/R/003) not found",
          statusCode: 404,
        };

      const procurementRow = procurementProcess.data.find(
        (row) => row._id.toString() === rowDataId,
      );
      if (!procurementRow)
        return {
          success: false,
          message: "Procurement row not found",
          statusCode: 404,
        };

      const isMoving = items.find(
        (i) => i.key === "QC QUALITY INSPECTION",
      )?.value;
      if (isMoving !== "Move to Inspection") return { success: true };

      const inspectionRow = {
        items: [
          {
            key: "PART NO",
            value: procurementRow.items.find((i) => i.key === "PART NO")?.value,
            process: "value",
          },
          {
            key: "PART NAME",
            value: procurementRow.items.find((i) => i.key === "PART NAME")
              ?.value,
            process: "value",
          },
          {
            key: "ITEM CATEGORY",
            value: procurementRow.items.find((i) => i.key === "ITEM CATEGORY")
              ?.value,
            process: "value",
          },
          {
            key: "ITEM CODE",
            value: procurementRow.items.find((i) => i.key === "ITEM CODE")
              ?.value,
            process: "value",
          },
          {
            key: "ITEM NAME",
            value: procurementRow.items.find((i) => i.key === "ITEM NAME")
              ?.value,
            process: "value",
          },
          {
            key: "GRADE",
            value: procurementRow.items.find((i) => i.key === "GRADE")?.value,
            process: "value",
          },
          {
            key: "QTY",
            value: items.find((i) => i.key === "QTY")?.value,
            process: "value",
          },
          {
            key: "UNITS",
            value: procurementRow.items.find((i) => i.key === "UNITS")?.value,
            process: "value",
          },
          {
            key: "VENDOR NAME",
            value: procurementRow.items.find((i) => i.key === "VENDOR-NAME")
              ?.value,
            process: "value",
          },
          {
            key: "INVOICE NO",
            value: items.find((i) => i.key === "INVOICE NO")?.value,
            process: "value",
          },
          {
            key: "DELIVERY DATE",
            value: items.find((i) => i.key === "DELIVERY DATE")?.value,
            process: "date",
          },
          {
            key: "QUALITY INSPECTION",
            value: "QA/R/003A",
            process: "processId",
          },
          { key: "INSPECTION-STATUS", value: "", process: "select" },
        ],
        rowDataId,
      };

      inspectionRow.items = await linkProcessIdItems(inspectionRow.items);
      inspectionProcess.data.push(inspectionRow);
      inspectionProcess.updatedBy = userId;
      await inspectionProcess.save();
    }

    // ---- MR/R/001 → PR/R/003 ---- Production Plan → Procurement Register
    else if (process.processId === "MR/R/001") {
      const procurementRegisterProcess = await Process.findOne({
        processId: "PR/R/003",
      });
      const itemListProcess = await Process.findOne({ processId: "PR/R/002" });
      const vendorListProcess = await Process.findOne({
        processId: "PR/R/004",
      });
      const BOM = await Process.findOne({ processId: "DD/R/002" });
      const Products = await Process.findOne({ processId: "DD/R/002A" });

      if (!procurementRegisterProcess)
        return {
          success: false,
          message: "Procurement Register (PR/R/003) not found",
          statusCode: 404,
        };
      if (!BOM)
        return {
          success: false,
          message: "BOM (DD/R/002) not found",
          statusCode: 404,
        };
      if (!Products)
        return {
          success: false,
          message: "Products (DD/R/002A) not found",
          statusCode: 404,
        };

      const MoveItem = items.find((i) => i.key === "RM")?.value;
      if (MoveItem !== "Planning") return { success: true };

      const planNo = items.find((i) => i.key === "PLAN NO")?.value;
      const date = items.find((i) => i.key === "DATE")?.value;
      const partNo = items.find((i) => i.key === "PART-NO")?.value;
      const partName = items.find((i) => i.key === "PART-NAME")?.value;
      const type = items.find((i) => i.key === "TYPE")?.value;
      const material = items.find((i) => i.key === "MATERIAL")?.value;
      const planQty = parseFloat(
        items.find((i) => i.key === "PLAN QTY")?.value || 0,
      );

      const bomDict = Object.fromEntries(
        BOM.data.map((b) => [b._id.toString(), b]),
      );
      const matchingProducts = Products.data.filter((productRow) => {
        const p = Object.fromEntries(
          productRow.items.map((i) => [i.key, i.value]),
        );
        return (
          p["PART NO"] === partNo &&
          p["PART NAME"] === partName &&
          p["TYPE"] === type &&
          p["MATERIAL"] === material
        );
      });

      for (const productRow of matchingProducts) {
        const detailingIds =
          productRow.items.find((i) => i.key === "DETAILING PRODUCT")?.value ||
          [];
        for (const bomId of detailingIds) {
          const bomRow = bomDict[bomId.toString()];
          if (!bomRow) continue;

          const b = Object.fromEntries(
            bomRow.items.map((i) => [i.key, i.value]),
          );
          const totalQty = parseFloat(b["QTY"] || 0) * planQty;

          const inputItemCode = b["ITEM CODE"];
          const matchRow = itemListProcess.data.find((itemRow) => {
            const rowItemCode = itemRow.items
              .find((i) => i.key === "ITEM CODE")
              ?.value?.trim();
            return rowItemCode === inputItemCode;
          });

          let procurementRegisterRow = {
            items: [
              { key: "DATE", value: date, process: "date" },
              { key: "PL NO", value: planNo },
              { key: "PART NO", value: partNo },
              { key: "PART NAME", value: partName },
              { key: "TYPE", value: type },
              { key: "MATERIAL", value: material },
              {
                key: "ITEM CATEGORY",
                value:
                  matchRow.items.find((i) => i.key === "ITEM CATEGORY")
                    ?.value || "",
              },
              { key: "ITEM CODE", value: b["ITEM CODE"] },
              { key: "ITEM NAME", value: b["ITEM-NAME"] },
              { key: "GRADE", value: b["GRADE"] },
              { key: "QTY", value: totalQty.toString() },
              { key: "UNITS", value: b["UNITS"] },
              { key: "VENDOR NAME", value: "" },
              { key: "VALUE", value: "" },
              { key: "PO NO", value: "" },
              { key: "LEAD TIME", value: "" },
              { key: "INWARD", value: "PR/R/003A", process: "processId" },
              { key: "PR STATUS", value: "" },
            ],
            rowDataId,
          };

          procurementRegisterRow.items = await linkProcessIdItems(
            procurementRegisterRow.items,
          );
          procurementRegisterProcess.data.push(procurementRegisterRow);
        }
      }

      procurementRegisterProcess.updatedBy = userId;
      await procurementRegisterProcess.save();
    }

    // ---- DD/R/002 ---- Product Code Generation

    // ---- PR/R/002 → ST/R/006 ---- Item List → Stock Data
    else if (process.processId === "PR/R/002") {
      const stockDataProcess = await Process.findOne({ processId: "ST/R/006" });
      if (!stockDataProcess)
        return {
          success: false,
          message: "Stock Data Process (ST/R/006) not found",
          statusCode: 404,
        };

      const itemName = items.find((i) => i.key === "ITEM NAME")?.value;
      const itemCode = items.find((i) => i.key === "ITEM CODE")?.value;
      const itemCategory = items.find((i) => i.key === "ITEM CATEGORY")?.value;

      const stockDataRow = {
        items: [
          { key: "ITEM CATEGORY", value: itemCategory, process: "value" },
          { key: "ITEM CODE", value: itemCode, process: "value" },
          { key: "ITEM NAME", value: itemName, process: "value" },
          { key: "IN", value: "0", process: "value" },
          { key: "OUT", value: "0", process: "value" },
          { key: "STOCK", value: "0", process: "value" },
        ],
        rowDataId,
      };

      stockDataProcess.data.push(stockDataRow);
      stockDataProcess.updatedBy = userId;
      await stockDataProcess.save();
    }

    // ---- MR/R/006 → ST/R/005 ---- Dispatch -> Store Register ----
    else if (process.processId === "MR/R/006") {
      const storeRegisterProcess = await Process.findOne({
        processId: "ST/R/005",
      });
      const productsProcess = await Process.findOne({ processId: "DD/R/002A" });
      const stockDataProcess = await Process.findOne({ processId: "ST/R/006" });
      const itemListProcess = await Process.findOne({ processId: "PR/R/002" });
      const bomProcess = await Process.findOne({ processId: "DD/R/002" });

      if (
        !storeRegisterProcess ||
        !itemListProcess ||
        !productsProcess ||
        !bomProcess ||
        !stockDataProcess
      )
        return {
          success: false,
          message:
            "Required processes (ST/R/005, PR/R/002, DD/R/002A, DD/R/002, ST/R/006) not found",
          statusCode: 404,
        };

      const inputCode = (
        items.find((i) => i.key === "PART-NO") ||
        items.find((i) => i.key === "PART NO")
      )?.value;
      const quantityValue = items.find((i) => i.key === "QTY")?.value;
      const quantity = parseFloat(quantityValue || 0);
      const date = items.find((i) => i.key === "DATE")?.value;
      const dcNo = items.find((i) => i.key === "DC NO")?.value;

      const matchedProductRow = productsProcess.data.find((productRow) => {
        const p = Object.fromEntries(
          productRow.items.map((i) => [i.key, i.value]),
        );
        return p["PART NO"] === inputCode;
      });

      if (!matchedProductRow)
        return {
          success: false,
          message: "Product not found in Products Process (DD/R/002A)",
          statusCode: 404,
        };

      // 1. Process "IN" for the Finished Good
      const matchedRow = itemListProcess.data.find((itemRow) => {
        const rowItemCode = itemRow.items.find(
          (i) => i.key === "ITEM CODE",
        )?.value;
        return rowItemCode === inputCode;
      });

      if (matchedRow) {
        const itemName = matchedRow.items.find(
          (i) => i.key === "ITEM NAME",
        )?.value;
        const itemCode = matchedRow.items.find(
          (i) => i.key === "ITEM CODE",
        )?.value;
        const itemCategory = matchedRow.items.find(
          (i) => i.key === "ITEM CATEGORY",
        )?.value;

        const storeRegisterRow = {
          items: [
            { key: "DATE", value: date, process: "value" },
            { key: "IN / OUT", value: "IN", process: "value" },
            {
              key: "ITEM CATEGORY",
              value: itemCategory || "",
              process: "value",
            },
            { key: "ITEM CODE", value: itemCode || "", process: "value" },
            { key: "ITEM NAME", value: itemName || "", process: "value" },
            { key: "VENDOR / CUSTOMER", value: "In House", process: "value" },
            { key: "QTY", value: quantityValue, process: "value" },
            { key: "DOC &REPORT NO", value: dcNo, process: "value" },
          ],
          rowDataId,
        };

        storeRegisterProcess.data.push(storeRegisterRow);

        // Update Stock for Finished Good (IN)
        let stockRow = stockDataProcess.data.find(
          (r) => r.items.find((i) => i.key === "ITEM CODE")?.value === itemCode,
        );

        if (stockRow) {
          const inItem = stockRow.items.find((i) => i.key === "IN");
          const outItem = stockRow.items.find((i) => i.key === "OUT");
          const stockItem = stockRow.items.find((i) => i.key === "STOCK");

          const currentIn = parseFloat(inItem?.value || 0);
          const currentOut = parseFloat(outItem?.value || 0);

          const newIn = currentIn + quantity;
          if (inItem) inItem.value = newIn.toString();
          if (stockItem) stockItem.value = (newIn - currentOut).toString();
        } else {
          stockDataProcess.data.push({
            items: [
              {
                key: "ITEM CATEGORY",
                value: itemCategory || "",
                process: "value",
              },
              { key: "ITEM CODE", value: itemCode || "", process: "value" },
              { key: "ITEM NAME", value: itemName || "", process: "value" },
              { key: "IN", value: quantityValue, process: "value" },
              { key: "OUT", value: "0", process: "value" },
              { key: "STOCK", value: quantityValue, process: "value" },
            ],
            rowDataId,
          });
        }
      }

      // 2. Process "OUT" for BOM Components
      const detailingIds =
        matchedProductRow.items.find((i) => i.key === "DETAILING PRODUCT")
          ?.value || [];

      for (const bomId of detailingIds) {
        const bomRow = bomProcess.data.id(bomId);
        if (!bomRow) continue;

        const b = Object.fromEntries(bomRow.items.map((i) => [i.key, i.value]));
        const bomQty = parseFloat(b["QTY"] || 0);
        const totalOutQty = bomQty * quantity;

        const bomItemCode = b["ITEM CODE"];
        const bomItemName = b["ITEM-NAME"];

        const compItemRow = itemListProcess.data.find(
          (r) =>
            r.items.find((i) => i.key === "ITEM CODE")?.value === bomItemCode,
        );
        const bomItemCategory =
          compItemRow?.items.find((i) => i.key === "ITEM CATEGORY")?.value ||
          "";

        // Add to Store Register (OUT)
        storeRegisterProcess.data.push({
          items: [
            { key: "DATE", value: date, process: "value" },
            { key: "IN / OUT", value: "OUT", process: "value" },
            { key: "ITEM CATEGORY", value: bomItemCategory, process: "value" },
            { key: "ITEM CODE", value: bomItemCode, process: "value" },
            { key: "ITEM NAME", value: bomItemName, process: "value" },
            { key: "VENDOR / CUSTOMER", value: "In House", process: "value" },
            { key: "QTY", value: totalOutQty.toString(), process: "value" },
            { key: "DOC &REPORT NO", value: dcNo, process: "value" },
          ],
          rowDataId,
        });

        // Update Stock for Component (OUT)
        let compStockRow = stockDataProcess.data.find(
          (r) =>
            r.items.find((i) => i.key === "ITEM CODE")?.value === bomItemCode,
        );

        if (compStockRow) {
          const inItem = compStockRow.items.find((i) => i.key === "IN");
          const outItem = compStockRow.items.find((i) => i.key === "OUT");
          const stockItem = compStockRow.items.find((i) => i.key === "STOCK");

          const currentIn = parseFloat(inItem?.value || 0);
          const currentOut = parseFloat(outItem?.value || 0);

          const newOut = currentOut + totalOutQty;
          if (outItem) outItem.value = newOut.toString();
          if (stockItem) stockItem.value = (currentIn - newOut).toString();
        } else {
          stockDataProcess.data.push({
            items: [
              {
                key: "ITEM CATEGORY",
                value: bomItemCategory,
                process: "value",
              },
              { key: "ITEM CODE", value: bomItemCode, process: "value" },
              { key: "ITEM NAME", value: bomItemName, process: "value" },
              { key: "IN", value: "0", process: "value" },
              { key: "OUT", value: totalOutQty.toString(), process: "value" },
              {
                key: "STOCK",
                value: (-totalOutQty).toString(),
                process: "value",
              },
            ],
            rowDataId,
          });
        }
      }

      storeRegisterProcess.updatedBy = userId;
      stockDataProcess.updatedBy = userId;
      await storeRegisterProcess.save();
      await stockDataProcess.save();
    }

    // ---- MS/R/006 → ST/R/005 ---- Order List -> Store Register ----
    else if (process.processId === "MS/R/006") {
      const storeRegisterProcess = await Process.findOne({
        processId: "ST/R/005",
      });
      const stockDataProcess = await Process.findOne({ processId: "ST/R/006" });

      const matchedRow = storeRegisterProcess.data.find((itemRow) => {
        const rowItemCode = itemRow.items.find(
          (i) => i.key === "ITEM CODE",
        )?.value;
        return rowItemCode === items.find((i) => i.key === "PART NO")?.value;
      });

      if (!matchedRow || !storeRegisterProcess)
        return {
          success: false,
          message: "Item not found in Store Register Process (ST/R/005)",
          statusCode: 404,
        };

      const storeRegisterRow = {
        items: [
          {
            key: "DATE",
            value: items.find((i) => i.key === "DATE")?.value,
            process: "value",
          },
          {
            key: "IN / OUT",
            value: "OUT",
            process: "value",
          },
          {
            key: "ITEM CATEGORY",
            value: matchedRow.items.find((i) => i.key === "ITEM CATEGORY")
              ?.value,
            process: "value",
          },
          {
            key: "ITEM CODE",
            value: matchedRow.items.find((i) => i.key === "ITEM CODE")?.value,
            process: "value",
          },
          {
            key: "ITEM NAME",
            value: matchedRow.items.find((i) => i.key === "ITEM NAME")?.value,
            process: "value",
          },
          {
            key: "VENDOR / CUSTOMER",
            value: matchedRow.items.find((i) => i.key === "VENDOR / CUSTOMER")
              ?.value,
            process: "value",
          },
          {
            key: "QTY",
            value: items.find((i) => i.key === "QTY")?.value,
            process: "value",
          },
          {
            key: "DOC &REPORT NO",
            value: items.find((i) => i.key === "DC NO")?.value,
            process: "value",
          },
        ],
        rowDataId,
      };

      storeRegisterProcess.data.push(storeRegisterRow);
      storeRegisterProcess.updatedBy = userId;

      if (stockDataProcess) {
        // 🧩 Use PART NO as the item code reference
        const itemCode = items.find((i) => i.key === "PART NO")?.value;
        const qty = Number(items.find((i) => i.key === "QTY")?.value || 0);

        if (!itemCode)
          return {
            success: false,
            message: "Item code not found",
            statusCode: 404,
          };

        // 🔍 Find existing stock entry for this item
        const existingStockRow = stockDataProcess.data.find(
          (r) => r.items.find((i) => i.key === "ITEM CODE")?.value === itemCode,
        );

        if (existingStockRow) {
          // 🟠 Update existing stock entry (OUT operation)
          const inItem = existingStockRow.items.find((i) => i.key === "IN");
          const outItem = existingStockRow.items.find((i) => i.key === "OUT");
          const stockItem = existingStockRow.items.find(
            (i) => i.key === "STOCK",
          );

          const currentIn = Number(inItem?.value || 0);
          const currentOut = Number(outItem?.value || 0);

          const newOut = currentOut + qty;
          const newStock = currentIn - newOut; // stock decreases when OUT happens

          // Update values safely
          if (outItem) outItem.value = newOut.toString();
          if (stockItem) stockItem.value = newStock.toString();

          stockDataProcess.updatedBy = userId;
        } else {
          // 🆕 Create new stock entry (first-time OUT)
          const itemCategory =
            items.find((i) => i.key === "ITEM CATEGORY")?.value || "";
          const itemName =
            items.find((i) => i.key === "ITEM NAME")?.value || "";

          const newStock = 0 - qty; // negative or zero stock indicates outgoing only

          const newStockRow = {
            items: [
              { key: "ITEM CATEGORY", value: itemCategory, process: "value" },
              { key: "ITEM CODE", value: itemCode, process: "value" },
              { key: "ITEM NAME", value: itemName, process: "value" },
              { key: "IN", value: "0", process: "value" },
              { key: "OUT", value: qty.toString(), process: "value" },
              { key: "STOCK", value: newStock.toString(), process: "value" },
            ],
            rowDataId: rowDataId,
          };

          stockDataProcess.data.push(newStockRow);
          stockDataProcess.updatedBy = userId;
        }
      }

      // Save both processes only if check passes
      await storeRegisterProcess.save();
      if (stockDataProcess) await stockDataProcess.save();
    } else if (process.processId === "MS/R/006A") {
      const itemListProcess = await Process.findOne({
        processId: "PR/R/002",
      });
      const orderProcess = await Process.findOne({
        processId: "MS/R/006",
      });
      const storeRegisterProcess = await Process.findOne({
        processId: "ST/R/005",
      });
      const stockDataProcess = await Process.findOne({ processId: "ST/R/006" });
      if (
        !storeRegisterProcess ||
        !stockDataProcess ||
        !orderProcess ||
        !itemListProcess
      )
        return {
          success: false,
          message: "Required processes not found",
          statusCode: 404,
        };

      const quantityVal = items.find((i) => i.key === "DELIVERY QTY")?.value;
      const quantity = parseFloat(quantityVal || 0);

      const orderRow = orderProcess.data.find(
        (row) => row._id.toString() === rowDataId.toString(),
      );
      if (!orderRow)
        return {
          success: false,
          message: "No order row found",
          statusCode: 404,
        };

      const itemCode = orderRow.items.find(
        (item) => item.key === "PART NO",
      )?.value;

      const itemListRow = itemListProcess.data.find(
        (row) =>
          row.items.find((item) => item.key === "ITEM CODE")?.value ===
          itemCode,
      );
      if (!itemListRow)
        return {
          success: false,
          message: "No item list row found",
          statusCode: 404,
        };

      const itemName = itemListRow.items.find(
        (i) => i.key === "ITEM NAME",
      )?.value;
      const itemCategory = itemListRow.items.find(
        (i) => i.key === "ITEM CATEGORY",
      )?.value;
      const date = items.find((i) => i.key === "DELIVERY DATE")?.value;
      // const dcNo = items.find((i) => i.key === "DC NO")?.value;

      const storeRegisterRow = {
        items: [
          { key: "DATE", value: date, process: "value" },
          { key: "IN / OUT", value: "OUT", process: "value" },
          { key: "ITEM CATEGORY", value: itemCategory || "", process: "value" },
          { key: "ITEM CODE", value: itemCode || "", process: "value" },
          { key: "ITEM NAME", value: itemName || "", process: "value" },
          { key: "VENDOR / CUSTOMER", value: "Customer", process: "value" },
          { key: "QTY", value: quantityVal, process: "value" },
          { key: "DOC &REPORT NO", value: "MS/R/006A", process: "value" },
        ],
        rowDataId,
      };

      storeRegisterProcess.data.push(storeRegisterRow);
      storeRegisterProcess.updatedBy = userId;

      // Update Stock (OUT)
      let stockRow = stockDataProcess.data.find(
        (r) => r.items.find((i) => i.key === "ITEM CODE")?.value === itemCode,
      );

      if (stockRow) {
        const inItem = stockRow.items.find((i) => i.key === "IN");
        const outItem = stockRow.items.find((i) => i.key === "OUT");
        const stockItem = stockRow.items.find((i) => i.key === "STOCK");

        const currentIn = parseFloat(inItem?.value || 0);
        const currentOut = parseFloat(outItem?.value || 0);

        const newOut = currentOut + quantity;
        if (outItem) outItem.value = newOut.toString();
        if (stockItem) stockItem.value = (currentIn - newOut).toString();
      } else {
        stockDataProcess.data.push({
          items: [
            {
              key: "ITEM CATEGORY",
              value: itemCategory || "",
              process: "value",
            },
            { key: "ITEM CODE", value: itemCode || "", process: "value" },
            { key: "ITEM NAME", value: itemName || "", process: "value" },
            { key: "IN", value: "0", process: "value" },
            { key: "OUT", value: quantity.toString(), process: "value" },
            { key: "STOCK", value: (-quantity).toString(), process: "value" },
          ],
          rowDataId,
        });
      }
      stockDataProcess.updatedBy = userId;

      await storeRegisterProcess.save();
      await stockDataProcess.save();
    }

    // ---- MR/R/002A -> MR/R/002 (OEE Calculation) ----
    else if (process.processId === "MR/R/002A") {
      const breakHourProcess = await Process.findOne({
        processId: "MR/R/002B",
      });
      const productionReportProcess = await Process.findOne({
        processId: "MR/R/002",
      });
      if (!breakHourProcess || !productionReportProcess)
        return {
          success: false,
          message: "No production report or Break Process Found",
          statusCode: 404,
        };

      // find the matchrow of the production report by _id of the each data row with rowDataId we have now 69197d26a7e0a3fff476f0b2
      const productionReportRow = productionReportProcess.data.find(
        (row) => row._id.toString() === rowDataId.toString(),
      );

      // if (!productionReportRow) throw new Error("No production report row found");
      if (!productionReportRow)
        return {
          success: false,
          message: "No production report row found",
          statusCode: 404,
        };

      const start = toMinutes(
        productionReportRow.items.find((i) => i.key === "START TIME")?.value,
      );
      const endRaw = toMinutes(
        productionReportRow.items.find((i) => i.key === "END TIME")?.value,
      );
      const settingColor = productionReportRow.items.find(
        (i) => i.key === "SETTING",
      );

      const status = items.find((i) => i.key === "STATUS OF SETTINGS")?.value;

      if (status === "No") {
        settingColor.process = "blue";
      } else if (status === "Completed") {
        settingColor.process = "green";
      } else if (status === "Under Process") {
        settingColor.process = "orange";
      } else {
        settingColor.process = "yellow";
      }

      const end = endRaw < start ? endRaw + 1440 : endRaw;

      const settings = items.find((i) => i.key === "SETTING TIME")?.value;
      const setupLoss = items.find((i) => i.key === "SET UP LOSS")?.value;

      const totalTime =
        Number(productionReportRow.items.find((i) => i.key === "PLAN")?.value) *
        Number(
          productionReportRow.items.find((i) => i.key === "CYCLE TIME")?.value,
        );

      const actualPlan =
        (totalTime - (settings || 0)) /
        Number(
          productionReportRow.items.find((i) => i.key === "CYCLE TIME")?.value,
        );

      const planItem = productionReportRow.items.find((i) => i.key === "PLAN");
      const actualItem = productionReportRow.items.find(
        (i) => i.key === "ACTUAL",
      )?.value;
      const cycleTime = productionReportRow.items.find(
        (i) => i.key === "CYCLE TIME",
      )?.value;
      const reject = Number(
        productionReportRow.items.find((i) => i.key === "REJECT")?.value || 0,
      );
      const breakHour = productionReportRow.items.find(
        (i) => i.key === "BREAK HOUR",
      );
      const oeeItem = productionReportRow.items.find((i) => i.key === "OEE");

      let valueOfProcess =
        (Number(actualPlan) - Number(actualItem)) * Number(cycleTime);
      let oeeCalculation =
        (((Number(actualItem) / Number(actualPlan)) *
          ((Number(actualItem) - reject) / Number(actualItem)) *
          (totalTime - valueOfProcess)) /
          totalTime) *
        100;

      if (!planItem)
        return {
          success: false,
          message: "PLAN field not found",
          statusCode: 404,
        };
      breakHour.process = valueOfProcess.toString();
      planItem.value = actualPlan.toString();
      oeeItem.value = Math.floor(oeeCalculation).toString();

      productionReportProcess.markModified("data");
      productionReportProcess.updatedBy = userId;

      await productionReportProcess.save();

      // ---- BREAK VALUES ----
      const breakValues = {};
      sceduledLoss.forEach((b) => {
        if (b.from === "nil" || b.to === "nil") return;

        let bStart = toMinutes(b.from);
        let bEnd = toMinutes(b.to);
        if (bEnd < bStart) bEnd += 1440;

        if (bStart < end && bEnd > start) {
          const key = b.label.toUpperCase();
          breakValues[key] = (breakValues[key] || 0) + b.time;
        }
      });

      // ---- FINAL ROW ----
      const asVal = (k) => breakValues[k] || 0;

      const newItems = [
        { key: "DRM", value: asVal("DRM").toString(), process: "value" },
        {
          key: "TEA BREAK",
          value: asVal("TEA").toString(),
          process: "value",
        },
        { key: "FOOD", value: asVal("FOOD").toString(), process: "value" },
        {
          key: "INSPECTION",
          value: asVal("INSPECTION").toString(),
          process: "value",
        },
        {
          key: "PRAYER",
          value: asVal("PRAYER").toString(),
          process: "value",
        },
        {
          key: "COMMUNICATION",
          value: asVal("COMMUNICATION").toString(),
          process: "value",
        },
        {
          key: "SETTINGS",
          value: settings.toString() || "",
          process: "value",
        },
        {
          key: "SETUP LOSS",
          value: setupLoss.toString() || "",
          process: "value",
        },
        ...[
          "TOOL CHANGE",
          "VERIFICATION",
          "LOAD/ UNLOAD LOSS",
          "DEFECTS/ REWORK",
          "BREAKDOWN",
          "MAINTENANCE",
          "NO POWER",
          "NO MAN POWER",
          "NO SCHEDULE",
          "NO MATERIAL",
          "NO DRAWING",
          "NPD",
        ].map((k) => ({ key: k, value: "0", process: "value" })),
      ];

      // Checking if already break Hour exists.
      const matchRowOfbreakHour = breakHourProcess.data.find(
        (row) =>
          row.rowDataId && row.rowDataId.toString() === rowDataId.toString(),
      );

      if (matchRowOfbreakHour) {
        matchRowOfbreakHour.items = newItems;
        matchRowOfbreakHour.updatedAt = new Date(); // Ensure updated time is set if schema supports it
      } else {
        const breakHourRow = {
          rowDataId,
          items: newItems,
        };
        breakHourProcess.data.push(breakHourRow);
      }

      breakHourProcess.updatedBy = userId;
      await breakHourProcess.save();
    }

    // ---- MS/R/005 -> MS/R/006 ---- Order List -> Quotation list
    else if (process.processId === "MS/R/005") {
      const orderListProcess = await Process.findOne({
        processId: "MS/R/006",
      });

      const isMoving = items.find((i) => i.key === "QL STATUS")?.value;

      if (!orderListProcess)
        return {
          success: false,
          message: "No order list process found",
          statusCode: 404,
        };

      if (isMoving === "ORDER") {
        let orderListRow = {
          items: [
            {
              key: "DATE",
              value: items.find((i) => i.key === "DATE")?.value,
              process: "value",
            },
            {
              key: "QUOTE NO",
              value: items.find((i) => i.key === "QUOTATION NO")?.value,
              process: "value",
            },
            {
              key: "PART NO",
              value: items.find((i) => i.key === "PART-NO")?.value,
              process: "value",
            },
            {
              key: "PART NAME",
              value: items.find((i) => i.key === "PART-NAME")?.value,
              process: "value",
            },
            {
              key: "ENQ BY",
              value: items.find((i) => i.key === "ENQ BY")?.value,
              process: "value",
            },
            {
              key: "CUSTOMER NAME",
              value: items.find((i) => i.key === "CUSTOMER-NAME")?.value,
              process: "value",
            },
            {
              key: "LOCATION",
              value: items.find((i) => i.key === "LOCATION")?.value,
              process: "value",
            },
            {
              key: "DESCRIPTION",
              value: items.find((i) => i.key === "DESCRIPTION")?.value,
              process: "value",
            },
            {
              key: "QTY",
              value: items.find((i) => i.key === "QTY")?.value,
              process: "value",
            },
            {
              key: "UNITS",
              value: items.find((i) => i.key === "UNITS")?.value,
              process: "value",
            },
            {
              key: "VALUE",
              value: "",
              process: "value",
            },
            {
              key: "ORDER DATE",
              value: items.find((i) => i.key === "ORDER DATE")?.value,
              process: "value",
            },
            {
              key: "PO NO",
              value: items.find((i) => i.key === "PO NO")?.value,
              process: "value",
            },
            {
              key: "LEAD TIME",
              value: items.find((i) => i.key === "LEAD TIME")?.value,
              process: "value",
            },
            {
              key: "DOCKET",
              value: "MS/R/006A",
              process: "processId",
            },
            {
              key: "ORDER STATUS",
              value: "",
              process: "select",
            },
          ],
          rowDataId: rowDataId,
        };

        orderListRow.items = await linkProcessIdItems(orderListRow.items);

        orderListProcess.data.push(orderListRow);
        orderListProcess.updatedBy = userId;
        await orderListProcess.save();
      }
    } else if (process.processId === "DD/R/012") {
      const NPDRegisterProcess = await Process.findOne({
        processId: "DD/R/010",
      });

      // if (!NPDRegisterProcess)
      //   return {
      //     success: false,
      //     message: "NPD Register Process not found",
      //     statusCode: 404,
      //   };

      // const correspondingItem = NPDRegisterProcess.data.find(
      //   (d) => d._id.toString() === rowDataId.toString(),
      // );

      // if (!correspondingItem)
      //   return {
      //     success: false,
      //     message: "Corresponding NPD row not found",
      //     statusCode: 404,
      //   };

      // const protoItem = correspondingItem.items.find((i) => i.key === "PROTO");
      // const validationItem = correspondingItem.items.find(
      //   (i) => i.key === "VALIDATION",
      // );
      // const masterPieceItem = correspondingItem.items.find(
      //   (i) => i.key === "MASTER PIECE",
      // );

      // if (!protoItem)
      //   return {
      //     success: false,
      //     message: "PROTO item not found",
      //     statusCode: 404,
      //   };

      // const hasPending = items.some((i) => i.value === "Pending");
      // const hasInProgress = items.some((i) => i.value === "In Progress");
      // const allCompleted =
      //   items.length > 0 && items.every((i) => i.value === "Completed");

      // const validationColor = items.find((i) => i.key === "VALIDATION");
      // const masterColor = items.find((i) => i.key === "MASTER PIECE");

      // if (validationItem) {
      //   if (validationColor?.value === "Pending") {
      //     validationItem.process = "red";
      //   } else if (validationColor?.value === "In Progress") {
      //     validationItem.process = "orange";
      //   } else if (validationColor?.value === "Completed") {
      //     validationItem.process = "green";
      //   } else {
      //     validationItem.process = "red";
      //   }
      // }

      // if (masterPieceItem) {
      //   if (masterColor?.value === "Pending") {
      //     masterPieceItem.process = "red";
      //   } else if (masterColor?.value === "In Progress") {
      //     masterPieceItem.process = "orange";
      //   } else if (masterColor?.value === "Completed") {
      //     masterPieceItem.process = "green";
      //   } else {
      //     masterPieceItem.process = "red";
      //   }
      // }

      // if (hasPending) {
      //   protoItem.process = "red";
      // } else if (hasInProgress) {
      //   protoItem.process = "orange";
      // } else if (allCompleted) {
      //   protoItem.process = "green";
      // } else {
      //   protoItem.process = "gray";
      // }

      // NPDRegisterProcess.markModified("data");
      // NPDRegisterProcess.updatedBy = userId;

      // await NPDRegisterProcess.save();
    }
    // Write one else of the Break hour creation.
    else if (process.processId === "MR/R/002B") {
      const productionReportProcess = await Process.findOne({
        processId: "MR/R/002",
      });

      if (!productionReportProcess) {
        return {
          success: false,
          message: "Production Report Process (MR/R/002) not found",
          statusCode: 404,
        };
      }

      const productionReportRow = productionReportProcess.data.find(
        (row) => row._id.toString() === rowDataId,
      );

      if (productionReportRow) {
        const start = toMinutes(
          productionReportRow.items.find((i) => i.key === "START TIME")?.value,
        );
        const endRaw = toMinutes(
          productionReportRow.items.find((i) => i.key === "END TIME")?.value,
        );

        if (start !== null && endRaw !== null) {
          const end = endRaw < start ? endRaw + 1440 : endRaw;

          // ---- BREAK VALUES ----
          const breakValues = {};
          sceduledLoss.forEach((b) => {
            if (b.from === "nil" || b.to === "nil") return;

            let bStart = toMinutes(b.from);
            let bEnd = toMinutes(b.to);
            if (bEnd < bStart) bEnd += 1440;

            if (bStart < end && bEnd > start) {
              const key = b.label.toUpperCase();
              breakValues[key] = (breakValues[key] || 0) + b.time;
            }
          });

          const asVal = (k) => breakValues[k] || 0;

          // Update the current row (MR/R/002B row) with calculated values
          const updateItem = (key, val) => {
            const item = items.find((i) => i.key === key);
            if (item) item.value = val.toString();
          };

          updateItem("DRM", asVal("DRM"));
          updateItem("TEA BREAK", asVal("TEA"));
          updateItem("FOOD", asVal("FOOD"));
          updateItem("INSPECTION", asVal("INSPECTION"));
          updateItem("PRAYER", asVal("PRAYER"));
          updateItem("COMMUNICATION", asVal("COMMUNICATION"));
        }
      }
    } else if (process.processId === "MR/R/002") {
      const rejectionReportProcess = await Process.findOne({
        processId: "MR/R/003",
      });

      if (rejectionReportProcess) {
        const rejectQty = items.find((i) => i.key === "REJECT")?.value;

        if (Number(rejectQty) > 0) {
          const partNo =
            items.find((i) => i.key === "PART NO")?.value ||
            items.find((i) => i.key === "PART-NO")?.value ||
            "";
          const partName =
            items.find((i) => i.key === "PART NAME")?.value ||
            items.find((i) => i.key === "PART-NAME")?.value ||
            "";

          const shift = items.find((i) => i.key === "SHIFT")?.value || "";
          const existingRejectRow = rejectionReportProcess.data.find(
            (r) =>
              r.rowDataId && r.rowDataId.toString() === rowDataId.toString(),
          );

          if (existingRejectRow) {
            const updateItem = (key, val) => {
              const item = existingRejectRow.items.find((i) => i.key === key);
              if (item) item.value = val;
            };

            updateItem("PART NO", partNo);
            updateItem("PART NAME", partName);
            updateItem("REWORK QTY", rejectQty.toString());
            // Optionally update empty fields if needed, or leave them be

            rejectionReportProcess.markModified("data");
          } else {
            const newRejectRow = {
              items: [
                {
                  key: "DATE",
                  value: "",
                  process: "value",
                },
                { key: "SHIFT", value: shift, process: "value" },
                { key: "STAGE", value: "", process: "value" },
                { key: "PART NO", value: partNo, process: "value" },
                { key: "PART NAME", value: partName, process: "value" },
                {
                  key: "PROBLEM DESCRIPTION",
                  value: "",
                  process: "value",
                },
                {
                  key: "REJECT QTY",
                  value: rejectQty.toString(),
                  process: "value",
                },
                {
                  key: "REJECT STAGE",
                  value: "Production",
                  process: "value",
                },
                { key: "INSPECT BY", value: "", process: "value" },
                {
                  key: "ACTION TAKEN",
                  value: "MR/R/003B",
                  process: "processId",
                },
              ],
              rowDataId,
            };

            newRejectRow.items = await linkProcessIdItems(newRejectRow.items);
            rejectionReportProcess.data.push(newRejectRow);
          }
          rejectionReportProcess.updatedBy = userId;
          await rejectionReportProcess.save();
        }
      }
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      message: error.message,
      statusCode: error.statusCode || 500,
    };
  }
};

exports.handleUpdateIntersection = async (
  process,
  items,
  row,
  userId,
  rowId,
  previousItems,
) => {
  try {
    if (!Array.isArray(items))
      return { success: false, message: "Items must be an array" };
    // ---- MR/R/003B (Rework) ----
    if (process.processId === "MR/R/003B") {
      const moveToItem = items.find((i) => i.key === "MOVE TO");
      if (moveToItem && moveToItem.value === "Rework") {
        const rejectionReport = await Process.findOne({
          processId: "MR/R/003",
        });
        const reworkReport = await Process.findOne({ processId: "MR/R/003A" });

        if (rejectionReport && reworkReport) {
          const rejectionRow = rejectionReport.data.id(row.rowDataId);
          if (rejectionRow) {
            const partNo = rejectionRow.items.find(
              (i) => i.key === "PART NO",
            )?.value;
            const partName = rejectionRow.items.find(
              (i) => i.key === "PART NAME",
            )?.value;
            const problemDesc = rejectionRow.items.find(
              (i) => i.key === "PROBLEM DESCRIPTION",
            )?.value;
            const rejectStage = rejectionRow.items.find(
              (i) => i.key === "REJECT STAGE",
            )?.value;

            const reworkRow = {
              items: [
                { key: "PART NO", value: partNo || "", process: "value" },
                { key: "PART NAME", value: partName || "", process: "value" },
                {
                  key: "PROBLEM DESCRIPTION",
                  value: problemDesc || "",
                  process: "value",
                },
                { key: "REWORK QTY", value: "0", process: "value" },
                {
                  key: "REJECT STAGE",
                  value: rejectStage || "",
                  process: "value",
                },
                {
                  key: "ACTION PLAN",
                  value:
                    items.find((i) => i.key === "ACTION PLAN")?.value || "",
                  process: "value",
                },
                {
                  key: "VERIFIED BY",
                  value:
                    items.find((i) => i.key === "VERIFIED BY")?.value || "",
                  process: "value",
                },
                {
                  key: "STATUS",
                  value:
                    items.find((i) => i.key === "ACTION PLAN STATUS")?.value ||
                    "",
                  process: "value",
                },
              ],
              rowDataId: row.rowDataId,
            };

            reworkReport.data.push(reworkRow);
            reworkReport.updatedBy = userId;
            await reworkReport.save();

            await History.create({
              collectionName: "Process",
              documentId: reworkReport._id,
              rowId: reworkReport.data[reworkReport.data.length - 1]._id,
              operation: "create",
              oldData: null,
              newData: reworkRow,
              changedBy: userId,
            });
          }
        }
      }
    }

    // ---- MS/R/005 → MS/R/006 ----
    else if (process.processId === "MS/R/005") {
      const moveToItem = items.find((i) => i.key === "QL STATUS");
      if (moveToItem && moveToItem.value === "ORDER") {
        const orderListProcess = await Process.findOne({
          processId: "MS/R/006",
        });
        // const storeRegisterProcess = await Process.findOne({
        //   processId: "ST/R/005",
        // });
        // const stockDataProcess = await Process.findOne({
        //   processId: "ST/R/006",
        // });
        if (orderListProcess) {
          let orderListRow = {
            items: [
              {
                key: "DATE",
                value: items.find((i) => i.key === "DATE")?.value,
                process: "value",
              },
              {
                key: "QUOTE NO",
                value: items.find((i) => i.key === "QUOTATION NO")?.value,
                process: "value",
              },
              {
                key: "PART NO",
                value: items.find((i) => i.key === "PART-NO")?.value,
                process: "value",
              },
              {
                key: "PART NAME",
                value: items.find((i) => i.key === "PART-NAME")?.value,
                process: "value",
              },
              {
                key: "ENQ BY",
                value: items.find((i) => i.key === "ENQ BY")?.value,
                process: "value",
              },
              {
                key: "CUSTOMER NAME",
                value: items.find((i) => i.key === "CUSTOMER-NAME")?.value,
                process: "value",
              },
              {
                key: "LOCATION",
                value: items.find((i) => i.key === "LOCATION")?.value,
                process: "value",
              },
              {
                key: "DESCRIPTION",
                value: items.find((i) => i.key === "DESCRIPTION")?.value,
                process: "value",
              },
              {
                key: "QTY",
                value: items.find((i) => i.key === "QTY")?.value,
                process: "value",
              },
              {
                key: "UNITS",
                value: items.find((i) => i.key === "UNITS")?.value,
                process: "value",
              },
              {
                key: "VALUE",
                value: "",
                process: "value",
              },
              {
                key: "ORDER DATE",
                value: items.find((i) => i.key === "ORDER DATE")?.value,
                process: "value",
              },
              {
                key: "PO NO",
                value: items.find((i) => i.key === "PO NO")?.value,
                process: "value",
              },
              {
                key: "LEAD TIME",
                value: items.find((i) => i.key === "LEAD TIME")?.value,
                process: "value",
              },
              {
                key: "DOCKET",
                value: "MS/R/006A",
                process: "processId",
              },
              {
                key: "ORDER STATUS",
                value: "",
                process: "select",
              },
            ],
            rowDataId: rowId,
          };

          orderListRow.items = await linkProcessIdItems(orderListRow.items);
          orderListProcess.data.push(orderListRow);
          orderListProcess.updatedBy = userId;
        }

        // const matchedRow = storeRegisterProcess.data.find((itemRow) => {
        //   const rowItemCode = itemRow.items.find(
        //     (i) => i.key === "ITEM CODE",
        //   )?.value;
        //   return rowItemCode === items.find((i) => i.key === "PART NO")?.value;
        // });

        // if (!matchedRow || !storeRegisterProcess)
        //   return {
        //     success: false,
        //     message: "Item not found in Store Register Process (ST/R/005)",
        //     statusCode: 404,
        //   };

        // const storeRegisterRow = {
        //   items: [
        //     {
        //       key: "DATE",
        //       value: items.find((i) => i.key === "DATE")?.value,
        //       process: "value",
        //     },
        //     {
        //       key: "IN / OUT",
        //       value: "OUT",
        //       process: "value",
        //     },
        //     {
        //       key: "ITEM CATEGORY",
        //       value: matchedRow.items.find((i) => i.key === "ITEM CATEGORY")
        //         ?.value,
        //       process: "value",
        //     },
        //     {
        //       key: "ITEM CODE",
        //       value: matchedRow.items.find((i) => i.key === "ITEM CODE")?.value,
        //       process: "value",
        //     },
        //     {
        //       key: "ITEM NAME",
        //       value: matchedRow.items.find((i) => i.key === "ITEM NAME")?.value,
        //       process: "value",
        //     },
        //     {
        //       key: "VENDOR / CUSTOMER",
        //       value: matchedRow.items.find((i) => i.key === "VENDOR / CUSTOMER")
        //         ?.value,
        //       process: "value",
        //     },
        //     {
        //       key: "QTY",
        //       value: items.find((i) => i.key === "QTY")?.value,
        //       process: "value",
        //     },
        //     {
        //       key: "DOC &REPORT NO",
        //       value: items.find((i) => i.key === "DC NO")?.value,
        //       process: "value",
        //     },
        //   ],
        //   rowDataId: rowId,
        // };

        // storeRegisterProcess.data.push(storeRegisterRow);
        // storeRegisterProcess.updatedBy = userId;

        // if (stockDataProcess) {
        //   // 🧩 Use PART NO as the item code reference
        //   const itemCode = items.find((i) => i.key === "PART NO")?.value;
        //   const qty = Number(items.find((i) => i.key === "QTY")?.value || 0);

        //   if (!itemCode)
        //     return {
        //       success: false,
        //       message: "Item code not found",
        //       statusCode: 404,
        //     };

        //   // 🔍 Find existing stock entry for this item
        //   const existingStockRow = stockDataProcess.data.find(
        //     (r) =>
        //       r.items.find((i) => i.key === "ITEM CODE")?.value === itemCode,
        //   );

        //   if (existingStockRow) {
        //     // 🟠 Update existing stock entry (OUT operation)
        //     const inItem = existingStockRow.items.find((i) => i.key === "IN");
        //     const outItem = existingStockRow.items.find((i) => i.key === "OUT");
        //     const stockItem = existingStockRow.items.find(
        //       (i) => i.key === "STOCK",
        //     );

        //     const currentIn = Number(inItem?.value || 0);
        //     const currentOut = Number(outItem?.value || 0);

        //     const newOut = currentOut + qty;
        //     const newStock = currentIn - newOut; // stock decreases when OUT happens

        //     // Update values safely
        //     if (outItem) outItem.value = newOut.toString();
        //     if (stockItem) stockItem.value = newStock.toString();

        //     stockDataProcess.updatedBy = userId;
        //   } else {
        //     // 🆕 Create new stock entry (first-time OUT)
        //     const itemCategory =
        //       items.find((i) => i.key === "ITEM CATEGORY")?.value || "";
        //     const itemName =
        //       items.find((i) => i.key === "ITEM NAME")?.value || "";

        //     const newStock = 0 - qty; // negative or zero stock indicates outgoing only

        //     const newStockRow = {
        //       items: [
        //         { key: "ITEM CATEGORY", value: itemCategory, process: "value" },
        //         { key: "ITEM CODE", value: itemCode, process: "value" },
        //         { key: "ITEM NAME", value: itemName, process: "value" },
        //         { key: "IN", value: "0", process: "value" },
        //         { key: "OUT", value: qty.toString(), process: "value" },
        //         { key: "STOCK", value: newStock.toString(), process: "value" },
        //       ],
        //       rowDataId: row.rowDataId,
        //     };

        //     stockDataProcess.data.push(newStockRow);
        //     stockDataProcess.updatedBy = userId;
        //   }
        // }

        // SAVE ALL ONLY AT THE END
        if (orderListProcess) await orderListProcess.save();
        // await storeRegisterProcess.save();
        // if (stockDataProcess) await stockDataProcess.save();
      }
    }

    // ---- MR/R/001 → PR/R/003 ----
    else if (process.processId === "MR/R/001") {
      const procurementProcess = await Process.findOne({
        processId: "PR/R/003",
      });
      const planNumber = items.find((i) => i.key === "PLAN NO")?.value;
      const date = items.find((i) => i.key === "DATE")?.value;
      const partNo = items.find((i) => i.key === "PART NO")?.value;
      const partName = items.find((i) => i.key === "PART NAME")?.value;
      const type = items.find((i) => i.key === "TYPE")?.value;
      const material = items.find((i) => i.key === "MATERIAL")?.value;
      const planQty = Number(items.find((i) => i.key === "PLAN QTY")?.value);
      const previousPlanQty = Number(
        previousItems.find((i) => i.key === "PLAN QTY")?.value,
      );

      if (procurementProcess && planNumber) {
        for (const prRow of procurementProcess.data) {
          const plNo = prRow.items.find((i) => i.key === "PL NO")?.value;
          if (plNo !== planNumber) continue;

          const prQuantity = Number(
            prRow.items.find((i) => i.key === "QTY")?.value || 0,
          );
          const bomQuantity = previousPlanQty
            ? Number(prQuantity / previousPlanQty)
            : 0;
          const newQuantity = Number(planQty * bomQuantity) || 0;

          const updateValue = (key, val) => {
            const item = prRow.items.find((i) => i.key === key);
            if (item) item.value = val;
          };

          updateValue("QTY", newQuantity.toString());
          updateValue("DATE", date);
          updateValue("PART NO", partNo);
          updateValue("PART NAME", partName);
          updateValue("TYPE", type);
          updateValue("MATERIAL", material);

          prRow.updatedAt = new Date();
          prRow.updatedBy = userId;
        }

        await procurementProcess.save();
      }
    }

    // ---- PR/R/003A → PR/R/003 ----
    else if (process.processId === "PR/R/003A") {
      // 1️⃣ Get Procurement Register process
      const procurementProcess = await Process.findOne({
        processId: "PR/R/003",
      });
      if (!procurementProcess) return { success: true };

      // 2️⃣ Filter inward rows linked to the current rowDataId
      const matchRows = process.data.filter(
        (r) => r.rowDataId === row.rowDataId,
      );
      if (matchRows.length === 0) return { success: true };

      // 3️⃣ Check if ALL related inward rows have QC QUALITY INSPECTION = "Inspection Done"
      const allInspectionDone = matchRows.every(
        (row) =>
          row.items.find((i) => i.key === "QC QUALITY INSPECTION")?.value ===
          "Inspection Done",
      );

      // 4️⃣ If inspection done, find the corresponding procurement row and update status
      if (allInspectionDone) {
        const inwardRow = matchRows[0];

        const prRow = procurementProcess.data.find(
          (r) => r._id.toString() === inwardRow.rowDataId.toString(),
        );

        if (prRow) {
          const prStatusItem = prRow.items.find((i) => i.key === "PR STATUS");
          if (prStatusItem) {
            prStatusItem.value = "Closed";
            await procurementProcess.save();
          }
        }
      }
    }

    // ---- PR/R/003A → QA/R/003 ---- Inward -> Incoming Inspection ---
    else if (process.processId === "QA/R/003") {
      const inwardProcess = await Process.findOne({ processId: "PR/R/003A" });
      const storeRegisterProcess = await Process.findOne({
        processId: "ST/R/005",
      });
      const stockDataProcess = await Process.findOne({ processId: "ST/R/006" });

      if (!inwardProcess) return { success: true };
      const isMoving = items.find((i) => i.key === "INSPECTION-STATUS")?.value;

      if (isMoving === "Done") {
        const qualityInspectionProcess = await Process.findOne({
          processId: "QA/R/003A",
        });
        if (!qualityInspectionProcess) return { success: true };

        const matchQulaityInspection = qualityInspectionProcess.data.find(
          (r) => r.rowDataId === row._id.toString(),
        );
        if (!matchQulaityInspection) return { success: true };

        let currentInwardRow = inwardProcess.data.find(
          (r) => r.rowDataId === row.rowDataId.toString(),
        );

        const inwardRow = {
          items: [
            {
              key: "INVOICE NO",
              value:
                currentInwardRow?.items.find((i) => i.key === "INVOICE NO")
                  ?.value || "",
              process: "value",
            },
            {
              key: "DELIVERY DATE",
              value:
                currentInwardRow?.items.find((i) => i.key === "DELIVERY DATE")
                  ?.value || "",
              process: "value",
            },
            {
              key: "QTY",
              value:
                currentInwardRow?.items.find((i) => i.key === "QTY")?.value ||
                "",
              process: "value",
            },
            {
              key: "QC QUALITY INSPECTION",
              value: "Inspection Done",
              process: "value",
            },
            {
              key: "DEFECT QTY",
              value: matchQulaityInspection.items.find(
                (i) => i.key === "DEFECT QUANTITY",
              )?.value,
              process: "value",
            },
            {
              key: "PENDING QTY",
              value: (
                Number(
                  currentInwardRow?.items.find((i) => i.key === "QTY")?.value,
                ) -
                Number(
                  matchQulaityInspection.items.find(
                    (i) => i.key === "DEFECT QUANTITY",
                  )?.value,
                )
              ).toString(),
              process: "value",
            },
            {
              key: "PAYMENT",
              value:
                currentInwardRow?.items.find((i) => i.key === "PAYMENT")
                  ?.value || "",
              process: "select",
            },
          ],
          rowDataId: currentInwardRow.rowDataId,
        };
        inwardProcess.data.id(currentInwardRow._id).items = inwardRow.items;
        inwardProcess.updatedBy = userId;

        // Update Store Register
        if (storeRegisterProcess) {
          const storeRegisterRow = {
            items: [
              {
                key: "DATE",
                value: new Date().toISOString().split("T")[0],
                process: "date",
              },
              { key: "IN / OUT", value: "IN", process: "value" },
              {
                key: "ITEM CATEGORY",
                value:
                  items.find((i) => i.key === "ITEM CATEGORY")?.value || "",
                process: "value",
              },
              {
                key: "ITEM CODE",
                value: items.find((i) => i.key === "ITEM CODE")?.value || "",
                process: "value",
              },
              {
                key: "ITEM NAME",
                value: items.find((i) => i.key === "ITEM NAME")?.value || "",
                process: "value",
              },
              {
                key: "VENDOR / CUSTOMER",
                value: items.find((i) => i.key === "VENDOR NAME")?.value || "",
                process: "value",
              },
              {
                key: "QTY",
                value:
                  (
                    Number(items.find((i) => i.key === "QTY")?.value) -
                    Number(
                      matchQulaityInspection.items.find(
                        (i) => i.key === "DEFECT QUANTITY",
                      )?.value || 0,
                    )
                  ).toString() || 0,
                process: "value",
              },
              {
                key: "DOC &REPORT NO",
                value:
                  currentInwardRow.items.find((i) => i.key === "INVOICE NO")
                    ?.value || "",
                process: "value",
              },
            ],
            rowDataId: row.rowDataId,
          };

          storeRegisterProcess.data.push(storeRegisterRow);
          storeRegisterProcess.updatedBy = userId;
        }

        if (stockDataProcess) {
          const itemCode = items.find((i) => i.key === "ITEM CODE")?.value;
          const qty = Number(items.find((i) => i.key === "QTY")?.value || 0);

          if (!itemCode) return { success: true };

          // Find if stock entry for this item already exists
          const existingStockRow = stockDataProcess.data.find(
            (r) =>
              r.items.find((i) => i.key === "ITEM CODE")?.value === itemCode,
          );

          if (existingStockRow) {
            // 🟢 Update existing stock entry
            const inItem = existingStockRow.items.find((i) => i.key === "IN");
            const outItem = existingStockRow.items.find((i) => i.key === "OUT");
            const stockItem = existingStockRow.items.find(
              (i) => i.key === "STOCK",
            );

            const currentIn = Number(inItem?.value || 0);
            const currentOut = Number(outItem?.value || 0);

            const newIn = currentIn + qty;
            const newStock = newIn - currentOut;

            // Update values
            if (inItem) inItem.value = newIn.toString();
            if (stockItem) stockItem.value = newStock.toString();

            stockDataProcess.updatedBy = userId;
          } else {
            // 🔵 Create new stock entry for this item
            const itemCategory =
              items.find((i) => i.key === "ITEM CATEGORY")?.value || "";
            const itemName =
              items.find((i) => i.key === "ITEM NAME")?.value || "";

            const newStockRow = {
              items: [
                { key: "ITEM CATEGORY", value: itemCategory, process: "value" },
                { key: "ITEM CODE", value: itemCode, process: "value" },
                { key: "ITEM NAME", value: itemName, process: "value" },
                { key: "IN", value: qty.toString(), process: "value" },
                { key: "OUT", value: "0", process: "value" },
                { key: "STOCK", value: qty.toString(), process: "value" },
              ],
              rowDataId: row.rowDataId,
            };

            stockDataProcess.data.push(newStockRow);
            stockDataProcess.updatedBy = userId;
          }
        }

        await inwardProcess.save();
        if (storeRegisterProcess) await storeRegisterProcess.save();
        if (stockDataProcess) await stockDataProcess.save();
      }
    }

    // ---- DD/R/010
    else if (process.processId === "DD/R/012") {
      const NPDRegisterProcess = await Process.findOne({
        processId: "DD/R/010",
      });

      if (!NPDRegisterProcess)
        return {
          success: false,
          message: "NPD Register Process not found",
          statusCode: 404,
        };

      const correspondingItem = NPDRegisterProcess.data.find(
        (d) => d._id.toString() === row.rowDataId.toString(),
      );

      if (!correspondingItem)
        return {
          success: false,
          message: "Corresponding NPD row not found",
          statusCode: 404,
        };

      const protoItem = correspondingItem.items.find((i) => i.key === "PROTO");
      const validationItem = correspondingItem.items.find(
        (i) => i.key === "VALIDATION",
      );
      const masterPieceItem = correspondingItem.items.find(
        (i) => i.key === "MASTER PIECE",
      );

      if (!protoItem)
        return {
          success: false,
          message: "PROTO item not found",
          statusCode: 404,
        };

      const hasPending = items.some((i) => i.value === "Pending");
      const hasInProgress = items.some((i) => i.value === "In Progress");
      const allCompleted =
        items.length > 0 && items.every((i) => i.value === "Completed");

      const validationColor = items.find((i) => i.key === "VALIDATION");
      const masterColor = items.find((i) => i.key === "MASTER PIECE");

      if (validationItem) {
        if (validationColor.value === "Pending") {
          validationItem.process = "red";
        } else if (validationColor.value === "In Progress") {
          validationItem.process = "orange";
        } else if (validationColor.value === "Completed") {
          validationItem.process = "green";
        } else {
          validationItem.process = "red"; // fallback safety
        }
      }

      if (masterPieceItem) {
        if (masterColor.value === "Pending") {
          masterPieceItem.process = "red";
        } else if (masterColor.value === "In Progress") {
          masterPieceItem.process = "orange";
        } else if (masterColor.value === "Completed") {
          masterPieceItem.process = "green";
        } else {
          masterPieceItem.process = "red"; // fallback safety
        }
      }

      if (hasPending) {
        protoItem.process = "red";
      } else if (hasInProgress) {
        protoItem.process = "orange";
      } else if (allCompleted) {
        protoItem.process = "green";
      } else {
        protoItem.process = "gray"; // fallback safety
      }

      NPDRegisterProcess.markModified("data");
      NPDRegisterProcess.updatedBy = userId;

      await NPDRegisterProcess.save();
    }

    // ---- DD/R/010 (Register Edit) pulling status from DD/R/012
    else if (process.processId === "DD/R/010") {
      const d12Process = await Process.findOne({ processId: "DD/R/012" });
      if (d12Process) {
        const d12Row = d12Process.data.find(
          (r) => r.rowDataId && r.rowDataId.toString() === rowId.toString(),
        );
        if (d12Row) {
          const d12Items = d12Row.items;
          const protoItem = items.find((i) => i.key === "PROTO");
          const validationItem = items.find((i) => i.key === "VALIDATION");
          const masterPieceItem = items.find((i) => i.key === "MASTER PIECE");

          const hasPending = d12Items.some((i) => i.value === "Pending");
          const hasInProgress = d12Items.some((i) => i.value === "In Progress");
          const allCompleted =
            d12Items.length > 0 &&
            d12Items.every((i) => i.value === "Completed");

          const validationColor = d12Items.find((i) => i.key === "VALIDATION");
          const masterColor = d12Items.find((i) => i.key === "MASTER PIECE");

          if (validationItem) {
            if (validationColor?.value === "Pending")
              validationItem.process = "red";
            else if (validationColor?.value === "In Progress")
              validationItem.process = "orange";
            else if (validationColor?.value === "Completed")
              validationItem.process = "green";
            else validationItem.process = "red";
          }

          if (masterPieceItem) {
            if (masterColor?.value === "Pending")
              masterPieceItem.process = "red";
            else if (masterColor?.value === "In Progress")
              masterPieceItem.process = "orange";
            else if (masterColor?.value === "Completed")
              masterPieceItem.process = "green";
            else masterPieceItem.process = "red";
          }

          if (protoItem) {
            if (hasPending) protoItem.process = "red";
            else if (hasInProgress) protoItem.process = "orange";
            else if (allCompleted) protoItem.process = "green";
            else protoItem.process = "gray";
          }
        }
      }
    }

    //
    else if (process.processId === "MR/R/002A") {
      const rowDataId = row.rowDataId;
      const breakHourProcess = await Process.findOne({
        processId: "MR/R/002B",
      });
      const productionReportProcess = await Process.findOne({
        processId: "MR/R/002",
      });
      if (!breakHourProcess || !productionReportProcess)
        return {
          success: false,
          message: "No production report or Break Process Found",
          statusCode: 404,
        };
      const productionReportRow = productionReportProcess.data.find(
        (row) => row._id.toString() === rowDataId.toString(),
      );
      if (!productionReportRow)
        return {
          success: false,
          message: "No production report row found",
          statusCode: 404,
        };

      const start = toMinutes(
        productionReportRow.items.find((i) => i.key === "START TIME")?.value,
      );
      const endRaw = toMinutes(
        productionReportRow.items.find((i) => i.key === "END TIME")?.value,
      );

      const settingColor = productionReportRow.items.find(
        (i) => i.key === "SETTING",
      );
      if (settingColor) settingColor.process = "green";

      const end = endRaw < start ? endRaw + 1440 : endRaw;

      const settings = items.find((i) => i.key === "SETTING TIME")?.value;
      const setupLoss = items.find((i) => i.key === "SET UP LOSS")?.value;

      const totalTime =
        Number(productionReportRow.items.find((i) => i.key === "PLAN")?.value) *
        Number(
          productionReportRow.items.find((i) => i.key === "CYCLE TIME")?.value,
        );

      const actualPlan =
        (totalTime - (settings || 0)) /
        Number(
          productionReportRow.items.find((i) => i.key === "CYCLE TIME")?.value,
        );

      const planItem = productionReportRow.items.find((i) => i.key === "PLAN");
      const actualItem = productionReportRow.items.find(
        (i) => i.key === "ACTUAL",
      )?.value;
      const cycleTime = productionReportRow.items.find(
        (i) => i.key === "CYCLE TIME",
      )?.value;
      const reject = Number(
        productionReportRow.items.find((i) => i.key === "REJECT")?.value || 0,
      );
      const breakHour = productionReportRow.items.find(
        (i) => i.key === "BREAK HOUR",
      );
      const oeeItem = productionReportRow.items.find((i) => i.key === "OEE");

      let valueOfProcess =
        (Number(actualPlan) - Number(actualItem)) * Number(cycleTime);
      let oeeCalculation =
        (((Number(actualItem) / Number(actualPlan)) *
          ((Number(actualItem) - reject) / Number(actualItem)) *
          (totalTime - valueOfProcess)) /
          totalTime) *
        100;

      if (!planItem)
        return {
          success: false,
          message: "PLAN field not found",
          statusCode: 404,
        };
      if (breakHour) breakHour.process = valueOfProcess.toString();
      planItem.value = actualPlan.toString();
      if (oeeItem) oeeItem.value = Math.floor(oeeCalculation).toString();

      productionReportProcess.markModified("data");
      productionReportProcess.updatedBy = userId;

      await productionReportProcess.save();

      // ---- BREAK VALUES ----
      const breakValues = {};
      sceduledLoss.forEach((b) => {
        if (b.from === "nil" || b.to === "nil") return;

        let bStart = toMinutes(b.from);
        let bEnd = toMinutes(b.to);
        if (bEnd < bStart) bEnd += 1440;

        if (bStart < end && bEnd > start) {
          const key = b.label.toUpperCase();
          breakValues[key] = (breakValues[key] || 0) + b.time;
        }
      });

      // ---- FINAL ROW ----
      const asVal = (k) => breakValues[k] || 0;

      const breakHourRow = breakHourProcess.data.find(
        (r) => r.rowDataId && r.rowDataId.toString() === rowDataId.toString(),
      );

      if (breakHourRow) {
        const updateItem = (key, val) => {
          const item = breakHourRow.items.find((i) => i.key === key);
          if (item) item.value = val;
        };

        updateItem("DRM", asVal("DRM").toString());
        updateItem("TEA BREAK", asVal("TEA").toString());
        updateItem("FOOD", asVal("FOOD").toString());
        updateItem("INSPECTION", asVal("INSPECTION").toString());
        updateItem("PRAYER", asVal("PRAYER").toString());
        updateItem("COMMUNICATION", asVal("COMMUNICATION").toString());
        updateItem("SETTINGS", settings?.toString() || "");
        updateItem("SETUP LOSS", setupLoss?.toString() || "");

        breakHourProcess.markModified("data");
      } else {
        const newBreakHourRow = {
          rowDataId,
          items: [
            { key: "DRM", value: asVal("DRM").toString(), process: "value" },
            {
              key: "TEA BREAK",
              value: asVal("TEA").toString(),
              process: "value",
            },
            { key: "FOOD", value: asVal("FOOD").toString(), process: "value" },
            {
              key: "INSPECTION",
              value: asVal("INSPECTION").toString(),
              process: "value",
            },
            {
              key: "PRAYER",
              value: asVal("PRAYER").toString(),
              process: "value",
            },
            {
              key: "COMMUNICATION",
              value: asVal("COMMUNICATION").toString(),
              process: "value",
            },
            {
              key: "SETTINGS",
              value: settings?.toString() || "",
              process: "value",
            },
            {
              key: "SETUP LOSS",
              value: setupLoss?.toString() || "",
              process: "value",
            },
            ...[
              "TOOL CHANGE",
              "VERIFICATION",
              "LOAD/ UNLOAD LOSS",
              "DEFECTS/ REWORK",
              "BREAKDOWN",
              "MAINTENANCE",
              "NO POWER",
              "NO MAN POWER",
              "NO SCHEDULE",
              "NO MATERIAL",
              "NO DRAWING",
              "NPD",
            ].map((k) => ({ key: k, value: "0", process: "value" })),
          ],
        };
        breakHourProcess.data.push(newBreakHourRow);
      }

      breakHourProcess.updatedBy = userId;
      await breakHourProcess.save();
    } else if (process.processId === "MR/R/002") {
      const rejectionReportProcess = await Process.findOne({
        processId: "MR/R/003",
      });

      if (rejectionReportProcess) {
        const rejectQty = items.find((i) => i.key === "REJECT")?.value;

        if (Number(rejectQty) > 0) {
          const partNo =
            items.find((i) => i.key === "PART NO")?.value ||
            items.find((i) => i.key === "PART-NO")?.value ||
            "";
          const partName =
            items.find((i) => i.key === "PART NAME")?.value ||
            items.find((i) => i.key === "PART-NAME")?.value ||
            "";

          const shift = items.find((i) => i.key === "SHIFT")?.value || "";

          const existingRejectRow = rejectionReportProcess.data.find(
            (r) => r.rowDataId && r.rowDataId.toString() === rowDataId,
          );

          if (existingRejectRow) {
            const updateItem = (key, val) => {
              const item = existingRejectRow.items.find((i) => i.key === key);
              if (item) item.value = val;
            };

            updateItem("PART NO", partNo);
            updateItem("PART NAME", partName);
            updateItem("REWORK QTY", rejectQty.toString());
            // Optionally update empty fields if needed, or leave them be

            rejectionReportProcess.markModified("data");
          } else {
            const newRejectRow = {
              items: [
                {
                  key: "DATE",
                  value: "",
                  process: "value",
                },
                { key: "SHIFT", value: shift, process: "value" },
                { key: "STAGE", value: "", process: "value" },
                { key: "PART NO", value: partNo, process: "value" },
                { key: "PART NAME", value: partName, process: "value" },
                {
                  key: "PROBLEM DESCRIPTION",
                  value: "",
                  process: "value",
                },
                {
                  key: "REJECT QTY",
                  value: rejectQty.toString(),
                  process: "value",
                },
                {
                  key: "REJECT STAGE",
                  value: "Production",
                  process: "value",
                },
                { key: "INSPECT BY", value: "", process: "value" },
                {
                  key: "ACTION TAKEN",
                  value: "MR/R/003B",
                  process: "processId",
                },
              ],
              rowDataId,
            };

            newRejectRow.items = await linkProcessIdItems(newRejectRow.items);

            rejectionReportProcess.data.push(newRejectRow);
          }
          rejectionReportProcess.updatedBy = userId;
          await rejectionReportProcess.save();
        }
      }
    } else {
      return { success: true };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      message: error.message,
      statusCode: error.statusCode || 500,
    };
  }
};

exports.handleDeleteIntersection = async (
  process,
  rowId,
  userId,
  currentRow,
) => {
  try {
    // Utility function to delete linked rows safely
    const deleteLinkedRows = async (targetProcessId, filterFn) => {
      const target = await Process.findOne({ processId: targetProcessId });
      if (!target) return;

      const rowsToDelete = target.data.filter(filterFn);
      target.data = target.data.filter((r) => !rowsToDelete.includes(r));
      target.updatedBy = userId;
      await target.save();
    };

    // ---- DD/R/001 → DD/R/002, DD/R/002A, DD/R/003, DD/R/004, DD/R/005, QA/R/009 ---- Product List.
    if (process.processId === "DD/R/001") {
      const targets = [
        "DD/R/002",
        "DD/R/002A",
        "DD/R/003",
        "DD/R/004",
        "DD/R/005",
        "QA/R/009",
      ];
      for (const id of targets)
        await deleteLinkedRows(id, (row) => row.rowDataId === rowId);
    }

    // ---- DD/R/002 → DD/R/012, DD/R/014, DD/R/008 ---- NPD Register
    else if (process.processId === "DD/R/010") {
      const targets = ["DD/R/012", "DD/R/014", "DD/R/008"];
      for (const id of targets)
        await deleteLinkedRows(id, (row) => row.rowDataId === rowId);
    }

    // ---- MR/R/002 → MR/R/002A, MR/R/002B ---- Production Report
    else if (process.processId === "MR/R/002") {
      const targets = ["MR/R/002A", "MR/R/002B"];
      for (const id of targets)
        await deleteLinkedRows(id, (row) => row.rowDataId === rowId);
    }

    // ---- MR/R/003B → MR/R/003 ---- Rejection Report
    else if (process.processId === "MR/R/003") {
      await deleteLinkedRows("MR/R/003B", (row) => row.rowDataId === rowId);
    }

    // ---- MR/R/003A → QA/R/007A ---- Rework Report
    else if (process.processId === "MR/R/003A") {
      await deleteLinkedRows("QA/R/007A", (row) => row.rowDataId === rowId);
    }

    // ---- QA/R/003 → QA/R/003A ---- Incoming Inspection
    else if (process.processId === "QA/R/003") {
      await deleteLinkedRows("QA/R/003A", (row) => row.rowDataId === rowId);
    }

    // ---- QA/R/007 → QA/R/007A ---- Customer Complaint Register
    else if (process.processId === "QA/R/007") {
      await deleteLinkedRows("QA/R/007A", (row) => row.rowDataId === rowId);
    }

    // ---- QA/F/005 → QA/F/005A ---- Calibration Register
    else if (process.processId === "QA/F/005") {
      await deleteLinkedRows("QA/F/005A", (row) => row.rowDataId === rowId);
    }

    // ---- MR/R/005 → MR/R/005A ---- Improvement Status
    else if (process.processId === "MR/R/005") {
      await deleteLinkedRows("MR/R/005A", (row) => row.rowDataId === rowId);
    }

    // ---- MN/R/003 → QA/F/005A ---- Maintenance Report
    else if (process.processId === "MN/R/003") {
      await deleteLinkedRows("QA/F/005A", (row) => row.rowDataId === rowId);
    }

    // ---- PR/R/003 → MR/R/001 ---- Procurement Register X
    else if (process.processId === "PR/R/003") {
      await deleteLinkedRows("MR/R/001", (row) => row.rowDataId === rowId);
    }
    return { success: true };
  } catch (error) {
    return {
      success: false,
      message: error.message,
      statusCode: error.statusCode || 500,
    };
  }
};
