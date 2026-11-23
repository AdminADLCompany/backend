const express = require('express');
const router = express.Router();

const {
    getAllSubCategories,
    getSubCategoriesByCategory,
    createSubCategory,
    updateSubCategory,
    deleteSubCategory
} = require('../controllers/subCategoryController');

const isAuthenticatedUser = require('../middleware/auth');
const isAdmin = require('../middleware/isAdmin');

router.route('/all').get(getAllSubCategories);
router.route('/category/:categoryId').get(getSubCategoriesByCategory);
router.route('/new').post(isAuthenticatedUser, isAdmin, createSubCategory);
router.route('/:id').put(isAuthenticatedUser, isAdmin, updateSubCategory).delete(isAuthenticatedUser, isAdmin, deleteSubCategory);

module.exports = router;
