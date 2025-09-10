const express = require("express")
const router = express.Router();

const {
    getAllUsers,
    registerUser,
    loginUser,
    logoutUser,
    forgotPassword,
    resetPassword,
    deleteUser
} = require("../controllers/userController");

const { isAuthenticatedUser } = require("../middleware/auth");

router.route("/all").get(isAuthenticatedUser, getAllUsers);
router.route("/register").post(registerUser);
router.route("/login").post(loginUser);
router.route("/logout").get(logoutUser);
router.route("/forgotpassword").post(forgotPassword);
router.route("/resetpassword/:token").put(resetPassword);
router.route("/delete").delete(deleteUser);


module.exports = router;