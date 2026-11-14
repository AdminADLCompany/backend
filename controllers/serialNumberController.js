const SerialNumber = require("../models/serialNumber");
const ErrorHandler = require("../utils/errorHandler");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const {
  prefixForType,
  formatSerial,
  DEFAULT_PAD_LENGTH,
} = require("../utils/serialNumber");

const normalizeType = (type) => String(type || "").trim().toUpperCase();

const ensureSerialDoc = async (type) => {
  const prefix = prefixForType(type);
  let doc = await SerialNumber.findOne({ type });
  if (!doc) {
    doc = await SerialNumber.create({
      type,
      prefix,
      lastNumber: 0,
      padLength: DEFAULT_PAD_LENGTH,
      description: type === "ENQUIRE_NUMBER" ? "Quotation Enquiry Number" : "",
    });
  }
  return doc;
};

/** GET /:type/next — peek next serial without incrementing */
exports.peekNext = catchAsyncErrors(async (req, res, next) => {
  const type = normalizeType(req.params.type);
  if (!type) {
    return next(new ErrorHandler("Serial type is required", 400));
  }

  try {
    prefixForType(type);
  } catch (err) {
    return next(new ErrorHandler(err.message, err.statusCode || 400));
  }

  const doc = await ensureSerialDoc(type);
  const nextNumber = (doc.lastNumber || 0) + 1;
  const serial = formatSerial(doc.prefix || prefixForType(type), nextNumber, doc.padLength);

  res.status(200).json({
    success: true,
    data: {
      type,
      nextNumber,
      serial,
      padLength: doc.padLength,
      prefix: doc.prefix,
    },
  });
});

/** POST /:type/allocate — atomic increment; returns issued serial */
exports.allocate = catchAsyncErrors(async (req, res, next) => {
  const type = normalizeType(req.params.type);
  if (!type) {
    return next(new ErrorHandler("Serial type is required", 400));
  }

  let prefix;
  try {
    prefix = prefixForType(type);
  } catch (err) {
    return next(new ErrorHandler(err.message, err.statusCode || 400));
  }

  const doc = await SerialNumber.findOneAndUpdate(
    { type },
    {
      $inc: { lastNumber: 1 },
      $setOnInsert: {
        prefix,
        padLength: DEFAULT_PAD_LENGTH,
        description:
          type === "ENQUIRE_NUMBER" ? "Quotation Enquiry Number" : "",
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  const number = doc.lastNumber;
  const serial = formatSerial(doc.prefix || prefix, number, doc.padLength);

  res.status(200).json({
    success: true,
    data: {
      type,
      number,
      serial,
      padLength: doc.padLength,
      prefix: doc.prefix,
    },
  });
});

/** POST / — upsert a serial type record (admin/seed) */
exports.upsertType = catchAsyncErrors(async (req, res, next) => {
  const type = normalizeType(req.body?.type);
  if (!type) {
    return next(new ErrorHandler("type is required", 400));
  }

  let prefix;
  try {
    prefix = prefixForType(type);
  } catch (err) {
    return next(new ErrorHandler(err.message, err.statusCode || 400));
  }

  const padLength =
    req.body?.padLength != null
      ? Math.max(1, Number(req.body.padLength) || DEFAULT_PAD_LENGTH)
      : DEFAULT_PAD_LENGTH;
  const description = req.body?.description ?? "";
  const lastNumber =
    req.body?.lastNumber != null
      ? Math.max(0, Number(req.body.lastNumber) || 0)
      : undefined;

  const update = {
    prefix: req.body?.prefix || prefix,
    padLength,
    description,
  };
  if (lastNumber !== undefined) {
    update.lastNumber = lastNumber;
  }

  const doc = await SerialNumber.findOneAndUpdate(
    { type },
    { $set: update, $setOnInsert: { lastNumber: lastNumber ?? 0 } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  res.status(200).json({
    success: true,
    data: doc,
  });
});
