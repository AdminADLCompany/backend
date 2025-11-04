// utils/intersection.js
const Process = require("../models/process");
const History = require("../models/history");

/**
 * Handles intersection logic for addData
 */
// Helper: Link processId values to actual ObjectIds
const linkProcessIdItems = async (rowItems) => {
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

        const verifiedBy = items.find((i) => i.key === "VERIFIED BY")?.value;
        const status = items.find((i) => i.key === "ACTION PLAN STATUS")?.value;

        const reworkProcess = await Process.findOne({ processId: "MR/R/003A" });
        if (reworkProcess) {
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
              { key: "ACTION PLAN", value: "QA/R/007A", process: "processId" },
              { key: "VERIFIED BY", value: verifiedBy, process: "value" },
              { key: "STATUS", value: status, process: "value" },
            ],
            rowDataId,
          };

          reworkRow.items = await linkProcessIdItems(reworkRow.items);

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

  // ---- MS/R/005 → MS/R/006 ---- (Quotation List -> Order List)
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

  // ---- PR/R/003A → QA/R/003 ---- (Inward -> Incoming Inspection)
  else if (process.processId === "PR/R/003A") {
    const inspectionProcess = await Process.findOne({ processId: "QA/R/003" });
    const procurementProcess = await Process.findOne({ processId: "PR/R/003" });
    const storeRegisterProcess = await Process.findOne({
      processId: "ST/R/005",
    });

    if (!inspectionProcess || !procurementProcess || !storeRegisterProcess)
      return;

    // find the data in procurementProcess with the rowDataId
    const procurementRow = procurementProcess.data.find(
      (row) => row._id.toString() === rowDataId
    );

    console.log("Procurement Row:", procurementRow);

    if (!procurementRow) return;

    const isMoving = items.find(
      (i) => i.key === "QC QUALITY INSPECTION"
    )?.value;

    if (inspectionProcess && isMoving === "Move to Inspection") {
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

    if (storeRegisterProcess) {
      const storeRegisterRow = {
        items: [
          {
            key: "DATE",
            value: items.find((i) => i.key === "DELIVERY DATE")?.value,
            process: "value",
          },
          {
            key: "IN", // Assuming "IN / OUT".
            value: items.find((i) => i.key === "QTY")?.value,
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
            key: "VENDOR / CUSTOMER",
            value: procurementRow.items.find((i) => i.key === "VENDOR-NAME")
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
            value: items.find((i) => i.key === "INVOICE NO")?.value,
            process: "value",
          },
        ],
      };
      storeRegisterProcess.data.push(storeRegisterRow);
      storeRegisterProcess.updatedBy = userId;
      await storeRegisterProcess.save();
    }
  }

  // --- MR/R/001 → PR/R/003 ---- Production Plan -> Procurement Register
  else if (process.processId === "MR/R/001") {
    const procurementRegisterProcess = await Process.findOne({
      processId: "PR/R/003",
    });
    const itemListProcess = await Process.findOne({ processId: "PR/R/002" });
    const vendorListProcess = await Process.findOne({ processId: "PR/R/004" });

    const BOM = await Process.findOne({ processId: "DD/R/002" });
    const Products = await Process.findOne({ processId: "DD/R/002A" });
    if (!procurementRegisterProcess || !BOM || !Products) return;

    const MoveItem = items.find((i) => i.key === "RM")?.value;
    if (MoveItem !== "Blue") return;

    const planNo = items.find((i) => i.key === "PLAN NO")?.value;
    const date = items.find((i) => i.key === "DATE")?.value;
    const partNo = items.find((i) => i.key === "PART-NO")?.value;
    const partName = items.find((i) => i.key === "PART-NAME")?.value;
    const type = items.find((i) => i.key === "TYPE")?.value;
    const material = items.find((i) => i.key === "MATERIAL")?.value;
    const planQty = parseFloat(
      items.find((i) => i.key === "PLAN QTY")?.value || 0
    );

    const bomDict = Object.fromEntries(
      BOM.data.map((b) => [b._id.toString(), b])
    );
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

        const b = Object.fromEntries(bomRow.items.map((i) => [i.key, i.value]));
        const totalQty = parseFloat(b["QTY"] || 0) * planQty;

        const inputItemCode = b["ITEM CODE"];

        const matchRow = itemListProcess.data.find((itemRow) => {
          const rowItemCode = itemRow.items
            .find((i) => i.key === "ITEM CODE")
            ?.value?.trim();
          return rowItemCode === inputItemCode;
        });

        const vendorNameMatch = vendorListProcess.data.find((vendorRow) => {
          const vendorItemCategory = vendorRow.items
            .find((i) => i.key === "ITEM CATEGORY")
            ?.value?.trim();
          return vendorItemCategory ===  matchRow.items.find((i) => i.key === "ITEM CATEGORY")?.value;
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
                matchRow.items.find((i) => i.key === "ITEM CATEGORY")?.value ||
                "",
            },
            { key: "ITEM CODE", value: b["ITEM CODE"] },
            { key: "ITEM NAME", value: b["ITEM-NAME"] },
            { key: "GRADE", value: b["GRADE"] },
            { key: "QTY", value: totalQty.toString() },
            { key: "UNITS", value: b["UNITS"] },
            { key: "VENDOR NAME", value: vendorNameMatch?.items.find((i) => i.key === "VENDOR NAME")?.value || "" },
            { key: "VALUE", value: "" },
            { key: "PO NO", value: "" },
            { key: "LEAD TIME", value: "" },
            { key: "INWARD", value: "PR/R/003A", process: "processId" },
            { key: "PR STATUS", value: "" },
          ],
          rowDataId,
        };

        procurementRegisterRow.items = await linkProcessIdItems(
          procurementRegisterRow.items
        );

        procurementRegisterProcess.data.push(procurementRegisterRow);
      }
    }

    procurementRegisterProcess.updatedBy = userId;
    await procurementRegisterProcess.save();
  }

  // ---- DD/R/002 ---- Product Code Generation ----
  else if (process.processId === "DD/R/002") {
    const itemListProcess = await Process.findOne({ processId: "PR/R/002" });
    if (!itemListProcess) return null;

    const inputItemName = items
      .find((i) => i.key === "ITEM NAME")
      ?.value?.trim();
    const inputItemGrade = items
      .find((i) => i.key === "ITEM GRADE")
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

    return matchedRow?.items.find((i) => i.key === "ITEM CODE")?.value ?? null;
  }

  // ---- PR/R/002 → ST/R/006 ---- Item List -> Stock Data ----
  else if (process.processId === "PR/R/002") {
    const stockDataProcess = await Process.findOne({ processId: "ST/R/006" });

    if (!stockDataProcess) return;

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

  // ---- MR/R/006 → ST/R/005 ---- Item List -> Store Register ----
  else if (process.processId === "MR/R/006") {
    const storeRegisterProcess = await Process.findOne({
      processId: "ST/R/005",
    });
    const itemListProcess = await Process.findOne({ processId: "PR/R/002" });

    if (!storeRegisterProcess || !itemListProcess) return;

    const inputCode = items.find((i) => i.key === "ITEM CODE")?.value;

    const matchedRow = itemListProcess.data.find((itemRow) => {
      const rowItemCode = itemRow.items.find(
        (i) => i.key === "ITEM CODE"
      )?.value;
      return rowItemCode === inputCode;
    });

    if (!matchedRow) return;

    const itemName = matchedRow.items.find((i) => i.key === "ITEM NAME")?.value;
    const itemCode = matchedRow.items.find((i) => i.key === "ITEM CODE")?.value;
    const itemCategory = matchedRow.items.find(
      (i) => i.key === "ITEM CATEGORY"
    )?.value;

    const storeRegisterRow = {
      items: [
        {
          key: "DATE",
          value: items.find((i) => i.key === "DATE")?.value,
          process: "value",
        },
        {
          key: "IN",
          value: items.find((i) => i.key === "QTY")?.value,
          process: "value",
        },
        { key: "ITEM CATEGORY", value: itemCategory, process: "value" },
        { key: "ITEM CODE", value: itemCode, process: "value" },
        { key: "ITEM NAME", value: itemName, process: "value" },
        { key: "VENDOR / CUSTOMER", value: "In House", process: "value" },
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
    await storeRegisterProcess.save();
  }

  // ---- MS/R/006 → ST/R/005 ---- Item List -> Store Register ----
  else if (process.processId === "MS/R/006") {
    const storeRegisterProcess = await Process.findOne({
      processId: "ST/R/005",
    });

    const matchedRow = storeRegisterProcess.data.find((itemRow) => {
      const rowItemCode = itemRow.items.find(
        (i) => i.key === "ITEM CODE"
      )?.value;
      return rowItemCode === items.find((i) => i.key === "PART NO")?.value;
    });

    if (!matchedRow || !storeRegisterProcess) return;

    const storeRegisterRow = {
      items: [
        {
          key: "DATE",
          value: items.find((i) => i.key === "DATE")?.value,
          process: "value",
        },
        {
          key: "OUT",
          value: items.find((i) => i.key === "QTY")?.value,
          process: "value",
        },
        {
          key: "ITEM CATEGORY",
          value: matchedRow.items.find((i) => i.key === "ITEM CATEGORY")?.value,
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
    await storeRegisterProcess.save();
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

  // ---- MR/R/001 → PR/R/003 ----
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

  // ---- PR/R/003A → PR/R/003 ----
  else if (process.processId === "PR/R/003A") {
    // 1️⃣ Get Procurement Register process
    const procurementProcess = await Process.findOne({ processId: "PR/R/003" });
    if (!procurementProcess) return;

    // 2️⃣ Filter inward rows linked to the current rowDataId
    const matchRows = process.data.filter((r) => r.rowDataId === rowDataId);
    if (matchRows.length === 0) return;

    // 3️⃣ Check if ALL related inward rows have QC QUALITY INSPECTION = "Inspection Done"
    const allInspectionDone = matchRows.every(
      (row) =>
        row.items.find((i) => i.key === "QC QUALITY INSPECTION")?.value ===
        "Inspection Done"
    );

    // 4️⃣ If inspection done, find the corresponding procurement row and update status
    if (allInspectionDone) {
      const inwardRow = matchRows[0];

      const prRow = procurementProcess.data.find(
        (r) => r._id.toString() === inwardRow.rowDataId.toString()
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
