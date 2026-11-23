const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    description: {
        type: String
    },
    status: {
        type: String,
        enum: ['waiting for order', 'order confirm', 'under progress', 'supplied to customer']
    },
    category: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category',
        required: true
    },
    subCategory: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'SubCategory',
        required: true
    },
    partNo: {
        type: String,
        required: true
    },
    series: {
        type: String
    },
    image: {
        type: String
    },
    portSize: {
        type: String
    },
    bodySize: {
        type: String
    },
    material: {
        type: String
    },
    standard: {
        type: String
    },
    operatingPressure: {
        type: String
    },
    pressureDrop: {
        type: String
    },
    ratedFlow: {
        type: String
    },
    sealingMaterial: {
        type: String
    },
    suggestedFlow: {
        type: String
    },
    temperature: {
        type: String
    },
    graph: {
        type: [
            {
                name: { type: String, required: true },
                data: [{ type: Number, required: true }]
            }
        ],
        default: []
    },
    updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

const Product = mongoose.model('Product', productSchema);

module.exports = Product;