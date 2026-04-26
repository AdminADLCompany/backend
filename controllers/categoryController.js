const Category = require("../models/category");
const SubCategory = require("../models/subCategory");
const Product = require("../models/product");
const ErrorHandler = require("../utils/errorHandler");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");

// Get all categories
exports.getAllCategories = catchAsyncErrors(async (req, res, next) => {
    const categories = await Category.find();
    res.status(200).json({
        success: true,
        data: categories
    });
});

// Create category
exports.createCategory = catchAsyncErrors(async (req, res, next) => {
    const { name, description } = req.body;
    
    if(!name) {
        return next(new ErrorHandler("Please enter category name", 400));
    }

    const category = await Category.create({ name, description });
    res.status(201).json({
        success: true,
        data: category
    });
});

// Update category
exports.updateCategory = catchAsyncErrors(async (req, res, next) => {
    const category = await Category.findByIdAndUpdate(req.params.id, req.body, {
        new: true,
        runValidators: true
    });

    if (!category) {
        return next(new ErrorHandler("Category not found", 404));
    }

    res.status(200).json({
        success: true,
        data: category
    });
});

// Delete category
exports.deleteCategory = catchAsyncErrors(async (req, res, next) => {
    const category = await Category.findById(req.params.id);

    if (!category) {
        return next(new ErrorHandler("Category not found", 404));
    }

    // Check if category has subcategories
    const hasSubCategories = await SubCategory.findOne({ category: req.params.id });
    if(hasSubCategories) {
        return next(new ErrorHandler("Cannot delete category with sub-categories", 400));
    }

    await category.deleteOne();

    res.status(200).json({
        success: true,
        message: "Category deleted successfully"
    });
});
