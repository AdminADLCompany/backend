const SubCategory = require("../models/subCategory");
const Product = require("../models/product");
const ErrorHandler = require("../utils/errorHandler");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");

// Get all sub-categories
exports.getAllSubCategories = catchAsyncErrors(async (req, res, next) => {
    const subCategories = await SubCategory.find().populate('category', 'name');
    res.status(200).json({
        success: true,
        data: subCategories
    });
});

// Get sub-categories by category ID
exports.getSubCategoriesByCategory = catchAsyncErrors(async (req, res, next) => {
    const subCategories = await SubCategory.find({ category: req.params.categoryId });
    res.status(200).json({
        success: true,
        data: subCategories
    });
});

// Create sub-category
exports.createSubCategory = catchAsyncErrors(async (req, res, next) => {
    const { name, category, description } = req.body;
    
    if(!name || !category) {
        return next(new ErrorHandler("Please enter sub-category name and select category", 400));
    }

    const subCategory = await SubCategory.create({ name, category, description });
    res.status(201).json({
        success: true,
        data: subCategory
    });
});

// Update sub-category
exports.updateSubCategory = catchAsyncErrors(async (req, res, next) => {
    const subCategory = await SubCategory.findByIdAndUpdate(req.params.id, req.body, {
        new: true,
        runValidators: true
    });

    if (!subCategory) {
        return next(new ErrorHandler("Sub-category not found", 404));
    }

    res.status(200).json({
        success: true,
        data: subCategory
    });
});

// Delete sub-category
exports.deleteSubCategory = catchAsyncErrors(async (req, res, next) => {
    const subCategory = await SubCategory.findById(req.params.id);

    if (!subCategory) {
        return next(new ErrorHandler("Sub-category not found", 404));
    }

    // Check if sub-category has products
    const hasProducts = await Product.findOne({ subCategory: req.params.id });
    if(hasProducts) {
        return next(new ErrorHandler("Cannot delete sub-category with products", 400));
    }

    await subCategory.deleteOne();

    res.status(200).json({
        success: true,
        message: "Sub-category deleted successfully"
    });
});
