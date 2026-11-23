const mongoose = require("mongoose");
const SubCategory = require("../models/subCategory");
const Category = require("../models/category");
const Product = require("../models/product");
const ErrorHandler = require("../utils/errorHandler");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");

const duplicateNameError = (err) =>
    err && err.code === 11000
        ? new ErrorHandler("A sub-category with this name already exists at this level", 400)
        : err;

const toParentId = (value) =>
    value === undefined || value === null || value === "" || value === "null" ? null : value;

/**
 * Validates that `parentId` (if any) is a sub-category of `categoryId`, and — when moving an
 * existing node — that it is not the node itself or one of its descendants.
 * Returns an ErrorHandler on failure, otherwise null.
 */
const validateParent = async (parentId, categoryId, movingNodeId = null) => {
    if (!parentId) return null;
    if (!mongoose.Types.ObjectId.isValid(parentId)) {
        return new ErrorHandler("Invalid parent sub-category", 400);
    }
    const parent = await SubCategory.findById(parentId).lean();
    if (!parent) return new ErrorHandler("Parent sub-category not found", 404);
    if (String(parent.category) !== String(categoryId)) {
        return new ErrorHandler("The parent sub-category belongs to a different category", 400);
    }
    if (movingNodeId) {
        // Walk up from the new parent; meeting the node itself means a loop
        let cursor = parent;
        const seen = new Set();
        while (cursor) {
            const id = String(cursor._id);
            if (id === String(movingNodeId)) {
                return new ErrorHandler("A sub-category cannot be moved inside itself or one of its own sub-categories", 400);
            }
            if (seen.has(id) || !cursor.parent) break;
            seen.add(id);
            cursor = await SubCategory.findById(cursor.parent).lean();
        }
    }
    return null;
};

// Get all sub-categories
exports.getAllSubCategories = catchAsyncErrors(async (req, res, next) => {
    const subCategories = await SubCategory.find()
        .sort({ order: 1, name: 1 })
        .populate('category', 'name');
    res.status(200).json({
        success: true,
        data: subCategories
    });
});

// Get sub-categories by category ID (flat list; use `parent` to rebuild the tree)
exports.getSubCategoriesByCategory = catchAsyncErrors(async (req, res, next) => {
    const subCategories = await SubCategory.find({ category: req.params.categoryId })
        .sort({ order: 1, name: 1 });
    res.status(200).json({
        success: true,
        data: subCategories
    });
});

// Create sub-category (optionally under another sub-category via `parent`)
exports.createSubCategory = catchAsyncErrors(async (req, res, next) => {
    const { name, category, description, isActive, order } = req.body;
    const parent = toParentId(req.body.parent);

    if (!name || !String(name).trim() || !category) {
        return next(new ErrorHandler("Please enter sub-category name and select category", 400));
    }
    const categoryExists = await Category.exists({ _id: category });
    if (!categoryExists) {
        return next(new ErrorHandler("Category not found", 404));
    }
    const parentError = await validateParent(parent, category);
    if (parentError) return next(parentError);

    try {
        const subCategory = await SubCategory.create({
            name: String(name).trim(),
            category,
            parent,
            description,
            isActive: isActive !== false,
            order: Number(order) || 0,
            updatedBy: req.user?._id,
        });
        res.status(201).json({
            success: true,
            data: subCategory
        });
    } catch (err) {
        return next(duplicateNameError(err));
    }
});

// Update sub-category (name / description / isActive / order / parent = move within its category)
exports.updateSubCategory = catchAsyncErrors(async (req, res, next) => {
    const subCategory = await SubCategory.findById(req.params.id);
    if (!subCategory) {
        return next(new ErrorHandler("Sub-category not found", 404));
    }

    if (req.body.name !== undefined) {
        if (!String(req.body.name).trim()) {
            return next(new ErrorHandler("Please enter sub-category name", 400));
        }
        subCategory.name = String(req.body.name).trim();
    }
    ["description", "isActive", "order"].forEach((k) => {
        if (req.body[k] !== undefined) subCategory[k] = req.body[k];
    });
    if (req.body.parent !== undefined) {
        const parent = toParentId(req.body.parent);
        const parentError = await validateParent(parent, subCategory.category, subCategory._id);
        if (parentError) return next(parentError);
        subCategory.parent = parent;
    }
    subCategory.updatedBy = req.user?._id;

    try {
        await subCategory.save();
    } catch (err) {
        return next(duplicateNameError(err));
    }

    res.status(200).json({
        success: true,
        data: subCategory
    });
});

// Delete sub-category (only when it has no sub-categories and no products)
exports.deleteSubCategory = catchAsyncErrors(async (req, res, next) => {
    const subCategory = await SubCategory.findById(req.params.id);

    if (!subCategory) {
        return next(new ErrorHandler("Sub-category not found", 404));
    }

    const hasChildren = await SubCategory.findOne({ parent: req.params.id });
    if (hasChildren) {
        return next(new ErrorHandler("Cannot delete a sub-category that still has sub-categories. Delete or move them first.", 400));
    }

    // Check if sub-category has products
    const hasProducts = await Product.findOne({ subCategory: req.params.id });
    if(hasProducts) {
        return next(new ErrorHandler("Cannot delete a sub-category that still has products", 400));
    }

    await subCategory.deleteOne();

    res.status(200).json({
        success: true,
        message: "Sub-category deleted successfully"
    });
});
