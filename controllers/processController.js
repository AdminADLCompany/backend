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

exports.createProcess = catchAsyncErrors( async (req, res, next) => {

    const { process, headers, department } = req.body;

    const processes = await Process.create({
        process,
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
    const { items } = req.body;

    if (!process) {
        return next(new ErrorHandler("Process not found", 404));
    }

    process.data.push({ items });

    // if the items data value as the value of processId the another key should be added as process with the value of process as corresponded process
    // [
    //       { "key": "NO", "value": "1" },
    //       { "key": "BY", "value": "John Doe" },
    //       { "key": "FROM", "value": "Design Team" },
    //       { "key": "DATE", "value": "2023-01-01" },
    //       { "key": "PART", "value": "Part A" },
    //       { "key": "SPEC", "value": "Specification A" },
    //       { "key": "QTY", "value": "100" },
    //       { "key": "REVIEW DATE", "value": "2023-01-10" },
    //       { "key": "REVIEW BY", "value": "Jane Smith" },
    //       { "key": "STATUS", "value": "In Progress" },
    //       { "key": "UPLOAD", "value": "File.pdf" },
    //       { "key": "PROTO", "value": "Prototype 1" },
    //       { "key": "VALIDATION", "value": "Validated" },
    //       { "key": "MASTER", "value": "processId", 
    //         "process":  {
    //           "process": "Master Piece",
    //           "header": [
    //             "SL.NO",
    //             "PART",
    //             "SERIES ",
    //             "PART NO",
    //             "PART NAME",
    //             "SPECIFICATION",
    //             "MASTER PIECE",
    //             "REMARK"
    //           ],
    //           "data": [
    //             [
    //               { "key": "SL.NO", "value": "1" },
    //               { "key": "PART", "value": "Part A" },
    //               { "key": "SERIES ", "value": "Series 1" },
    //               { "key": "PART NO", "value": "PA-001" },
    //               { "key": "PART NAME", "value": "Part A Name" },
    //               { "key": "SPECIFICATION", "value": "Spec A" },
    //               { "key": "MASTER PIECE", "value": "Master Piece A" },
    //               { "key": "REMARK", "value": "No remarks" }
    //             ],
    //             [
    //               { "key": "SL.NO", "value": "2" },
    //               { "key": "PART", "value": "Part B" },
    //               { "key": "SERIES ", "value": "Series 1" },
    //               { "key": "PART NO", "value": "PB-001" },
    //               { "key": "PART NAME", "value": "Part B Name" },
    //               { "key": "SPECIFICATION", "value": "Spec B" },
    //               { "key": "MASTER PIECE", "value": "Master Piece B" },
    //               { "key": "REMARK", "value": "Urgent" }
    //             ]
    //           ]
    //           } }
    //     ],
    if (items.some(item => item.value === 'processId')) {
        const masterProcess = await Process.findOne({ processId: process.processId });
        if (masterProcess) {
            items.push({ key: 'process', value: masterProcess.process });
        }
    }

    await process.populate('department');
    await process.populate('updatedBy', 'userName email');

    await process.save();

    res.status(200).json({
        success: true,
        data: process
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
