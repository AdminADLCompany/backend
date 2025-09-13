// plugins/historyPlugin.js
const History = require("../models/history");

function historyPlugin(schema, options = {}) {
  const collectionName = options.collectionName || schema.options.collection || "Unknown";

  // Log create & update
  schema.pre("save", async function (next) {
    try {
      if (this.isNew) {
        // Log creation
        await History.create({
          collectionName,
          documentId: this._id,
          operation: "create",
          newData: this.toObject(),
          changedBy: this.updatedBy || null
        });
      } else {
        // Log update
        const original = await this.constructor.findById(this._id).lean();
        await History.create({
          collectionName,
          documentId: this._id,
          operation: "update",
          oldData: original,
          newData: this.toObject(),
          changedBy: this.updatedBy || null
        });
      }
      next();
    } catch (err) {
      next(err);
    }
  });

  // Log delete
  schema.pre("deleteOne", { document: true, query: false }, async function (next) {
    try {
      await History.create({
        collectionName,
        documentId: this._id,
        operation: "delete",
        oldData: this.toObject(),
        changedBy: this.updatedBy || null
      });
      next();
    } catch (err) {
      next(err);
    }
  });
}

module.exports = historyPlugin;
