const express = require('express')
const router = express.Router();

const isAuthenticatedUser = require("../middleware/auth");

const {
    getAllProcesses,
    getProcessById,
    getProcessByDepartmentId,
    createProcess,
    updateProcess,
    deleteProcess,
    addHeader,
    deleteHeader,
    addData,
    updateData,
    deleteData
} = require("../controllers/processController");

router.route("/all").get(isAuthenticatedUser, getAllProcesses)
router.route("/create").post(isAuthenticatedUser, createProcess);
router.route("/department/:id").get(isAuthenticatedUser, getProcessByDepartmentId);
router.route("/:id").get(isAuthenticatedUser, getProcessById).put(isAuthenticatedUser, updateProcess).delete(isAuthenticatedUser, deleteProcess);
router.route("/headers/:id").post(isAuthenticatedUser, addHeader).delete(isAuthenticatedUser, deleteHeader);
router.route("/data/:id").post(isAuthenticatedUser, addData)
    .put(isAuthenticatedUser, updateData)
    .delete(isAuthenticatedUser, deleteData);

module.exports = router;
