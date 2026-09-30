const path = require("path");

const PUBLIC_PATH = "/uploads";
const PROCESS_IMAGES_FOLDER = "process_images";
const ALLOWED_FORMATS = ["jpg", "jpeg", "png", "pdf"];

const provider = (process.env.STORAGE_PROVIDER || "cloudinary").trim().toLowerCase();
const localUploadDir = path.resolve(
  process.env.LOCAL_UPLOAD_DIR || path.join(__dirname, "..", "..", "uploads"),
);
const maxFileSizeMb = Number(process.env.MAX_UPLOAD_MB) || 10;

let impl;
if (provider === "local") {
  impl = require("./local")({
    uploadDir: localUploadDir,
    publicPath: PUBLIC_PATH,
    folder: PROCESS_IMAGES_FOLDER,
    allowedFormats: ALLOWED_FORMATS,
    maxFileSizeMb,
  });
} else if (provider === "cloudinary") {
  impl = require("./cloudinary")({
    folder: PROCESS_IMAGES_FOLDER,
    allowedFormats: ALLOWED_FORMATS,
  });
} else {
  throw new Error(`Unknown STORAGE_PROVIDER "${provider}". Use "local" or "cloudinary".`);
}

module.exports = {
  provider,
  publicPath: PUBLIC_PATH,
  localUploadDir,
  processImagesFolder: PROCESS_IMAGES_FOLDER,
  allowedFormats: ALLOWED_FORMATS,
  upload: impl.upload,
  saveFile: impl.saveFile,
};
