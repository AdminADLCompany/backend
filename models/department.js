const mongoose = require('mongoose');
const historyPlugin = require('../middleware/historyPlugin');

const departmentSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, "Please enter department name"],
        trim: true
    },
    process: {
        type: [String],
        required: [true, "Please enter department process"]
    },
    createdAt: {
        type: Date,
        default: Date.now
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

departmentSchema.plugin(historyPlugin, { collectionName: "Department" });

module.exports = mongoose.model("Department", departmentSchema);