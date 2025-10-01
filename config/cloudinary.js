require("dotenv").config();

const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: "dymeg9ujf",
  api_key: 957446687369494,
  api_secret: "FmlLHn_tliuBMAPd8aCIrM6LMcQ"
});

console.log("Cloudinary Config:", {
  cloud: "dymeg9ujf",
  key: "✔ Loaded",
  secret: "✔ Loaded"
});


module.exports = cloudinary;
