const Process = require('../models/process');

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


exports.deleteProcess = catchAsyncErrors( async (req, res, next) => {
    const process = await Process.findByIdAndDelete(req.params.id);
    if (!process) {
        return next(new ErrorHandler("Process not found", 404));
    }
    res.status(200).json({
        success: true,
        data: process
    });
});

exports.addHeader = catchAsyncErrors( async (req, res, next) => {
    const process = await Process.findById(req.params.id);
    const { headerName } = req.body;

    if (!process) {
        return next(new ErrorHandler("Process not found", 404));
    }
    process.headers.push(headerName);
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

    // Add new row
    process.data.push({ items, rowDataId });
    
    await process.populate('department');
    await process.populate('updatedBy', 'userName email');
    await process.save();

    res.status(200).json({
        success: true,
        process
    });
});



// UPDATE row by rowId
exports.updateData = catchAsyncErrors(async (req, res, next) => {
    const process = await Process.findById(req.params.id);
    const { rowId, items } = req.body; // 👈 pass rowId instead of items

    if (!process) {
        return next(new ErrorHandler("Process not found", 404));
    }

    const row = process.data.id(rowId); // mongoose helper to find subdoc by _id
    if (!row) {
        return next(new ErrorHandler("Data not found", 404));
    }

    row.items = items; // replace items

    await process.populate('department');
    await process.populate('updatedBy', 'userName email');

    await process.save();

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

    process.data = process.data.filter(row => row._id.toString() !== rowId);
    
    await process.populate('department');
    await process.populate('updatedBy', 'userName email');
    
    await process.save();

    res.status(200).json({
        success: true,
        data: process
    });
});
