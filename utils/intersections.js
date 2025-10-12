// utils/intersection.js
const Process = require('../models/process');
const History = require('../models/history');

/**
 * Handles intersection logic for addData
 */
exports.handleAddIntersection = async (process, items, rowDataId, userId) => {
  // ---- MR/R/003B (Action Taken -> Rework) ----
  if (process.processId === 'MR/R/003B') {
    const moveToItem = items.find(i => i.key === "MOVE TO");
    if (moveToItem && moveToItem.value === "Rework") {
      const rejectionProcess = await Process.findOne({ processId: "MR/R/003" });
      const rejectionRow = rejectionProcess?.data.id(rowDataId);

      if (rejectionRow) {
        const partNo = rejectionRow.items.find(i => i.key === "PART NO")?.value;
        const partName = rejectionRow.items.find(i => i.key === "PART NAME")?.value;
        const problemDesc = rejectionRow.items.find(i => i.key === "PROBLEM DESCRIPTION")?.value;
        const rejectStage = rejectionRow.items.find(i => i.key === "REJECT STAGE")?.value;
        const rejectQty = rejectionRow.items.find(i => i.key === "REJECT QTY")?.value || 0;

        const actionPlan = items.find(i => i.key === "ACTION PLANNING")?.value;
        const verifiedBy = items.find(i => i.key === "VERIFIED BY")?.value;
        const status = items.find(i => i.key === "ACTION PLAN STATUS")?.value;

        const reworkProcess = await Process.findOne({ processId: "MR/R/003A" });
        if (reworkProcess) {
          const reworkRow = {
            items: [
              { key: "PART NO", value: partNo, process: "value" },
              { key: "PART NAME", value: partName, process: "value" },
              { key: "PROBLEM DESCRIPTION", value: problemDesc, process: "value" },
              { key: "REWORK QTY", value: rejectQty, process: "value" },
              { key: "REJECT STAGE", value: rejectStage, process: "value" },
              { key: "ACTION PLAN", value: actionPlan, process: "value" },
              { key: "VERIFIED BY", value: verifiedBy, process: "value" },
              { key: "STATUS", value: status, process: "value" }
            ],
            rowDataId
          };
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
            changedBy: userId
          });
        }
      }
    }
  }

  // ---- MS/R/005 → MS/R/006 ---- (Quatation List -> Order List)
  else if (process.processId === 'MS/R/005') {
    const moveToItem = items.find(i => i.key === "QL STATUS");
    if (moveToItem && moveToItem.value === "OPEN") {
      const orderListProcess = await Process.findOne({ processId: "MS/R/006" });
      if (orderListProcess) {
        const orderListRow = {
          items: [
            { key: "DATE", value: items.find(i => i.key === "DATE")?.value, process: "value" },
            { key: "QUOTE NO", value: items.find(i => i.key === "QUOTATION NO")?.value, process: "value" },
            { key: "ENQ BY", value: items.find(i => i.key === "ENQ BY")?.value, process: "value" },
            { key: "CUSTOMER NAME", value: items.find(i => i.key === "CUSTOMER NAME")?.value, process: "value" },
            { key: "LOCATION", value: items.find(i => i.key === "LOCATION")?.value, process: "value" },
            { key: "DESCRIPTION", value: items.find(i => i.key === "DESCRIPTION")?.value, process: "value" },
            { key: "QTY", value: items.find(i => i.key === "QTY")?.value, process: "value" },
            { key: "UNITS", value: items.find(i => i.key === "UNITS")?.value, process: "value" },
            { key: "VALUE", value: '', process: "value" },
            { key: "ORDER DATE", value: '', process: "value" },
            { key: "PO NO", value: '', process: "value" },
            { key: "LEAD TIME", value: '', process: "value" },
            { key: "INVOICE NO", value: '', process: "value" },
            { key: "DELIVERY QTY", value: '', process: "value" },
            { key: "PENDING QTY", value: '', process: "value" },
            { key: "DELIVERY DATE", value: '', process: "value" },
            { key: "GRN", value: '', process: "value" },
            { key: "PAYMENT", value: '', process: "value" }
          ],
          rowDataId
        };
        orderListProcess.data.push(orderListRow);
        orderListProcess.updatedBy = userId;
        await orderListProcess.save();
      }
    }
  }

  // ---- PR/R/003 → QA/R/003 ---- (Procurement Report -> Incoming Inspection)
  else if (process.processId === 'PR/R/003') {
    const inspectionProcess = await Process.findOne({ processId: "QA/R/003" });
    if (inspectionProcess) {
      const inspectionRow = {
        items: [
          { key: "PART NO", value: items.find(i => i.key === "PART NO")?.value, process: "value" },
          { key: "PART NAME", value: items.find(i => i.key === "PART NAME")?.value, process: "value" },
          { key: "ITEM CATEGORY", value: items.find(i => i.key === "ITEM CATEGORY")?.value, process: "value" },
          { key: "ITEM CODE", value: items.find(i => i.key === "ITEM CODE")?.value, process: "value" },
          { key: "ITEM NAME", value: items.find(i => i.key === "ITEM NAME")?.value, process: "value" },
          { key: "GRADE", value: items.find(i => i.key === "GRADE")?.value, process: "value" },
          { key: "QTY", value: items.find(i => i.key === "QTY")?.value, process: "value" },
          { key: "UNITS", value: items.find(i => i.key === "UNITS")?.value, process: "value" },
          { key: "VENDOR NAME", value: items.find(i => i.key === "VENDOR NAME")?.value, process: "value" },
          { key: 'INVOICE NO', value: '', process: "value" },
          { key: 'DELIVER DATE', value: '', process: "date" },
          { key: 'QUALITY INSPECTION', value: 'QA/R/003A', process: "processId" },
          { key: 'INSPECTION-STATUS', value: '', process: "select" },
        ],
        rowDataId
      };

      inspectionProcess.data.push(inspectionRow);
      inspectionProcess.updatedBy = userId;
      await inspectionProcess.save();
    }
  }
   
};

exports.handleUpdateIntersection = async (process, row, items, userId) => {
  // ---- MR/R/003B (Rework) ----
  if (process.processId === "MR/R/003B") {
    const moveToItem = items.find(i => i.key === "MOVE TO");
    if (moveToItem && moveToItem.value === "Rework") {
      const rejectionReport = await Process.findOne({ processId: "MR/R/003" });
      const reworkReport = await Process.findOne({ processId: "MR/R/003A" });

      if (rejectionReport && reworkReport) {
        const rejectionRow = rejectionReport.data.id(row.rowDataId);
        if (rejectionRow) {
          const partNo = rejectionRow.items.find(i => i.key === "PART NO")?.value;
          const partName = rejectionRow.items.find(i => i.key === "PART NAME")?.value;
          const problemDesc = rejectionRow.items.find(i => i.key === "PROBLEM DESCRIPTION")?.value;
          const rejectStage = rejectionRow.items.find(i => i.key === "REJECT STAGE")?.value;

          const reworkRow = {
            items: [
              { key: "PART NO", value: partNo || "", process: "value" },
              { key: "PART NAME", value: partName || "", process: "value" },
              { key: "PROBLEM DESCRIPTION", value: problemDesc || "", process: "value" },
              { key: "REWORK QTY", value: "0", process: "value" },
              { key: "REJECT STAGE", value: rejectStage || "", process: "value" },
              { key: "ACTION PLAN", value: items.find(i => i.key === "ACTION PLAN")?.value || "", process: "value" },
              { key: "VERIFIED BY", value: items.find(i => i.key === "VERIFIED BY")?.value || "", process: "value" },
              { key: "STATUS", value: items.find(i => i.key === "ACTION PLAN STATUS")?.value || "", process: "value" },
            ],
            rowDataId: row.rowDataId
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
            changedBy: userId
          });
        }
      }
    }
  }

  // ---- MS/R/005 → MS/R/006 ----
  else if (process.processId === "MS/R/005") {
    const moveToItem = items.find(i => i.key === "QL STATUS");
    if (moveToItem && moveToItem.value === "OPEN") {
      const orderListProcess = await Process.findOne({ processId: "MS/R/006" });
      if (orderListProcess) {
        const orderListRow = {
          items: [
            { key: "DATE", value: items.find(i => i.key === "DATE")?.value, process: "value" },
            { key: "QUOTE NO", value: items.find(i => i.key === "QUOTATION NO")?.value, process: "value" },
            { key: "ENQ BY", value: items.find(i => i.key === "ENQ BY")?.value, process: "value" },
            { key: "CUSTOMER NAME", value: items.find(i => i.key === "CUSTOMER NAME")?.value, process: "value" },
            { key: "LOCATION", value: items.find(i => i.key === "LOCATION")?.value, process: "value" },
            { key: "DESCRIPTION", value: items.find(i => i.key === "DESCRIPTION")?.value, process: "value" },
            { key: "QTY", value: items.find(i => i.key === "QTY")?.value, process: "value" },
            { key: "UNITS", value: items.find(i => i.key === "UNITS")?.value, process: "value" },
            { key: "VALUE", value: '', process: "value" }
          ]
        };
        orderListProcess.data.push(orderListRow);
        orderListProcess.updatedBy = userId;
        await orderListProcess.save();
      }
    }
  }
};
