const express = require('express')
const router = express.Router();
const upload = require("../middleware/upload");

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
    deleteData,
    getaProcessHistory,
    getProcessRowHistory,
    getProductDetails
} = require("../controllers/processController");

router.route("/all").get(isAuthenticatedUser, getAllProcesses)
router.route("/search").get(isAuthenticatedUser, getProductDetails);

router.route("/create").post(isAuthenticatedUser, createProcess);
router.route("/department/:id").get(isAuthenticatedUser, getProcessByDepartmentId);
router.route("/:id").get(isAuthenticatedUser, getProcessById).put(isAuthenticatedUser, updateProcess).delete(isAuthenticatedUser, deleteProcess);
router.route("/headers/:id").post(isAuthenticatedUser, addHeader).delete(isAuthenticatedUser, deleteHeader);

router.route("/data/:id").post(
    isAuthenticatedUser,
    upload.fields([
        { name: 'UPLOAD', maxCount: 1 },
        { name: 'BEFORE', maxCount: 1 },
        { name: 'AFTER', maxCount: 1 },
        { name: 'CALIBRATION CERTIFICATE NO / DATE', maxCount: 1 },
        { name: 'ACTION REPORT', maxCount: 1 },
        { name: 'NPD FORM', maxCount: 1 },
        { name: "EVALUATE", maxCount: 1 },
        { name: "IMAGE", maxCount: 1 }
    ]),
    addData)
    .put(
        isAuthenticatedUser,
        upload.fields([
            { name: 'UPLOAD', maxCount: 1 },
            { name: 'BEFORE', maxCount: 1 },
            { name: 'AFTER', maxCount: 1 },
            { name: 'CALIBRATION CERTIFICATE NO / DATE', maxCount: 1 },
            { name: 'ACTION REPORT', maxCount: 1 },
            { name: 'NPD FORM', maxCount: 1 },
            { name: "EVALUATE", maxCount: 1 },
            { name: "IMAGE", maxCount: 1 }
        ]),
        updateData)
    .delete(isAuthenticatedUser, deleteData);
    
router.route("/history/:id").get(isAuthenticatedUser, getaProcessHistory);
router.route("/history/:id/:rowId").get(isAuthenticatedUser, getProcessRowHistory);

module.exports = router;
