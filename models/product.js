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
    partNo: {
        type: String,
        required: true
    },
    series: {
        type: String,
        required: true
    },
    image: {
        type: String,
        required: true
    },
    portSize: {
        type: String,
        required: true
    },
    bodySize: {
        type: String,
        required: true
    },
    material: {
        type: String,
        required: true
    },
    standard: {
        type: String,
        required: true
    },
    operatingPressure: {
        type: String,
        required: true
    },
    pressureDrop: {
        type: String,
        required: true
    },
    ratedFlow: {
        type: String,
        required: true
    },
    sealingMaterial: {
        type: String,
        required: true
    },
    suggestedFlow: {
        type: String,
        required: true
    },
    temperature: {
        type: String,
        required: true
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