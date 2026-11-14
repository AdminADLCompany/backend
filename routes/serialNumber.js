const express = require("express");
const router = express.Router();
const isAuthenticatedUser = require("../middleware/auth");
const {
  peekNext,
  allocate,
  upsertType,
} = require("../controllers/serialNumberController");

router.route("/").post(isAuthenticatedUser, upsertType);
router.route("/:type/next").get(isAuthenticatedUser, peekNext);
router.route("/:type/allocate").post(isAuthenticatedUser, allocate);

module.exports = router;
