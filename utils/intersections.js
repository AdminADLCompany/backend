// utils/intersection.js
const Process = require("../models/process");
const History = require("../models/history");

/**
 * Handles intersection logic for addData
 */
exports.handleAddIntersection = async (process, items, rowDataId, userId) => {
  // ---- MR/R/003B (Action Taken -> Rework) ----
  if (process.processId === "MR/R/003B") {
    const moveToItem = items.find((i) => i.key === "MOVE TO");
    if (moveToItem && moveToItem.value === "Rework") {
      const rejectionProcess = await Process.findOne({ processId: "MR/R/003" });
      const rejectionRow = rejectionProcess?.data.id(rowDataId);

      if (rejectionRow) {
        const partNo = rejectionRow.items.find(
          (i) => i.key === "PART NO"
        )?.value;
        const partName = rejectionRow.items.find(
          (i) => i.key === "PART NAME"
        )?.value;
        const problemDesc = rejectionRow.items.find(
          (i) => i.key === "PROBLEM DESCRIPTION"
        )?.value;
        const rejectStage = rejectionRow.items.find(
          (i) => i.key === "REJECT STAGE"
        )?.value;
        const rejectQty =
          rejectionRow.items.find((i) => i.key === "REJECT QTY")?.value || 0;

        const actionPlan = items.find(
          (i) => i.key === "ACTION PLANNING"
        )?.value;
        const verifiedBy = items.find((i) => i.key === "VERIFIED BY")?.value;
        const status = items.find((i) => i.key === "ACTION PLAN STATUS")?.value;

        const reworkProcess = await Process.findOne({ processId: "MR/R/003A" });
        if (reworkProcess) {
          const reworkRow = {
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
              { key: "ACTION PLAN", value: "QA/R/007A", process: "processId" },
              { key: "VERIFIED BY", value: verifiedBy, process: "value" },
              { key: "STATUS", value: status, process: "value" },
            ],
            rowDataId,
          };

          for (const item of reworkRow.items) {
            if (item.process === "processId" && item.value) {
              const relatedProcess = await Process.findOne({
                processId: item.value,
              });
              if (relatedProcess?._id) {
                item.value = `processId - ${relatedProcess._id}`;
                item.process = "";
              }
            }
          }

          reworkProcess.data.push(reworkRow);
          reworkProcess.updatedBy = userId;
          await reworkProcess.save();

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
    }
  }

  // ---- MS/R/005 → MS/R/006 ---- (Quatation List -> Order List)
  else if (process.processId === "MS/R/005") {
    const moveToItem = items.find((i) => i.key === "QL STATUS");
    if (moveToItem && moveToItem.value === "OPEN") {
      const orderListProcess = await Process.findOne({ processId: "MS/R/006" });
      if (orderListProcess) {
        const orderListRow = {
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
              key: "ENQ BY",
              value: items.find((i) => i.key === "ENQ BY")?.value,
              process: "value",
            },
            {
              key: "CUSTOMER NAME",
              value: items.find((i) => i.key === "CUSTOMER NAME")?.value,
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
            { key: "VALUE", value: "", process: "value" },
            { key: "ORDER DATE", value: "", process: "value" },
            { key: "PO NO", value: "", process: "value" },
            { key: "LEAD TIME", value: "", process: "value" },
            { key: "INVOICE NO", value: "", process: "value" },
            { key: "DELIVERY QTY", value: "", process: "value" },
            { key: "PENDING QTY", value: "", process: "value" },
            { key: "DELIVERY DATE", value: "", process: "value" },
            { key: "GRN", value: "", process: "value" },
            { key: "PAYMENT", value: "", process: "value" },
          ],
          rowDataId,
        };
        orderListProcess.data.push(orderListRow);
        orderListProcess.updatedBy = userId;
        await orderListProcess.save();
      }
    }
  }

  // ---- PR/R/003 → QA/R/003 ---- (Procurement Register -> Incoming Inspection)
  else if (process.processId === "PR/R/003") {
    const inspectionProcess = await Process.findOne({ processId: "QA/R/003" });
    if (inspectionProcess) {
      const inspectionRow = {
        items: [
          {
            key: "PART NO",
            value: items.find((i) => i.key === "PART NO")?.value,
            process: "value",
          },
          {
            key: "PART NAME",
            value: items.find((i) => i.key === "PART NAME")?.value,
            process: "value",
          },
          {
            key: "ITEM CATEGORY",
            value: items.find((i) => i.key === "ITEM CATEGORY")?.value,
            process: "value",
          },
          {
            key: "ITEM CODE",
            value: items.find((i) => i.key === "ITEM CODE")?.value,
            process: "value",
          },
          {
            key: "ITEM NAME",
            value: items.find((i) => i.key === "ITEM NAME")?.value,
            process: "value",
          },
          {
            key: "GRADE",
            value: items.find((i) => i.key === "GRADE")?.value,
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
            key: "VENDOR NAME",
            value: items.find((i) => i.key === "VENDOR NAME")?.value,
            process: "value",
          },
          { key: "INVOICE NO", value: "", process: "value" },
          { key: "DELIVER DATE", value: "", process: "date" },
          {
            key: "QUALITY INSPECTION",
            value: "QA/R/003A",
            process: "processId",
          },
          { key: "INSPECTION-STATUS", value: "", process: "select" },
        ],
        rowDataId,
      };

      for (const item of inspectionRow.items) {
            if (item.process === "processId" && item.value) {
              const relatedProcess = await Process.findOne({
                processId: item.value,
              });
              if (relatedProcess?._id) {
                item.value = `processId - ${relatedProcess._id}`;
                item.process = "";
              }
            }
          }

      inspectionProcess.data.push(inspectionRow);
      inspectionProcess.updatedBy = userId;
      await inspectionProcess.save();
    }
  }

  // --- MR/R/001 → PR/R/003 ---- Production Plan -> Procurement Register
  else if (process.processId === "MR/R/001") {
    const procurementRegisterProcess = await Process.findOne({
      processId: "PR/R/003",
    });
    const BOM = await Process.findOne({ processId: "DD/R/002" });
    const Products = await Process.findOne({ processId: "DD/R/002A" });

    const MoveItem = items.find((i) => i.key === "RM")?.value;

    if (MoveItem === "Blue" && procurementRegisterProcess && BOM && Products) {
      const planNo = items.find((i) => i.key === "PLAN NO")?.value;
      const date = items.find((i) => i.key === "DATE")?.value;
      const partNo = items.find((i) => i.key === "PART-NO")?.value;
      const partName = items.find((i) => i.key === "PART-NAME")?.value;
      const type = items.find((i) => i.key === "TYPE")?.value;
      const material = items.find((i) => i.key === "MATERIAL")?.value;
      const planQty = parseFloat(
        items.find((i) => i.key === "PLAN QTY")?.value || 0
      );

      // Build lookup for BOM
      const bomDict = Object.fromEntries(
        BOM.data.map((b) => [b._id.toString(), b])
      );

      // Find matching products
      const matchingProducts = Products.data.filter((productRow) => {
        const p = Object.fromEntries(
          productRow.items.map((i) => [i.key, i.value])
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
            bomRow.items.map((i) => [i.key, i.value])
          );
          const totalQty = parseFloat(b["QTY"] || 0) * planQty;

          const procurementRegisterRow = {
            items: [
              { key: "DATE", value: date, process: "date" },
              { key: "PL NO", value: planNo, process: "value" },
              { key: "PART NO", value: partNo, process: "value" },
              { key: "PART NAME", value: partName, process: "value" },
              { key: "TYPE", value: type, process: "value" },
              { key: "MATERIAL", value: material, process: "value" },
              { key: "ITEM CATEGORY", value: "", process: "value" },
              { key: "ITEM CODE", value: b["ITEM CODE"], process: "value" },
              { key: "ITEM NAME", value: b["ITEM-NAME"], process: "value" },
              { key: "GRADE", value: b["GRADE"], process: "value" },
              { key: "QTY", value: totalQty.toString(), process: "value" },
              { key: "UNITS", value: "", process: "value" },
              { key: "VENDOR NAME", value: "", process: "value" },
              { key: "VALUE", value: "", process: "value" },
              { key: "PO NO", value: "", process: "value" },
              { key: "LEAD TIME", value: "", process: "value" },
              { key: "INWARD", value: "PR/R/003A", process: "processId" },
              { key: "PR STATUS", value: "", process: "value" },
            ],
            rowDataId,
          };

          // ✅ Apply processId linking logic properly
          for (const item of procurementRegisterRow.items) {
            if (item.process === "processId" && item.value) {
              const relatedProcess = await Process.findOne({
                processId: item.value,
              });
              if (relatedProcess?._id) {
                item.value = `processId - ${relatedProcess._id}`;
                item.process = "";
              }
            }
          }

          procurementRegisterProcess.data.push(procurementRegisterRow);
        }
      }

      procurementRegisterProcess.updatedBy = userId;
      await procurementRegisterProcess.save();
    }
  }

  // ---- DD/R/002 ---- Product Code Generation ----
  if (process.processId === "DD/R/002") {
    const itemListProcess = await Process.findOne({ processId: "PR/R/002" });

    if (itemListProcess) {
      // Extract item name and grade from incoming 'items'
      const inputItemName = items
        .find((i) => i.key === "ITEM NAME")
        ?.value?.trim();
      const inputItemGrade = items
        .find((i) => i.key === "ITEM GRADE")
        ?.value?.trim();

      if (!inputItemName || !inputItemGrade) return null;

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

      // If matched, extract and return ITEM CODE
      if (matchedRow) {
        const itemCode = matchedRow.items.find(
          (i) => i.key === "ITEM CODE"
        )?.value;
        return itemCode || null;
      } else {
        return null; // no match found
      }
    }

    return null; // no PR/R/002 process found
  }
};

exports.handleUpdateIntersection = async (
  process,
  items,
  row,
  userId,
  rowId,
  previousItems
) => {
  // ---- MR/R/003B (Rework) ----
  if (process.processId === "MR/R/003B") {
    const moveToItem = items.find((i) => i.key === "MOVE TO");
    if (moveToItem && moveToItem.value === "Rework") {
      const rejectionReport = await Process.findOne({ processId: "MR/R/003" });
      const reworkReport = await Process.findOne({ processId: "MR/R/003A" });

      if (rejectionReport && reworkReport) {
        const rejectionRow = rejectionReport.data.id(row.rowDataId);
        if (rejectionRow) {
          const partNo = rejectionRow.items.find(
            (i) => i.key === "PART NO"
          )?.value;
          const partName = rejectionRow.items.find(
            (i) => i.key === "PART NAME"
          )?.value;
          const problemDesc = rejectionRow.items.find(
            (i) => i.key === "PROBLEM DESCRIPTION"
          )?.value;
          const rejectStage = rejectionRow.items.find(
            (i) => i.key === "REJECT STAGE"
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
                value: items.find((i) => i.key === "ACTION PLAN")?.value || "",
                process: "value",
              },
              {
                key: "VERIFIED BY",
                value: items.find((i) => i.key === "VERIFIED BY")?.value || "",
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
    if (moveToItem && moveToItem.value === "OPEN") {
      const orderListProcess = await Process.findOne({ processId: "MS/R/006" });
      if (orderListProcess) {
        const orderListRow = {
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
              key: "ENQ BY",
              value: items.find((i) => i.key === "ENQ BY")?.value,
              process: "value",
            },
            {
              key: "CUSTOMER NAME",
              value: items.find((i) => i.key === "CUSTOMER NAME")?.value,
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
            { key: "VALUE", value: "", process: "value" },
          ],
        };
        orderListProcess.data.push(orderListRow);
        orderListProcess.updatedBy = userId;
        await orderListProcess.save();
      }
    }
  }

  // ---- MR/R/001 ----
  else if (process.processId === "MR/R/001") {
    const procurementProcess = await Process.findOne({ processId: "PR/R/003" });
    const planNumber = items.find((i) => i.key === "PLAN NO")?.value;
    const date = items.find((i) => i.key === "DATE")?.value;
    const partNo = items.find((i) => i.key === "PART NO")?.value;
    const partName = items.find((i) => i.key === "PART NAME")?.value;
    const type = items.find((i) => i.key === "TYPE")?.value;
    const material = items.find((i) => i.key === "MATERIAL")?.value;
    const planQty = Number(items.find((i) => i.key === "PLAN QTY")?.value);
    const previousPlanQty = Number(
      previousItems.find((i) => i.key === "PLAN QTY")?.value
    );

    if (procurementProcess && planNumber) {
      for (const prRow of procurementProcess.data) {
        const plNo = prRow.items.find((i) => i.key === "PL NO")?.value;
        if (plNo !== planNumber) continue;

        const prQuantity = Number(
          prRow.items.find((i) => i.key === "QTY")?.value || 0
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
      console.log("✅ Procurement data updated & saved successfully.");
    }
  }
};

exports.handleDeleteIntersection = async (process, rowId, userId) => {
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

  // ---- MR/R/001 → PR/R/003 ---- Production Plan
  else if (process.processId === "MR/R/001") {
    const procurementProcess = await Process.findOne({ processId: "PR/R/003" });
    const row = process.data.id(rowId);
    const planNumber = row.items.find((i) => i.key === "PLAN NO")?.value;

    if (procurementProcess) {
      const rowsToDelete = procurementProcess.data.filter(
        (r) => r.items.find((i) => i.key === "PL NO")?.value === planNumber
      );
      procurementProcess.data = procurementProcess.data.filter(
        (r) => !rowsToDelete.includes(r)
      );
      procurementProcess.updatedBy = userId;
      await procurementProcess.save();
    }
  }

  // ---- PR/R/003 → MR/R/001 ---- Procurement Register X
  else if (process.processId === "PR/R/003") {
    await deleteLinkedRows("MR/R/001", (row) => row.rowDataId === rowId);
  }
};
