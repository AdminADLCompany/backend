const Process = require('../models/process');
const History = require('../models/history');

const ErrorHandler = require("../utils/errorHandler");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const cloudinary = require("../config/cloudinary");

const ImageUploadArray = ["UPLOAD", "BEFORE", "AFTER", "CALIBRATION CERTIFICATE NO / DATE", "ACTION REPORT", "NPD FORM"];

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
    console.log("REQ BODY:", req.body);
console.log("REQ FILES:", req.files);
    let { items, rowDataId } = req.body;

    if (!process) {
        return next(new ErrorHandler("Process not found", 404));
    }

    if (typeof items === "string") {
        items = JSON.parse(items); // ✅ convert string to array
    }

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

                const actionPlan = items.find(i => i.key === "ACTION PLAN")?.value;
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
    }

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

            if (relatedProcess) {
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

    if (typeof items === "string") {
        items = JSON.parse(items); // ✅ convert string to array
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

    row.items = items;
    process.updatedBy = req.user._id;
    await process.save();

    /** 🔥 Extra logic for Action Taken process */
    if (process.processId === "MR/R/003B") {
        const moveToItem = items.find(i => i.key === "MOVE TO");

        if (moveToItem && moveToItem.value === "Rework") {
            // find linked rejection report row
            const rejectionReport = await Process.findOne({ processId: "MR/R/003" });
            const reworkReport = await Process.findOne({ processId: "MR/R/003A" });

            // console log the boolean value of both reports
            console.log("Case Succeeded: ", !!rejectionReport, !!reworkReport);

            if (rejectionReport && reworkReport) {
                // get rejection row using rowDataId
                const rejectionRow = rejectionReport.data.id(row.rowDataId);

                if (rejectionRow) {
                    const partNo = rejectionRow.items.find(i => i.key === "PART NO")?.value;
                    const partName = rejectionRow.items.find(i => i.key === "PART NAME")?.value;
                    const problemDesc = rejectionRow.items.find(i => i.key === "PROBLEM DESCRIPTION")?.value;
                    const rejectStage = rejectionRow.items.find(i => i.key === "REJECT STAGE")?.value;

                    // prepare new rework row
                    const reworkRow = {
                        items: [
                            { key: "PART NO", value: partNo || "", process: "value" },
                            { key: "PART NAME", value: partName || "", process: "value" },
                            { key: "PROBLEM DESCRIPTION", value: problemDesc || "", process: "value" },
                            { key: "REWORK QTY", value: "0", process: "value" }, // default until user edits
                            { key: "REJECT STAGE", value: rejectStage || "", process: "value" },
                            { key: "ACTION PLAN", value: items.find(i => i.key === "ACTION PLAN")?.value || "", process: "value" },
                            { key: "VERIFIED BY", value: items.find(i => i.key === "VERIFIED BY")?.value || "", process: "value" },
                            { key: "STATUS", value: items.find(i => i.key === "ACTION PLAN STATUS")?.value || "", process: "value" },
                        ],
                        rowDataId: row.rowDataId, // 🔗 link with same rejection row
                    };

                    reworkReport.data.push(reworkRow);
                    reworkReport.updatedBy = req.user._id;
                    await reworkReport.save();

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
    }

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