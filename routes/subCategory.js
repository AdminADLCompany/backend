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

router.route('/all').get(getAllSubCategories);
router.route('/category/:categoryId').get(getSubCategoriesByCategory);
router.route('/new').post(isAuthenticatedUser, createSubCategory);
router.route('/:id').put(isAuthenticatedUser, updateSubCategory).delete(isAuthenticatedUser, deleteSubCategory);

module.exports = router;
