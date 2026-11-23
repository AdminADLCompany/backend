const Category = require("../models/category");
const SubCategory = require("../models/subCategory");
const Product = require("../models/product");
const ErrorHandler = require("../utils/errorHandler");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");

const duplicateNameError = (err) =>
    err && err.code === 11000
        ? new ErrorHandler("A category with this name already exists", 400)
        : err;

// Get all categories
exports.getAllCategories = catchAsyncErrors(async (req, res, next) => {
    const categories = await Category.find().sort({ order: 1, name: 1 });
    res.status(200).json({
        success: true,
        data: categories
    });
});

/**
 * GET /category/tree?includeInactive=true|false
 * Categories with their sub-category tree (any depth) and product counts:
 * [{ _id, name, isActive, order, productCount, totalProductCount, subCategoryCount,
 *    subcategories: [{ _id, name, isActive, parent, productCount, totalProductCount,
 *                      children: [...] }] }]
 * Inactive nodes — and everything under them — are left out unless includeInactive=true.
 */
exports.getCategoryTree = catchAsyncErrors(async (req, res, next) => {
    const includeInactive = String(req.query.includeInactive) === "true";

    const [categories, subCategories, counts] = await Promise.all([
        Category.find().sort({ order: 1, name: 1 }).lean(),
        SubCategory.find().sort({ order: 1, name: 1 }).lean(),
        Product.aggregate([
            {
                $group: {
                    _id: { category: "$category", subCategory: "$subCategory" },
                    count: { $sum: 1 },
                },
            },
        ]),
    ]);

    // Products attached directly to each sub-category / category
    const productsBySub = new Map();
    const productsByCategoryDirect = new Map(); // products with a category but no sub-category
    counts.forEach(({ _id, count }) => {
        if (_id.subCategory) {
            productsBySub.set(String(_id.subCategory), count);
        } else if (_id.category) {
            productsByCategoryDirect.set(String(_id.category), count);
        }
    });

    // Build nodes, then link children to parents
    const nodes = new Map();
    subCategories.forEach((s) => {
        nodes.set(String(s._id), {
            _id: s._id,
            name: s.name,
            description: s.description || "",
            category: s.category,
            parent: s.parent || null,
            isActive: s.isActive !== false,
            order: s.order || 0,
            productCount: productsBySub.get(String(s._id)) || 0,
            children: [],
        });
    });
    const rootsByCategory = new Map();
    nodes.forEach((node) => {
        const parentNode = node.parent ? nodes.get(String(node.parent)) : null;
        if (parentNode && String(parentNode.category) === String(node.category)) {
            parentNode.children.push(node);
        } else {
            const key = String(node.category);
            if (!rootsByCategory.has(key)) rootsByCategory.set(key, []);
            rootsByCategory.get(key).push(node);
        }
    });

    // Drop inactive branches (unless asked) and total up counts bottom-up
    const finish = (list) =>
        list
            .filter((n) => includeInactive || n.isActive)
            .map((n) => {
                const children = finish(n.children);
                return {
                    ...n,
                    children,
                    subCategoryCount: children.length,
                    totalProductCount:
                        n.productCount + children.reduce((sum, c) => sum + c.totalProductCount, 0),
                };
            });

    const tree = categories
        .filter((c) => includeInactive || c.isActive !== false)
        .map((c) => {
            const subcategories = finish(rootsByCategory.get(String(c._id)) || []);
            const directProducts = productsByCategoryDirect.get(String(c._id)) || 0;
            return {
                _id: c._id,
                name: c.name,
                description: c.description || "",
                isActive: c.isActive !== false,
                order: c.order || 0,
                productCount: directProducts,
                subCategoryCount: subcategories.length,
                totalProductCount:
                    directProducts + subcategories.reduce((sum, s) => sum + s.totalProductCount, 0),
                subcategories,
            };
        });

    res.status(200).json({
        success: true,
        data: tree
    });
});

// Create category
exports.createCategory = catchAsyncErrors(async (req, res, next) => {
    const { name, description, isActive, order } = req.body;

    if (!name || !String(name).trim()) {
        return next(new ErrorHandler("Please enter category name", 400));
    }

    try {
        const category = await Category.create({
            name: String(name).trim(),
            description,
            isActive: isActive !== false,
            order: Number(order) || 0,
            updatedBy: req.user?._id,
        });
        res.status(201).json({
            success: true,
            data: category
        });
    } catch (err) {
        return next(duplicateNameError(err));
    }
});

// Update category (name / description / isActive / order)
exports.updateCategory = catchAsyncErrors(async (req, res, next) => {
    const update = { updatedBy: req.user?._id };
    ["description", "isActive", "order"].forEach((k) => {
        if (req.body[k] !== undefined) update[k] = req.body[k];
    });
    if (req.body.name !== undefined) {
        if (!String(req.body.name).trim()) {
            return next(new ErrorHandler("Please enter category name", 400));
        }
        update.name = String(req.body.name).trim();
    }

    let category;
    try {
        category = await Category.findByIdAndUpdate(req.params.id, update, {
            new: true,
            runValidators: true
        });
    } catch (err) {
        return next(duplicateNameError(err));
    }

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
        return next(new ErrorHandler("Cannot delete a category that still has sub-categories. Delete them first.", 400));
    }
    const hasProducts = await Product.findOne({ category: req.params.id });
    if (hasProducts) {
        return next(new ErrorHandler("Cannot delete a category that still has products", 400));
    }

    await category.deleteOne();

    res.status(200).json({
        success: true,
        message: "Category deleted successfully"
    });
});
