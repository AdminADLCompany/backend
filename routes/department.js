const express = require('express')
const router = express.Router()

const isAuthenticatedUser = require("../middleware/auth");

const {
    getAllDepartments,
    getDepartmentById,
    createDepartment,
    updateDepartment,
    deleteDepartment,
    addProcess,
    deleteProcess,
    getDepartmentHistory
} = require('../controllers/departmentController');

router.route('/all').get(getAllDepartments);
router.route('/create').post(isAuthenticatedUser, createDepartment);
router.route('/:id').get(getDepartmentById)
    .put(isAuthenticatedUser, updateDepartment)
    .delete(isAuthenticatedUser, deleteDepartment);

router.route('/process/:id').post(isAuthenticatedUser, addProcess);
router.route('/process/:id').delete(isAuthenticatedUser, deleteProcess);

router.route('/history/:id').get(isAuthenticatedUser, getDepartmentHistory);

module.exports = router;