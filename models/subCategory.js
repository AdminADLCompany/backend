const mongoose = require('mongoose');

/**
 * Sub-categories form a tree of any depth inside a category:
 *   Category → SubCategory (parent: null) → SubCategory (parent: <id>) → …
 * Products can be attached to any sub-category node.
 */
const subCategorySchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Please enter sub-category name'],
        trim: true
    },
    category: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category',
        required: true
    },
    // null = directly under the category; otherwise the parent sub-category (same category)
    parent: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'SubCategory',
        default: null
    },
    description: {
        type: String
    },
    // Inactive nodes (and everything under them) are hidden from the Products page
    isActive: {
        type: Boolean,
        default: true
    },
    order: {
        type: Number,
        default: 0
    },
    updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// A name must be unique among siblings (same category + same parent);
// the same name may appear on different branches.
subCategorySchema.index({ name: 1, category: 1, parent: 1 }, { unique: true });

module.exports = mongoose.model('SubCategory', subCategorySchema);
