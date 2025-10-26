exports.handleDeleteIntersection = async (process, rowId, userId) => {
  // ---- DD/R/001 → DD/R/002, DD/R/002A, DD/R/003, DD/R/004, DD/R/005, QA/R/009 ---- Product List.
  if (process.processId === "DD/R/001") {
    const bomProcess = await Process.findOne({ processId: "DD/R/002" });
    const ProductsProcess = await Process.findOne({ processId: "DD/R/002A" });
    const technicalSpecificationProcess = await Process.findOne({
      processId: "DD/R/003",
    });
    const drawingControlProcess = await Process.findOne({
      processId: "DD/R/004",
    });
    const revisionControlProcess = await Process.findOne({
      processId: "DD/R/005",
    });
    const processControlProcess = await Process.findOne({
      processId: "QA/R/009",
    });

    if (drawingControlProcess) {
      const drawingRowsToDelete = drawingControlProcess.data.filter(
        (drawingRow) => {
          return drawingRow.rowDataId === rowId;
        }
      );
      drawingControlProcess.data = drawingControlProcess.data.filter(
        (drawingRow) => !drawingRowsToDelete.includes(drawingRow)
      );
      drawingControlProcess.updatedBy = userId;
      await drawingControlProcess.save();
    }

    if (revisionControlProcess) {
      const revisionRowsToDelete = revisionControlProcess.data.filter(
        (revisionRow) => {
          return revisionRow.rowDataId === rowId;
        }
      );

      revisionControlProcess.data = revisionControlProcess.data.filter(
        (revisionRow) => !revisionRowsToDelete.includes(revisionRow)
      );
      revisionControlProcess.updatedBy = userId;
      await revisionControlProcess.save();
    }

    if (processControlProcess) {
      const processRowsToDelete = processControlProcess.data.filter(
        (processRow) => {
          return processRow.rowDataId === rowId;
        }
      );
      processControlProcess.data = processControlProcess.data.filter(
        (processRow) => !processRowsToDelete.includes(processRow)
      );
      processControlProcess.updatedBy = userId;
      await processControlProcess.save();
    }

    if (technicalSpecificationProcess) {
      const techSpecRowsToDelete = technicalSpecificationProcess.data.filter(
        (techSpecRow) => {
          return techSpecRow.rowDataId === rowId;
        }
      );
      technicalSpecificationProcess.data =
        technicalSpecificationProcess.data.filter(
          (techSpecRow) => !techSpecRowsToDelete.includes(techSpecRow)
        );
      technicalSpecificationProcess.updatedBy = userId;
      await technicalSpecificationProcess.save();
    }

    if (ProductsProcess) {
      const productRowsToDelete = ProductsProcess.data.filter((productRow) => {
        return productRow.rowDataId === rowId;
      });
      ProductsProcess.data = ProductsProcess.data.filter(
        (productRow) => !productRowsToDelete.includes(productRow)
      );
      ProductsProcess.updatedBy = userId;
      await ProductsProcess.save();
    }

    if (bomProcess) {
      const bomRowsToDelete = bomProcess.data.filter((bomRow) => {
        return bomRow.rowDataId === rowId;
      });
      bomProcess.data = bomProcess.data.filter(
        (bomRow) => !bomRowsToDelete.includes(bomRow)
      );
      bomProcess.updatedBy = userId;
      await bomProcess.save();
    }
  }
  // ---- DD/R/002 → DD/R/012, DD/R/014, DD/R/008 ---- NPD Register
  else if (process.processId === "DD/R/010") {
    const protoProcess = await Process.findOne({ processId: "DD/R/012" });
    const validationProcess = await Process.findOne({ processId: "DD/R/014" });
    const masterProcess = await Process.findOne({ processId: "DD/R/008" });

    console.log(
      protoProcess.process,
      validationProcess.process,
      masterProcess.process
    );

    if (protoProcess) {
      const protoRowsToDelete = protoProcess.data.filter((protoRow) => {
        return protoRow.rowDataId === rowId;
      });
      protoProcess.data = protoProcess.data.filter(
        (protoRow) => !protoRowsToDelete.includes(protoRow)
      );
      protoProcess.updatedBy = userId;
      await protoProcess.save();
    }

    if (validationProcess) {
      const validationRowsToDelete = validationProcess.data.filter(
        (validationRow) => {
          return validationRow.rowDataId === rowId;
        }
      );
      validationProcess.data = validationProcess.data.filter(
        (validationRow) => !validationRowsToDelete.includes(validationRow)
      );
      validationProcess.updatedBy = userId;
      await validationProcess.save();
    }

    if (masterProcess) {
      const masterRowsToDelete = masterProcess.data.filter((masterRow) => {
        return masterRow.rowDataId === rowId;
      });
      masterProcess.data = masterProcess.data.filter(
        (masterRow) => !masterRowsToDelete.includes(masterRow)
      );
      masterProcess.updatedBy = userId;
      await masterProcess.save();
    }
  }
  // ---- MR/R/002 → MR/R/002A, MR/R/002B ---- Production Report
  else if (process.processId === "MR/R/002") {
    const settingProcess = await Process.findOne({ processId: "MR/R/002A" });
    const breakHourProcess = await Process.findOne({ processId: "MR/R/002B" });

    if (settingProcess) {
      const settingRowsToDelete = settingProcess.data.filter((settingRow) => {
        return settingRow.rowDataId === rowId;
      });
      settingProcess.data = settingProcess.data.filter(
        (settingRow) => !settingRowsToDelete.includes(settingRow)
      );
      settingProcess.updatedBy = userId;
      await settingProcess.save();
    }

    if (breakHourProcess) {
      const breakHourRowsToDelete = breakHourProcess.data.filter(
        (breakHourRow) => {
          return breakHourRow.rowDataId === rowId;
        }
      );
      breakHourProcess.data = breakHourProcess.data.filter(
        (breakHourRow) => !breakHourRowsToDelete.includes(breakHourRow)
      );
      breakHourProcess.updatedBy = userId;
      await breakHourProcess.save();
    }
  }

  // ---- MR/R/003B → MR/R/003 ---- Rejection Report
  else if (process.processId === "MR/R/003") {
    const actionTakenProcess = await Process.findOne({
      processId: "MR/R/003B",
    });
    if (actionTakenProcess) {
      const actionTakenRowsToDelete = actionTakenProcess.data.filter(
        (actionTakenRow) => {
          return actionTakenRow.rowDataId === rowId;
        }
      );
      actionTakenProcess.data = actionTakenProcess.data.filter(
        (actionTakenRow) => !actionTakenRowsToDelete.includes(actionTakenRow)
      );
      actionTakenProcess.updatedBy = userId;
      await actionTakenProcess.save();
    }
  }

  // ---- MR/R/003A → QA/R/007A ---- Rework Report
  else if (process.processId === "MR/R/003A") {
    const actionPlanProcess = await Process.findOne({ processId: "QA/R/007A" });
    if (actionPlanProcess) {
      const actionPlanRowsToDelete = actionPlanProcess.data.filter(
        (actionPlanRow) => {
          return actionPlanRow.rowDataId === rowId;
        }
      );
      actionPlanProcess.data = actionPlanProcess.data.filter(
        (actionPlanRow) => !actionPlanRowsToDelete.includes(actionPlanRow)
      );
      actionPlanProcess.updatedBy = userId;
      await actionPlanProcess.save();
    }
  }

  // ---- QA/R/003 → QA/R/003A ---- Incoming Inspection
  else if (process.processId === "QA/R/003") {
    const qualityInspectionProcess = await Process.findOne({
      processId: "QA/R/003A",
    });

    if (qualityInspectionProcess) {
      const qualityInspectionRowsToDelete =
        qualityInspectionProcess.data.filter((qualityInspectionRow) => {
          return qualityInspectionRow.rowDataId === rowId;
        });
      qualityInspectionProcess.data = qualityInspectionProcess.data.filter(
        (qualityInspectionRow) =>
          !qualityInspectionRowsToDelete.includes(qualityInspectionRow)
      );
      qualityInspectionProcess.updatedBy = userId;
      await qualityInspectionProcess.save();
    }
  }

  // ---- QA/R/007 → QA/R/007A ---- Customer Complient Register
  else if (process.processId === "QA/R/007") {
    const actionPlanProcess = await Process.findOne({ processId: "QA/R/007A" });

    if (actionPlanProcess) {
      const actionPlanRowsToDelete = actionPlanProcess.data.filter(
        (actionPlanRow) => {
          return actionPlanRow.rowDataId === rowId;
        }
      );
      actionPlanProcess.data = actionPlanProcess.data.filter(
        (actionPlanRow) => !actionPlanRowsToDelete.includes(actionPlanRow)
      );
      actionPlanProcess.updatedBy = userId;
      await actionPlanProcess.save();
    }
  }

  // ---- QA/F/005 → QA/F/005A ---- Calibration Register
  else if (process.processId === "QA/F/005") {
    const nextScheduleProcess = await Process.findOne({
      processId: "QA/F/005A",
    });

    if (nextScheduleProcess) {
      const nextScheduleRowsToDelete = nextScheduleProcess.data.filter(
        (nextScheduleRow) => {
          return nextScheduleRow.rowDataId === rowId;
        }
      );
      nextScheduleProcess.data = nextScheduleProcess.data.filter(
        (nextScheduleRow) => !nextScheduleRowsToDelete.includes(nextScheduleRow)
      );
      nextScheduleProcess.updatedBy = userId;
      await nextScheduleProcess.save();
    }
  }

  // ---- MR/R/005 → MR/R/005A ---- Improvement Status
  else if (process.processId === "MR/R/005") {
    const improvementStatus = await Process.findOne({ processId: "MR/R/005A" });

    if (improvementStatus) {
      const improvementStatusRowsToDelete = improvementStatus.data.filter(
        (improvementStatusRow) => {
          return improvementStatusRow.rowDataId === rowId;
        }
      );
      improvementStatus.data = improvementStatus.data.filter(
        (improvementStatusRow) =>
          !improvementStatusRowsToDelete.includes(improvementStatusRow)
      );
      improvementStatus.updatedBy = userId;
      await improvementStatus.save();
    }
  }

  // ---- MN/R/003 → QA/F/005A ---- Maintenance Report
  else if (process.processId === "MN/R/003") {
    const nextScheduleProcess = await Process.findOne({
      processId: "QA/F/005A",
    });
    if (nextScheduleProcess) {
      const nextScheduleRowsToDelete = nextScheduleProcess.data.filter(
        (nextScheduleRow) => {
          return nextScheduleRow.rowDataId === rowId;
        }
      );
      nextScheduleProcess.data = nextScheduleProcess.data.filter(
        (nextScheduleRow) => !nextScheduleRowsToDelete.includes(nextScheduleRow)
      );
      nextScheduleProcess.updatedBy = userId;
      await nextScheduleProcess.save();
    }
  }

  // ---- MR/R/001 → PR/R/003 ---- Production Plan
  else if (process.processId === "MR/R/001") {
    const procurementProcess = await Process.findOne({ processId: "PR/R/003" });
    const row = process.data.id(rowId);
    const planNumber = row.items.find((i) => i.key === "PLAN NO")?.value;

    if (procurementProcess) {
      // delete the same planNumber in the procurementProcess
      const procurementRowsToDelete = procurementProcess.data.filter(
        (procurementRow) => {
          return (
            procurementRow.items.find((i) => i.key === "PL NO")?.value ===
            planNumber
          );
        }
      );
      procurementProcess.data = procurementProcess.data.filter(
        (procurementRow) => !procurementRowsToDelete.includes(procurementRow)
      );
      procurementProcess.updatedBy = userId;
      await procurementProcess.save();
    }
  }

  // ---- PR/R/003 → MR/R/001 ---- Procurement Register X
  else if (process.processId === "PR/R/003") {
    const productionProcess = await Process.findOne({ processId: "MR/R/001" });

    if (productionProcess) {
      const productionRowsToDelete = productionProcess.data.filter(
        (productionRow) => {
          return productionRow.rowDataId === rowId;
        }
      );
      productionProcess.data = productionProcess.data.filter(
        (productionRow) => !productionRowsToDelete.includes(productionRow)
      );
      productionProcess.updatedBy = userId;
      await productionProcess.save();
    }
  }
};

// ---- Rework Sync Logic for Action Taken ----
    if (process.processId === 'MR/R/003B') {
        const moveToItem = items.find(i => i.key === "MOVE TO");
        if (moveToItem && moveToItem.value === "Rework") {
            // find rejection row by rowDataId
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
                    reworkProcess.updatedBy = req.user._id;
                    await reworkProcess.save();
                }
            }
        }
    } else if (process.processId === 'MS/R/005') {
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
                orderListProcess.updatedBy = req.user._id;
                await orderListProcess.save();
            }
        }
    } else if (process.processId === 'PR/R/003') {
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
                    { key: 'QTY', value: '', process: "value" },
                    { key: 'QUALITY INSPECTION', value: 'QA/R/003A', process: "processId" },
                    { key: 'INSPECTION-STATUS', value: '', process: "select" },
                ],
                rowDataId
            };

            for (let i = 0; i < items.length; i++) {
                const relatedProcess = await Process.findOne({ processId: items[i].value });

                if (relatedProcess && relatedProcess._id) {
                    items[i] = {
                        key: items[i].key,
                        value: `processId - ${relatedProcess._id}`,
                        process: ''
                    };
                }
            }

            inspectionProcess.data.push(inspectionRow);
            inspectionProcess.updatedBy = req.user._id;
            await inspectionProcess.save();
        }
    }