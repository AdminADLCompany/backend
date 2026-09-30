const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../../config/cloudinary");

module.exports = ({ folder, allowedFormats }) => {
  const storage = new CloudinaryStorage({
    cloudinary,
    params: {
      folder,
      allowed_formats: allowedFormats,
      resource_type: "auto",
    },
  });

  const upload = multer({ storage });

  // multer-storage-cloudinary has already uploaded the file; `path` is its secure_url.
  const saveFile = async (file) => file.path;

  return { upload, saveFile };
};
