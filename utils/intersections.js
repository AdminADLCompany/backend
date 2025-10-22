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

    // ---- PR/R/003 → QA/R/003 ---- (Procurement Register -> Incoming Inspection)
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

    // --- MR/R/001 → PR/R/003 ---- Production Plan -> Procurement Register
    else if (process.processId === 'MR/R/001') {
        const procurementRegisterProcess = await Process.findOne({ processId: "PR/R/003" });
        const BOM = await Process.findOne({ processId: "DD/R/002" });
        const Products = await Process.findOne({ processId: "DD/R/002A" });

        const MoveItem = items.find(i => i.key === "RM")?.value;

        if (MoveItem === 'Orange' && procurementRegisterProcess && BOM && Products) {
            const planNo = items.find(i => i.key === "PLAN NO")?.value;
            const date = items.find(i => i.key === "DATE")?.value;
            const partNo = items.find(i => i.key === "PART NO")?.value;
            const partName = items.find(i => i.key === "PART NAME")?.value;
            const type = items.find(i => i.key === "TYPE")?.value;
            const material = items.find(i => i.key === "MATERIAL")?.value;
            const planQty = parseFloat(items.find(i => i.key === "PLAN QTY")?.value || 0);

            // Pre-build a lookup dictionary for BOM rows
            const bomDict = {};
            BOM.data.forEach(bomRow => {
                bomDict[bomRow._id.toString()] = bomRow;
            });

            // Filter Products that match partNo, partName, type, material
            const matchingProducts = Products.data.filter(productRow => {
                const pPartNo = productRow.items.find(i => i.key === "PART NO")?.value;
                const pPartName = productRow.items.find(i => i.key === "PART NAME")?.value;
                const pType = productRow.items.find(i => i.key === "TYPE")?.value;
                const pMaterial = productRow.items.find(i => i.key === "MATERIAL")?.value;

                return pPartNo === partNo && pPartName === partName && pType === type && pMaterial === material;
            });

            matchingProducts.forEach(productRow => {
                const detailingIds = productRow.items.find(i => i.key === "DETAILING PRODUCT")?.value || [];
                detailingIds.forEach(bomId => {
                    const bomRow = bomDict[bomId.toString()];
                    if (!bomRow) return console.log('BOM row not found for id', bomId);

                    const itemCode = bomRow.items.find(i => i.key === "ITEM CODE")?.value || "";
                    const itemName = bomRow.items.find(i => i.key === "ITEM NAME")?.value || "";
                    const grade = bomRow.items.find(i => i.key === "GRADE")?.value || "";
                    const bomQty = parseFloat(bomRow.items.find(i => i.key === "QTY")?.value || 0);
                    const totalQty = bomQty * planQty;

                    const procurementRegisterRow = {
                        items: [
                            { key: "DATE", value: date, process: "date" },
                            { key: "PL NO", value: planNo, process: "value" },
                            { key: "PART NO", value: partNo, process: "value" },
                            { key: "PART NAME", value: partName, process: "value" },
                            { key: "TYPE", value: type, process: "value" },
                            { key: "MATERIAL", value: material, process: "value" },
                            { key: "ITEM CATEGORY", value: "", process: "value" },
                            { key: "ITEM CODE", value: itemCode, process: "value" },
                            { key: "ITEM NAME", value: itemName, process: "value" },
                            { key: "GRADE", value: grade, process: "value" },
                            { key: "QTY", value: totalQty.toString(), process: "value" },
                            { key: "UNITS", value: "", process: "value" },
                            { key: "VENDOR NAME", value: "", process: "value" },
                            { key: "VALUE", value: "", process: "value" },
                            { key: "PO NO", value: "", process: "value" },
                            { key: "LEAD TIME", value: "", process: "value" },
                            { key: "INWARD", value: "", process: "value" },
                            { key: "PR STATUS", value: "", process: "value" },
                        ],
                        rowDataId: rowDataId
                    };

                    procurementRegisterProcess.data.push(procurementRegisterRow);
                });
            });

            // Save the updated procurement register
            procurementRegisterProcess.updatedBy = userId;
            await procurementRegisterProcess.save();
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

exports.handleDeleteIntersection = async (process, rowId, userId) => {
  if (process.processId === "DD/R/001") {
    const bomProcess = await Process.findOne({ processId: "DD/R/002" });
    const ProductsProcess = await Process.findOne({ processId: "DD/R/002A" });
    // delete corresponding rows in bomProcess
    if (ProductsProcess) {
        const productRowsToDelete = ProductsProcess.data.filter(productRow => { return productRow.rowDataId === rowId; });
        ProductsProcess.data = ProductsProcess.data.filter(productRow => !productRowsToDelete.includes(productRow));
        ProductsProcess.updatedBy = userId;
        await ProductsProcess.save();
    }
    if (bomProcess) {
        const bomRowsToDelete = bomProcess.data.filter(bomRow => { return bomRow.rowDataId === rowId; });
        bomProcess.data = bomProcess.data.filter(bomRow => !bomRowsToDelete.includes(bomRow));
        bomProcess.updatedBy = userId;
        await bomProcess.save();
    }
  }
}