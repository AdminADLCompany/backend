const ErrorHandler = require("../utils/errorHandler");

module.exports = (err, req, res, next) => {
    err.statusCode = err.statusCode || 500;

    // Development Error Handler 
    if ( process.env.NODE_ENV === "development") {
        res.status(err.statusCode).json({
            success: false,
            error: err,
            errorMessage: err.message,
            stack: err.stack,
        });
    }

    // Production Error Handler
    if ( process.env.NODE_ENV === "production") {
        let error = { ...err };

        error.message = err.message;

        // Wrong Mongoose Object ID Error
        if (err.name === "CastError") {
            const message = `Resource not found. Invalid: ${err.path}`;
            error = new ErrorHandler(message, 400);
        }

        // Mongoose Validation Error
        if (err.name === "ValidationError") {
            const message = Object.values(err.errors).map((value) => value.message);
            error = new ErrorHandler(message, 400);
        }

        // Mongoose Duplicate Key Error
        if (err.code === 11000) {
            const message = `Duplicate ${Object.keys(err.keyValue)} entered`;
            error = new ErrorHandler(message, 400);
        }

        // Wrong JWT Error
        if (err.name === "JsonWebTokenError") {
            const message = "JSON Web Token is invalid. Try again!!!";
            error = new ErrorHandler(message, 400);
        }

        // JWT Expire Error
        if (err.name === "TokenExpiredError") {
            const message = "JSON Web Token is expired. Try again!!!";
            error = new ErrorHandler(message, 400);
        }

        // Wrong Mongoose Object ID Error
        if (err.name === "CastError") {
            const message = `Resource not found. Invalid: ${err.path}`;
            error = new ErrorHandler(message, 400);
        }

        res.status(err.statusCode).json({
            success: false,
            message: error.message,
        })
    };
};

