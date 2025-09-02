const express = require('express');
const router = express.Router();

const isAuthenticatedUser = require("../middleware/auth");

const {
    getAllProducts,
    getProductById,
    createProduct,
    updateProduct,
    deleteProduct,
    addGraphData
} = require('../controllers/productController');

router.route('/all').get(getAllProducts)
router.route('/create').post(isAuthenticatedUser, createProduct);
router.route('/:id').get(getProductById)
    .put(isAuthenticatedUser, updateProduct)
    .delete(isAuthenticatedUser, deleteProduct);
router.route('/graph/:id').post(isAuthenticatedUser, addGraphData);

module.exports = router;