const express = require('express');
const router = express.Router();

const {
    getAllCategories,
    createCategory,
    updateCategory,
    deleteCategory
} = require('../controllers/categoryController');

const isAuthenticatedUser = require('../middleware/auth');

router.route('/all').get(getAllCategories);
router.route('/new').post(isAuthenticatedUser, createCategory);
router.route('/:id').put(isAuthenticatedUser, updateCategory).delete(isAuthenticatedUser, deleteCategory);

module.exports = router;
