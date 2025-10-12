const Process = require('../models/process');
const History = require('../models/history');

const ErrorHandler = require("../utils/errorHandler");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const cloudinary = require("../config/cloudinary");
const { handleAddIntersection, handleUpdateIntersection} = require("../utils/intersections");

const ImageUploadArray = ["UPLOAD", "BEFORE", "AFTER", "CALIBRATION CERTIFICATE NO / DATE", "ACTION REPORT", "NPD FORM", "EVALUATE", "IMAGE"];

exports.getAllProcesses = catchAsyncErrors( async (req, res, next) => {
    // populate process and updatedBy
    const processes = await Process.find().populate('department').populate('updatedBy', 'userName email');

    res.status(200).json({
        success: true,
        data: processes
    });
});

exports.getProcessById = catchAsyncErrors( async (req, res, next) => {
    const process = await Process.findById(req.params.id).populate('department').populate('updatedBy', 'userName email');

    if (!process) {
        return next(new ErrorHandler("Process not found", 404));
    }

    res.status(200).json({
        success: true,
        data: process
    });
});

exports.getProcessByDepartmentId = catchAsyncErrors( async (req, res, next) => {
    const processes = await Process.find({ department: req.params.id }).populate('department').populate('updatedBy', 'userName email');

    res.status(200).json({
        success: true,
        data: processes
    });
})

exports.createProcess = catchAsyncErrors( async (req, res, next) => {

    const { process, headers, department, processId } = req.body;

    const processes = await Process.create({
        process,
        processId,
        headers,
        department,
        updatedBy: req.user._id
    });

    await processes.populate('department');
    await processes.populate('updatedBy', 'userName email');

    res.status(201).json({
        success: true,
        data: processes
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
    await process.populate('department');
    await process.populate('updatedBy', 'userName email');

    res.status(200).json({
        success: true,
        data: process
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

exports.addHeader = catchAsyncErrors( async (req, res, next) => {
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
        data: process
    });
});

exports.deleteHeader = catchAsyncErrors( async (req, res, next) => {
    const process = await Process.findById(req.params.id);
    const { headerName } = req.body;

    if (!process) {
        return next(new ErrorHandler("Process not found", 404));
    }
    process.headers = process.headers.filter(header => header !== headerName);
    process.updatedBy = req.user._id;

    await process.save();
    res.status(200).json({
        success: true,
        data: process
    });
});

// ADD new row
exports.addData = catchAsyncErrors(async (req, res, next) => {

    const process = await Process.findById(req.params.id);
    let { items, rowDataId } = req.body;

    if (!process) {
        return next(new ErrorHandler("Process not found", 404));
    }

    if (typeof items === "string") {
        items = JSON.parse(items); // ✅ convert string to array
    }

    // // ---- Rework Sync Logic for Action Taken ----
    // if (process.processId === 'MR/R/003B') {
    //     const moveToItem = items.find(i => i.key === "MOVE TO");
    //     if (moveToItem && moveToItem.value === "Rework") {
    //         // find rejection row by rowDataId
    //         const rejectionProcess = await Process.findOne({ processId: "MR/R/003" });
    //         const rejectionRow = rejectionProcess?.data.id(rowDataId);

    //         if (rejectionRow) {
    //             const partNo = rejectionRow.items.find(i => i.key === "PART NO")?.value;
    //             const partName = rejectionRow.items.find(i => i.key === "PART NAME")?.value;
    //             const problemDesc = rejectionRow.items.find(i => i.key === "PROBLEM DESCRIPTION")?.value;
    //             const rejectStage = rejectionRow.items.find(i => i.key === "REJECT STAGE")?.value;
    //             const rejectQty = rejectionRow.items.find(i => i.key === "REJECT QTY")?.value || 0;

    //             const actionPlan = items.find(i => i.key === "ACTION PLANNING")?.value;
    //             const verifiedBy = items.find(i => i.key === "VERIFIED BY")?.value;
    //             const status = items.find(i => i.key === "ACTION PLAN STATUS")?.value;

    //             const reworkProcess = await Process.findOne({ processId: "MR/R/003A" });
    //             if (reworkProcess) {
    //                 const reworkRow = {
    //                     items: [
    //                         { key: "PART NO", value: partNo, process: "value" },
    //                         { key: "PART NAME", value: partName, process: "value" },
    //                         { key: "PROBLEM DESCRIPTION", value: problemDesc, process: "value" },
    //                         { key: "REWORK QTY", value: rejectQty, process: "value" },
    //                         { key: "REJECT STAGE", value: rejectStage, process: "value" },
    //                         { key: "ACTION PLAN", value: actionPlan, process: "value" },
    //                         { key: "VERIFIED BY", value: verifiedBy, process: "value" },
    //                         { key: "STATUS", value: status, process: "value" }
    //                     ],
    //                     rowDataId
    //                 };
    //                 reworkProcess.data.push(reworkRow);
    //                 reworkProcess.updatedBy = req.user._id;
    //                 await reworkProcess.save();
    //             }
    //         }
    //     }
    // } else if (process.processId === 'MS/R/005') {
    //     const moveToItem = items.find(i => i.key === "QL STATUS");
    //     if (moveToItem && moveToItem.value === "OPEN") {
    //         const orderListProcess = await Process.findOne({ processId: "MS/R/006" });
    //         if (orderListProcess) {
    //             const orderListRow = {
    //                 items: [
    //                     { key: "DATE", value: items.find(i => i.key === "DATE")?.value, process: "value" },
    //                     { key: "QUOTE NO", value: items.find(i => i.key === "QUOTATION NO")?.value, process: "value" },
    //                     { key: "ENQ BY", value: items.find(i => i.key === "ENQ BY")?.value, process: "value" },
    //                     { key: "CUSTOMER NAME", value: items.find(i => i.key === "CUSTOMER NAME")?.value, process: "value" },
    //                     { key: "LOCATION", value: items.find(i => i.key === "LOCATION")?.value, process: "value" },
    //                     { key: "DESCRIPTION", value: items.find(i => i.key === "DESCRIPTION")?.value, process: "value" },
    //                     { key: "QTY", value: items.find(i => i.key === "QTY")?.value, process: "value" },
    //                     { key: "UNITS", value: items.find(i => i.key === "UNITS")?.value, process: "value" },
    //                     { key: "VALUE", value: '', process: "value" },
    //                     { key: "ORDER DATE", value: '', process: "value" },
    //                     { key: "PO NO", value: '', process: "value" },
    //                     { key: "LEAD TIME", value: '', process: "value" },
    //                     { key: "INVOICE NO", value: '', process: "value" },
    //                     { key: "DELIVERY QTY", value: '', process: "value" },
    //                     { key: "PENDING QTY", value: '', process: "value" },
    //                     { key: "DELIVERY DATE", value: '', process: "value" },
    //                     { key: "GRN", value: '', process: "value" },
    //                     { key: "PAYMENT", value: '', process: "value" }
    //                 ],
    //                 rowDataId
    //             };
    //             orderListProcess.data.push(orderListRow);
    //             orderListProcess.updatedBy = req.user._id;
    //             await orderListProcess.save();
    //         }
    //     }
    // } else if (process.processId === 'PR/R/003') {
    //     const inspectionProcess = await Process.findOne({ processId: "QA/R/003" });
    //     if (inspectionProcess) {
    //         const inspectionRow = {
    //             items: [
    //                 { key: "PART NO", value: items.find(i => i.key === "PART NO")?.value, process: "value" },
    //                 { key: "PART NAME", value: items.find(i => i.key === "PART NAME")?.value, process: "value" },
    //                 { key: "ITEM CATEGORY", value: items.find(i => i.key === "ITEM CATEGORY")?.value, process: "value" },
    //                 { key: "ITEM CODE", value: items.find(i => i.key === "ITEM CODE")?.value, process: "value" },
    //                 { key: "ITEM NAME", value: items.find(i => i.key === "ITEM NAME")?.value, process: "value" },
    //                 { key: "GRADE", value: items.find(i => i.key === "GRADE")?.value, process: "value" },
    //                 { key: "QTY", value: items.find(i => i.key === "QTY")?.value, process: "value" },
    //                 { key: "UNITS", value: items.find(i => i.key === "UNITS")?.value, process: "value" },
    //                 { key: "VENDOR NAME", value: items.find(i => i.key === "VENDOR NAME")?.value, process: "value" },
    //                 { key: 'INVOICE NO', value: '', process: "value" },
    //                 { key: 'DELIVER DATE', value: '', process: "date" },
    //                 { key: 'QTY', value: '', process: "value" },
    //                 { key: 'QUALITY INSPECTION', value: 'QA/R/003A', process: "processId" },
    //                 { key: 'INSPECTION-STATUS', value: '', process: "select" },
    //             ],
    //             rowDataId
    //         };

    //         for (let i = 0; i < items.length; i++) {
    //             const relatedProcess = await Process.findOne({ processId: items[i].value });

    //             if (relatedProcess && relatedProcess._id) {
    //                 items[i] = {
    //                     key: items[i].key,
    //                     value: `processId - ${relatedProcess._id}`,
    //                     process: ''
    //                 };
    //             }
    //         }

    //         inspectionProcess.data.push(inspectionRow);
    //         inspectionProcess.updatedBy = req.user._id;
    //         await inspectionProcess.save();
    //     }
    // }

    await handleAddIntersection(process, items, rowDataId, req.user._id);

    for (let i = 0; i < items.length; i++) {
        if (ImageUploadArray.includes(items[i].key) && req.files && req.files[items[i].key]) {
            const file = req.files[items[i].key][0]; // multer saves array for each key
            const result = await cloudinary.uploader.upload(file.path, {
                folder: "process_images"
            });
            items[i].value = result.secure_url; // store cloudinary URL
        }
    }

    // ---- Your Existing Logic ----
    for (let i = 0; i < items.length; i++) {
        if (items[i].process === 'processId' && items[i].value) {
            const relatedProcess = await Process.findOne({ processId: items[i].value });

            if (relatedProcess && relatedProcess._id) {
                items[i] = {
                    key: items[i].key,
                    value: `processId - ${relatedProcess._id}`,
                    process: ''
                };
            }
        }
    }

    // create new row
    const newRow = { items, rowDataId };
    process.data.push(newRow);
    process.updatedBy = req.user._id;
    await process.save();

    // log history
    await History.create({
        collectionName: "Process",
        documentId: process._id,
        rowId: process.data[process.data.length - 1]._id,
        operation: "create",
        oldData: null,
        newData: newRow,
        changedBy: req.user._id
    });


    res.status(200).json({
        success: true,
        process
    });
});

// UPDATE row by rowId
exports.updateData = catchAsyncErrors(async (req, res, next) => {
    const process = await Process.findById(req.params.id);
    let { rowId, items } = req.body;

    // Parse items if it's a string
    if (typeof items === "string") {
        items = JSON.parse(items);
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
        if (ImageUploadArray.includes(items[i].key) && req.files && req.files[items[i].key]) {
            const file = req.files[items[i].key][0];
            const result = await cloudinary.uploader.upload(file.path, {
                folder: "process_images"
            });
            items[i].value = result.secure_url;
        }
    }

    // Update row data
    row.items = items;
    process.updatedBy = req.user._id;
    await process.save();

    /** 🔥 Extra logic for Action Taken process */
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

                    // Prepare new rework row
                    const reworkRow = {
                        items: [
                            { key: "PART NO", value: partNo || "", process: "value" },
                            { key: "PART NAME", value: partName || "", process: "value" },
                            { key: "PROBLEM DESCRIPTION", value: problemDesc || "", process: "value" },
                            { key: "REWORK QTY", value: "0", process: "value" }, // default
                            { key: "REJECT STAGE", value: rejectStage || "", process: "value" },
                            { key: "ACTION PLAN", value: items.find(i => i.key === "ACTION PLAN")?.value || "", process: "value" },
                            { key: "VERIFIED BY", value: items.find(i => i.key === "VERIFIED BY")?.value || "", process: "value" },
                            { key: "STATUS", value: items.find(i => i.key === "ACTION PLAN STATUS")?.value || "", process: "value" },
                        ],
                        rowDataId: row.rowDataId, // 🔗 link to rejection row
                    };

                    reworkReport.data.push(reworkRow);
                    reworkReport.updatedBy = req.user._id;
                    await reworkReport.save();

                    // Log to history
                    await History.create({
                        collectionName: "Process",
                        documentId: reworkReport._id,
                        rowId: reworkReport.data[reworkReport.data.length - 1]._id,
                        operation: "create",
                        oldData: null,
                        newData: reworkRow,
                        changedBy: req.user._id
                    });
                }
            }
        }
    } else if (process.processId === "MS/R/005") {
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
                    ]
                };

                orderListProcess.data.push(orderListRow);
                orderListProcess.updatedBy = req.user._id;
                await orderListProcess.save();
            }
        }
    }

    // Save history for main process update
    await History.create({
        collectionName: "Process",
        documentId: process._id,
        rowId: row._id,
        operation: "update",
        oldData,
        newData: { items },
        changedBy: req.user._id
    });

    res.status(200).json({
        success: true,
        data: process
    });
});

// DELETE row by rowId
exports.deleteData = catchAsyncErrors(async (req, res, next) => {
    const process = await Process.findById(req.params.id);
    const { rowId } = req.body;

    if (!process) {
        return next(new ErrorHandler("Process not found", 404));
    }

    const row = process.data.id(rowId);
    if (!row) {
        return next(new ErrorHandler("Row not found", 404));
    }

    const oldData = { ...row.toObject() };

    // remove row
    process.data = process.data.filter(r => r._id.toString() !== rowId);
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
        changedBy: req.user._id
    });

    res.status(200).json({
        success: true,
        data: process
    });
});

exports.getaProcessHistory = catchAsyncErrors( async (req, res, next) => {
    const history = await History.find({ 
        collectionName: 'Process',
        documentId: req.params.id
    }).populate('changedBy', 'userName email').sort({ timestamp: -1 });

    res.status(200).json({
        success: true,
        data: history
    });
});

// GET /process/:processId/data/:rowId/history
exports.getProcessRowHistory = catchAsyncErrors(async (req, res, next) => {
  const { id, rowId } = req.params;

  const history = await History.find({
    collectionName: "Process",
    documentId: id,
    rowId: rowId
  })
    .populate("changedBy", "userName email")
    .sort({ timestamp: -1 });

  if (!history.length) {
    return next(new ErrorHandler("No history found for this row", 404));
  }

  res.status(200).json({
    success: true,
    data: history
  });
});

// Search Details
exports.getProductDetails = catchAsyncErrors(async (req, res, next) => {
    const process = await Process.findOne({ processId: "DD/R/002A" });

    if (!process || !process.data) {
        return ErrorHandler("Process not found", 404);
    }

    // Use Sets to remove duplicates
    const partNo = new Set();
    const partName = new Set();
    const type = new Set();
    const material = new Set();

    process.data.forEach(row => {
        const pNo = row.items.find(i => i.key === "PART NO")?.value;
        const pName = row.items.find(i => i.key === "PART NAME")?.value;
        const pType = row.items.find(i => i.key === "TYPE")?.value;
        const pMaterial = row.items.find(i => i.key === "MATERIAL")?.value;

        if (pNo) partNo.add(pNo);
        if (pName) partName.add(pName);
        if (pType) type.add(pType);
        if (pMaterial) material.add(pMaterial);
    });

    const response = [
        { key: "PART NO", value: Array.from(partNo) },
        { key: "PART NAME", value: Array.from(partName) },
        { key: "TYPE", value: Array.from(type) },
        { key: "MATERIAL", value: Array.from(material) },
    ];

    res.status(200).json({
        success: true,
        data: response
    });
});