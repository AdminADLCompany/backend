const express = require('express');
const router = express.Router();

const {
    getAllCategories,
    getCategoryTree,
    createCategory,
    updateCategory,
    deleteCategory
} = require('../controllers/categoryController');

const isAuthenticatedUser = require('../middleware/auth');
const isAdmin = require('../middleware/isAdmin');

router.route('/all').get(getAllCategories);
router.route('/tree').get(getCategoryTree);
router.route('/new').post(isAuthenticatedUser, isAdmin, createCategory);
router.route('/:id').put(isAuthenticatedUser, isAdmin, updateCategory).delete(isAuthenticatedUser, isAdmin, deleteCategory);

module.exports = router;
