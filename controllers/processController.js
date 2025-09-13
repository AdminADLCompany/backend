const Process = require('../models/process');
const History = require('../models/history');

const ErrorHandler = require("../utils/errorHandler");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");

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
    const { items, rowDataId } = req.body;

    if (!process) {
        return next(new ErrorHandler("Process not found", 404));
    }

    // Loop through all items and replace those with value "processId" and a process key
    for (let i = 0; i < items.length; i++) {
        if (items[i].process === 'processId' && items[i].value) {
            const relatedProcess = await Process.findOne({ processId: items[i].value });

            if (relatedProcess) {
                // Replace the object while keeping the key
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
        rowId: process.data[process.data.length - 1]._id, // newly added row
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
    const { rowId, items } = req.body;

    if (!process) {
        return next(new ErrorHandler("Process not found", 404));
    }

    const row = process.data.id(rowId);
    if (!row) {
        return next(new ErrorHandler("Data not found", 404));
    }

    const oldData = { ...row.toObject() };
    row.items = items;
    process.updatedBy = req.user._id;
    await process.save();

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