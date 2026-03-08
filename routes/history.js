const express = require("express");
const router = express.Router();

const { clearAllHistory } = require("../controllers/historyController");
const isAuthenticatedUser = require("../middleware/auth");

router.route("/clear").delete(isAuthenticatedUser, clearAllHistory);

module.exports = router;
