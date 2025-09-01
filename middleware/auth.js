// Importing the library
const jwt = require('jsonwebtoken')

// Importing the file created.
const User = require('../models/user')
const catchAsyncErrors = require('./catchAsyncErrors')
const ErrorHandler = require('../utils/errorHandler')


const isAuthenticatedUser = catchAsyncErrors( async (req, res, next) => {
    let token = req.headers.authorization
    
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        
        try {
            token = token.split(' ')[1]
            
            const decoded = jwt.verify(token, process.env.JWT_SECRET)
            req.user = await User.findById(decoded.id)
    
            if (!req.user) {
                return next(new ErrorHandler('User not found', 404));
            }
    
            next()
        } catch (error) {
            console.error(error);
            return next(new ErrorHandler('Invalid or expired token', 401));
        } 
    }

    if (!token){
        return next(new ErrorHandler('Login First to access this resource', 401));
    }

});

module.exports = isAuthenticatedUser