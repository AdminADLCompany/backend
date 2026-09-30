const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");

const ErrorHandler = require("../../utils/errorHandler");

const MIME_TYPES = {
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  png: ["image/png"],
  pdf: ["application/pdf"],
};

module.exports = ({ uploadDir, publicPath, folder, allowedFormats, maxFileSizeMb }) => {
  const destination = path.join(uploadDir, folder);
  fs.mkdirSync(destination, { recursive: true });

  const storage = multer.diskStorage({
    destination,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  });

  const fileFilter = (req, file, cb) => {
    const ext = path.extname(file.originalname).slice(1).toLowerCase();
    const allowed = allowedFormats.includes(ext) && (MIME_TYPES[ext] || []).includes(file.mimetype);
    if (!allowed) {
      return cb(new ErrorHandler(`Only ${allowedFormats.join(", ")} files are allowed`, 400));
    }
    cb(null, true);
  };

  const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: maxFileSizeMb * 1024 * 1024 },
  });

  // Stored as a server-relative URL so records keep working if the server IP changes.
  const saveFile = async (file) => `${publicPath}/${folder}/${file.filename}`;

  return { upload, saveFile };
};
