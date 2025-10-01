const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");

// storage config
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "process_images", // your cloudinary folder name
    allowed_formats: ["jpg", "jpeg", "png", "pdf"],
    resource_type: "auto"
  },
});

// multer instance
const upload = multer({ storage });

module.exports = upload;
