const Department = require('../models/department');
const ErrorHandler = require("../utils/errorHandler");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const History = require("../models/history"); // for fetching history

// ✅ Get all departments
exports.getAllDepartments = catchAsyncErrors(async (req, res, next) => {
  const departments = await Department.find().populate("updatedBy", "userName email");

  res.status(200).json({
    success: true,
    data: departments
  });
});

// ✅ Get department by ID
exports.getDepartmentById = catchAsyncErrors(async (req, res, next) => {
  const department = await Department.findById(req.params.id).populate("updatedBy", "userName email");

  if (!department) {
    return next(new ErrorHandler("Department not found", 404));
  }

  res.status(200).json({
    success: true,
    data: department
  });
});

// ✅ Create department (logs "create")
exports.createDepartment = catchAsyncErrors(async (req, res, next) => {
  const { name, process } = req.body;

  if (!name || !process) {
    return next(new ErrorHandler("Please enter department name and process", 400));
  }

  const department = await Department.create({
    name,
    process,
    updatedBy: req.user._id
  });

  await department.populate("updatedBy", "email userName");

  res.status(201).json({
    success: true,
    data: department
  });
});

// ✅ Update department (logs "update")
exports.updateDepartment = catchAsyncErrors(async (req, res, next) => {
  const department = await Department.findById(req.params.id);

  if (!department) {
    return next(new ErrorHandler("Department not found", 404));
  }

  const { name, process } = req.body;

  if (!name || !process) {
    return next(new ErrorHandler("Please enter department name and process", 400));
  }

  department.name = name;
  department.process = process;
  department.updatedBy = req.user._id; // track updater
  department.updatedAt = Date.now();

  await department.save(); // ✅ triggers plugin

  await department.populate("updatedBy", "userName email");

  res.status(200).json({
    success: true,
    data: department
  });
});

// ✅ Delete department (logs "delete")
exports.deleteDepartment = catchAsyncErrors(async (req, res, next) => {
  const department = await Department.findById(req.params.id);

  if (!department) {
    return next(new ErrorHandler("Department not found", 404));
  }

  department.updatedBy = req.user._id; // track deleter
  await department.deleteOne(); // ✅ triggers plugin

  res.status(200).json({
    success: true,
    message: "Department deleted"
  });
});

// ✅ Add process (logs "update")
exports.addProcess = catchAsyncErrors(async (req, res, next) => {
  const { processName } = req.body;
  const department = await Department.findById(req.params.id);

  if (!department) {
    return next(new ErrorHandler("Department not found", 404));
  }

  department.process.push(processName);
  department.updatedBy = req.user._id;

  await department.save(); // ✅ triggers plugin
  await department.populate("updatedBy", "email userName");

  res.status(200).json({
    success: true,
    data: department
  });
});

// ✅ Delete process from array (logs "update")
exports.deleteProcess = catchAsyncErrors(async (req, res, next) => {
  const { processName } = req.body;
  const department = await Department.findById(req.params.id);

  if (!department) {
    return next(new ErrorHandler("Department not found", 404));
  }

  department.process.pull(processName);
  department.updatedBy = req.user._id;

  await department.save(); // ✅ triggers plugin
  await department.populate("updatedBy", "email userName");

  res.status(200).json({
    success: true,
    data: department
  });
});

// ✅ Get department history
exports.getDepartmentHistory = catchAsyncErrors(async (req, res, next) => {
  const history = await History.find({
    collectionName: "Department",
    documentId: req.params.id
  })
    .populate("changedBy", "userName email")
    .sort({ timestamp: -1 });

  res.status(200).json({
    success: true,
    data: history
  });
});
