// Importing the library
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");

const storage = require("./services/storage");

// Using express
const app = express();

const errorHandler = require("./middleware/error");

const DEFAULT_CORS_ORIGINS = ["http://localhost:3000", "https://adlcompany.web.app"];
const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean)
  : DEFAULT_CORS_ORIGINS;

// CSP and HSTS stay off: the API is served over a local CA / plain HTTP on the LAN,
// and uploaded images must be loadable from the Firebase-hosted frontend origin.
app.use(
  helmet({
    contentSecurityPolicy: false,
    hsts: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

// Use CORS middleware
app.use(
  cors({
    origin: corsOrigins,
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  }),
);

// Preflight request handling
// app.options('*', cors());

// Using middleware
app.use(express.json());
app.use(cookieParser());

app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "ADL server is running",
  });
});

if (storage.provider === "local") {
  app.use(storage.publicPath, express.static(storage.localUploadDir));
}

// Importing routes
const user = require("./routes/user");
const product = require("./routes/product");
const department = require("./routes/department");
const processRoutes = require("./routes/process");
const history = require("./routes/history");
const category = require("./routes/category");
const subCategory = require("./routes/subCategory");

// Using routes
app.use("/api/v1/user", user);
app.use("/api/v1/product", product);
app.use("/api/v1/department", department);
app.use("/api/v1/process", processRoutes);
app.use("/api/v1/history", history);
app.use("/api/v1/category", category);
app.use("/api/v1/subcategory", subCategory);

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.use(errorHandler);

module.exports = app;
