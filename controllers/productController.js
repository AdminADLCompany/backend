const Product = require('../models/product');

const ErrorHandler = require("../utils/errorHandler");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");

exports.getAllProducts = catchAsyncErrors( async (req, res, next) => {
  const products = await Product.find();

  await Product.populate(products, { path: "updatedBy", select: "userName email" });

  res.status(200).json({
    success: true,
    count: products.length,
    data: products
  });
});

exports.getProductById = catchAsyncErrors( async (req, res, next) => {
  const product = await Product.findById(req.params.id);

  await Product.populate(product, { path: "updatedBy", select: "userName email" });

  if (!product) {
    return next(new ErrorHandler("Product not found", 404));
  }
  res.status(200).json({
    success: true,
    data: product
  });
});

exports.createProduct = catchAsyncErrors(async (req, res, next) => {
  const {
    name, description, status, partNo, series, image,
    portSize, bodySize, material, standard,
    operatingPressure, pressureDrop, ratedFlow,
    sealingMaterial, suggestedFlow, temperature
  } = req.body;

  if (!name || !description || !partNo || !series || !image ||
      !portSize || !bodySize || !material || !standard ||
      !operatingPressure || !pressureDrop || !ratedFlow ||
      !sealingMaterial || !suggestedFlow || !temperature) {
    return next(new ErrorHandler("Please fill all fields", 400));
  }

  const product = await Product.create({
    name,
    description,
    status,
    partNo,
    series,
    image,
    portSize,
    bodySize,
    material,
    standard,
    operatingPressure,
    pressureDrop,
    ratedFlow,
    sealingMaterial,
    suggestedFlow,
    temperature,
    updatedBy: req.user._id  // ✅ only ObjectId
  });

  // Populate user details before sending response
  await product.populate("updatedBy", "userName email");

  res.status(201).json({
    success: true,
    data: product
  });
});


exports.updateProduct = catchAsyncErrors(async (req, res, next) => {
    const updates = {
        ...req.body,
        updatedBy: req.user._id,   // <-- store user
        updatedAt: Date.now()      // <-- refresh timestamp
    };

    const product = await Product.findByIdAndUpdate(req.params.id, updates, {
        new: true
    }).populate("updatedBy", "userName email");

    if (!product) {
        return next(new ErrorHandler("Product not found", 404));
    }

    res.status(200).json({
        success: true,
        data: product
    });
});

exports.deleteProduct = catchAsyncErrors( async (req, res, next) => {
  
    const product = await Product.findByIdAndDelete(req.params.id);

    await Product.populate(product, { path: "updatedBy", select: "userName email" });

    if (!product) {
        return next(new ErrorHandler("Product not found", 404));
    }
        
    res.status(200).json({
        success: true,
        data: product
    });
});
exports.addGraphData = catchAsyncErrors(async (req, res, next) => {
  const { graph } = req.body;

  if (!graph || !Array.isArray(graph)) {
    return next(new ErrorHandler("Graph must be an array of objects", 400));
  }

  const product = await Product.findByIdAndUpdate(
    req.params.id,
    {
      graph,
      updatedAt: Date.now(),
      updatedBy: req.user._id
    },
    { new: true, runValidators: true }
  ).populate("updatedBy", "userName email");

  if (!product) {
    return next(new ErrorHandler("Product not found", 404));
  }

  res.status(200).json({
    success: true,
    message: "Graph data added successfully",
    data: product
  });
});
