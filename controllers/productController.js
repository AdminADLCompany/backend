const mongoose = require("mongoose");
const Product = require("../models/product");
const SubCategory = require("../models/subCategory");

const ErrorHandler = require("../utils/errorHandler");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");

const STATUS_VALUES = ["waiting for order", "order confirm", "under progress", "supplied to customer"];
const SPEC_FIELDS = [
  "description", "series", "image", "portSize", "bodySize", "material", "standard",
  "operatingPressure", "pressureDrop", "ratedFlow", "sealingMaterial", "suggestedFlow", "temperature",
];

// "Waiting for order" (form) → "waiting for order" (schema); blank → unset
const normalizeStatus = (status) => {
  const s = String(status || "").trim().toLowerCase();
  return STATUS_VALUES.includes(s) ? s : undefined;
};

// Keep only graph series that have data; values become numbers
const normalizeGraph = (graph) =>
  (Array.isArray(graph) ? graph : [])
    .map((series) => ({
      name: String(series?.name || "").trim() || "Series",
      data: (Array.isArray(series?.data) ? series.data : [])
        .map((v) => Number(v))
        .filter((v) => Number.isFinite(v)),
    }))
    .filter((series) => series.data.length > 0);

// The sub-category must exist and belong to the chosen category
const checkCategoryLink = async (category, subCategory) => {
  if (!mongoose.Types.ObjectId.isValid(category) || !mongoose.Types.ObjectId.isValid(subCategory)) {
    return new ErrorHandler("Please choose a valid category and sub-category", 400);
  }
  const sub = await SubCategory.findById(subCategory).lean();
  if (!sub) return new ErrorHandler("Sub-category not found", 404);
  if (String(sub.category) !== String(category)) {
    return new ErrorHandler("The sub-category does not belong to the chosen category", 400);
  }
  return null;
};

// GET /product/all?category=<id>&subCategory=<id>
exports.getAllProducts = catchAsyncErrors(async (req, res, next) => {
  const filter = {};
  if (req.query.category && mongoose.Types.ObjectId.isValid(req.query.category)) {
    filter.category = req.query.category;
  }
  if (req.query.subCategory && mongoose.Types.ObjectId.isValid(req.query.subCategory)) {
    filter.subCategory = req.query.subCategory;
  }
  const products = await Product.find(filter)
    .sort({ name: 1 })
    .populate("category", "name")
    .populate("subCategory", "name")
    .populate("updatedBy", "name email");

  res.status(200).json({
    success: true,
    count: products.length,
    data: products,
  });
});

exports.getProductById = catchAsyncErrors(async (req, res, next) => {
  const product = await Product.findById(req.params.id)
    .populate("category", "name")
    .populate("subCategory", "name")
    .populate("updatedBy", "name email");

  if (!product) {
    return next(new ErrorHandler("Product not found", 404));
  }
  res.status(200).json({
    success: true,
    data: product,
  });
});

exports.createProduct = catchAsyncErrors(async (req, res, next) => {
  const { name, partNo, category, subCategory } = req.body;

  // Only Name, Part No and the category placement are required; specs can be filled in later
  if (!String(name || "").trim() || !String(partNo || "").trim()) {
    return next(new ErrorHandler("Please enter the product Name and Part No", 400));
  }
  if (!category || !subCategory) {
    return next(new ErrorHandler("Please choose where the product belongs (category and sub-category)", 400));
  }
  const linkError = await checkCategoryLink(category, subCategory);
  if (linkError) return next(linkError);

  const data = {
    name: String(name).trim(),
    partNo: String(partNo).trim(),
    category,
    subCategory,
    status: normalizeStatus(req.body.status),
    graph: normalizeGraph(req.body.graph),
    updatedBy: req.user._id,
  };
  SPEC_FIELDS.forEach((k) => {
    if (req.body[k] !== undefined && req.body[k] !== null && String(req.body[k]).trim() !== "") {
      data[k] = req.body[k];
    }
  });

  const product = await Product.create(data);

  // Populate details before sending response
  await product.populate([
    { path: "category", select: "name" },
    { path: "subCategory", select: "name" },
    { path: "updatedBy", select: "name email" },
  ]);

  res.status(201).json({
    success: true,
    data: product,
  });
});

exports.updateProduct = catchAsyncErrors(async (req, res, next) => {
  const updates = {
    ...req.body,
    updatedBy: req.user._id, // <-- store user
    updatedAt: Date.now(), // <-- refresh timestamp
  };
  if (updates.name !== undefined && !String(updates.name).trim()) {
    return next(new ErrorHandler("Product Name cannot be empty", 400));
  }
  if (updates.partNo !== undefined && !String(updates.partNo).trim()) {
    return next(new ErrorHandler("Product Part No cannot be empty", 400));
  }
  if (updates.status !== undefined) updates.status = normalizeStatus(updates.status);
  if (updates.graph !== undefined) updates.graph = normalizeGraph(updates.graph);
  // Moving a product: both ids must be given and must match
  if (updates.category !== undefined || updates.subCategory !== undefined) {
    const current = await Product.findById(req.params.id).lean();
    if (!current) return next(new ErrorHandler("Product not found", 404));
    const linkError = await checkCategoryLink(
      updates.category ?? current.category,
      updates.subCategory ?? current.subCategory,
    );
    if (linkError) return next(linkError);
  }

  const product = await Product.findByIdAndUpdate(req.params.id, updates, {
    new: true,
  })
    .populate("category", "name")
    .populate("subCategory", "name")
    .populate("updatedBy", "name email");

  if (!product) {
    return next(new ErrorHandler("Product not found", 404));
  }

  res.status(200).json({
    success: true,
    data: product,
  });
});

exports.deleteProduct = catchAsyncErrors(async (req, res, next) => {
  const product = await Product.findByIdAndDelete(req.params.id);

  await Product.populate(product, { path: "updatedBy", select: "name email" });

  if (!product) {
    return next(new ErrorHandler("Product not found", 404));
  }

  res.status(200).json({
    success: true,
    data: product,
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
      updatedBy: req.user._id,
    },
    { new: true, runValidators: true },
  ).populate("updatedBy", "name email");

  if (!product) {
    return next(new ErrorHandler("Product not found", 404));
  }

  res.status(200).json({
    success: true,
    message: "Graph data added successfully",
    data: product,
  });
});
