const express = require('express');
const router = express.Router();

const isAuthenticatedUser = require("../middleware/auth");
const isAdmin = require("../middleware/isAdmin");

const {
    getAllProducts,
    getProductById,
    createProduct,
    updateProduct,
    deleteProduct,
    addGraphData
} = require('../controllers/productController');

router.route('/all').get(getAllProducts)
router.route('/create').post(isAuthenticatedUser, isAdmin, createProduct);
router.route('/:id').get(getProductById)
    .put(isAuthenticatedUser, isAdmin, updateProduct)
    .delete(isAuthenticatedUser, isAdmin, deleteProduct);
router.route('/graph/:id').post(isAuthenticatedUser, isAdmin, addGraphData);

module.exports = router;