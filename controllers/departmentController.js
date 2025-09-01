const Department = require('../models/department');

const ErrorHandler = require("../utils/errorHandler");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");

exports.getAllDepartments = catchAsyncErrors( async (req, res, next) => {
    const departments = await Department.find();

    await Department.populate(departments, { path: "updatedBy", select: "userName email" });

    res.status(200).json({
        success: true,
        data: departments
    });
});

exports.getDepartmentById = catchAsyncErrors( async (req, res, next) => {
    const department = await Department.findById(req.params.id).populate('updatedBy', 'userName email');

    if (!department) {
        return next(new ErrorHandler('Department not found', 404));
    }

    res.status(200).json({
        success: true,
        data: department
    });
});

exports.createDepartment = catchAsyncErrors( async (req, res, next) => {
    const { name, process } = req.body;

    if (!name || !process) {
        return next(new ErrorHandler('Please enter department name and process', 400));
    }

    const department = await Department.create({
        name,
        process,
        updatedBy: req.user._id
    });

    await department.populate('updatedBy', 'email userName');

    res.status(201).json({
        success: true,
        data: department
    });
});

exports.updateDepartment = catchAsyncErrors( async (req, res, next) => {
    const { name, process } = req.body;

    if (!name || !process) {
        return next(new ErrorHandler('Please enter department name and process', 400));
    }

    const department = await Department.findByIdAndUpdate(req.params.id, {
        name,
        process
    }, { new: true });

    await department.populate('updatedBy', 'userName email');

    if (!department) {
        return next(new ErrorHandler('Department not found', 404));
    }

    res.status(200).json({
        success: true,
        data: department
    });
});

exports.deleteDepartment = catchAsyncErrors( async (req, res, next) => {
    const department = await Department.findByIdAndDelete(req.params.id);

    if (!department) {
        return next(new ErrorHandler('Department not found', 404));
    }

    res.status(200).json({
        success: true,
        data: department
    });
});

// Add process in the process Array
exports.addProcess = catchAsyncErrors( async (req, res, next) => {
    const { processName } = req.body;

    const department = await Department.findById(req.params.id);

    if (!department) {
        return next(new ErrorHandler('Department not found', 404));
    }

    department.process.push(processName);

    // populate the user with email and userName
    await department.populate('updatedBy', 'email userName');
    await department.save();

    res.status(200).json({
        success: true,
        data: department
    });
});

// Delete process from the process Array
exports.deleteProcess = catchAsyncErrors( async (req, res, next) => {
    const { processName } = req.body;

    const department = await Department.findById(req.params.id);

    if (!department) {
        return next(new ErrorHandler('Department not found', 404));
    }

    department.process.pull(processName);

    // populate the user with email and userName
    await department.populate('updatedBy', 'email userName');

    await department.save();

    res.status(200).json({
        success: true,
        data: department
    });
});
