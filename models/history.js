const mongoose = require("mongoose");

const historySchema = new mongoose.Schema({
  collectionName: { 
      type: String, 
      required: true
  }, // e.g., "Process", "Product"
  documentId: { 
      type: mongoose.Schema.Types.ObjectId, 
      required: true
  }, // reference to the original document
  rowId:{
      type: mongoose.Schema.Types.ObjectId
  },
  operation: { 
      type: String, 
      enum: ["create", "update", "delete"], 
      required: true 
  },
  oldData: { 
      type: mongoose.Schema.Types.Mixed 
  },  // before change
  newData: { 
      type: mongoose.Schema.Types.Mixed 
  },  // after change
  changedBy: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "User"
  }, // who made the change
  timestamp: { 
      type: Date, 
      default: Date.now 
  }
});

module.exports = mongoose.model("History", historySchema);
