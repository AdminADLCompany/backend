const mongoose = require('mongoose');
const historyPlugin = require('../middleware/historyPlugin');

const keyValueSchema = new mongoose.Schema({
    key: { type: String, required: true },
    value: { type: String, required: true },
    process: { type: String, default: "" } // optional reference to another processId
}, { _id: false });

// Schema for each row in "data"
const rowSchema = new mongoose.Schema({
  items: { type: [keyValueSchema], required: true },    
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  rowDataId: {
    type: 'String',
    default: ""
  }
}, { timestamps: true }); // each row gets its own _id and timestamps if you want

const processSchema = new mongoose.Schema({
    process: {
        type: String,
        required: true
    },
    processId: {
        type: String,
        required: true
    },
    headers: {
        type: [String],
        required: true
    },
    department: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Department',
        required: true
    },
    data: {
        type: [rowSchema]
    },
    updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
    }
}, {
    timestamps: true
});


processSchema.plugin(historyPlugin, { collectionName: "Process" });

module.exports = mongoose.model('Process', processSchema);