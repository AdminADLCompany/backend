const User = require("../models/user");
const History = require("../models/history");

const ErrorHandler = require("../utils/errorHandler");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const sendToken = require("../utils/jwtToken");
const sendEmail = require("../utils/sendEmail");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

exports.getAllUsers = catchAsyncErrors( async (req, res, next) => {
    try {
        const users = await User.find();

        res.status(200).json({
            success: true,
            result: users
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

exports.registerUser = catchAsyncErrors( async (req, res, next) => {
    // getting the request body details one by one from req.body 
    let {
        email,
        employeeId,
        userName,
        role,
        password,
        access 
    } = req.body;
    
    // Finding the user already exists or not. 

    // Check if a user exists with the provided email or phone number
    let userByEmail = await User.findOne({ email: email });
    let userByEmployeeId = await User.findOne({ employeeId: employeeId });

    // Build the error message based on which field(s) already exist
    let errorMessage = '';

    if (userByEmail && userByEmployeeId) {
        errorMessage = 'User with this email and Employee ID already exists.';
    } else if (userByEmail) {
        errorMessage = 'User with this email already exists.';
    } else if (userByEmployeeId) {
        errorMessage = 'User with this Employee ID already exists.';
    }

    // If any user exists, throw an error
    if (errorMessage) {
        return next(new ErrorHandler(errorMessage, 400));
    }

    // Trimming the spaces
    email = email.trim()
    userName = userName.trim()
    password = password.trim()
    employeeId = employeeId.trim()
    role = role.trim()
    access = access.trim()

    // Creating a new user
    let user = await User.create({
        email,
        userName,
        employeeId,
        role,
        access,
        password
    })

    // Saving the user
    await user.save();

    // Sending token
    sendToken(user, 201, res)
})

// Logging user API
exports.loginUser = catchAsyncErrors ( async (req, res, next) => {
    // Getting the request body details for logging in.
    const { 
        email, 
        password 
    } = req.body;

    // Empty form handling error.
    if (!email || !password){
        return next(new ErrorHandler('Please enter email and password', 400))
    }

    // Finding the user already exists or not.
    const user = await User.findOne({ email }).select('+password');

    // Error handling for user not found
    if (!user){
        return next(new ErrorHandler('Invalid Email or Password', 401))
    }

    // Comparing the password and confirm password whether both are same
    const isMatch = await user.comparePassword(password);
    
    // Error handling for password not match.
    if (!isMatch){
        return next(new ErrorHandler('Invalid Email or Password', 401))
    }
    
    // Sending response token
    sendToken(user, 200, res)
})

// Logout the user API
exports.logoutUser = catchAsyncErrors ( async (req, res, next) => {
    
    // Deleting the token from the cookie
    res.cookie('token', '', {
        expires: new Date(0),
        httpOnly: true,
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        secure: process.env.NODE_ENV === 'production'
    })

    // sending the response message
    res.status(200).json({
        success: true,
        message: 'Logged out successfully'
    })
})

// Access to change password
exports.forgotPassword = catchAsyncErrors ( async (req, res, next) => {
    // Getting the email from request body
    const { email } = req.body;

    // Getting the user details or checking wheater use exists or not.
    const user = await User.findOne({ email })

    // Error handling while user not found 
    if (!user){
        return next(new ErrorHandler('User not found or Invalid email ID', 404))
    }

    // Generate a 6-digit OTP
    const generateOTP = () => {
        return crypto.randomInt(100000, 999999).toString();
    };

    // Generating OTP
    const otp = generateOTP();
    const otpExpire = Date.now() + 10 * 60 * 1000;

    // Saving the OTP
    user.otp = otp
    user.otpExpire = otpExpire

    // Saving the token
    await user.save({ validateBeforeSave: false })

    // Email Message we have to send for the user.
    const message = `Your OTP for password reset is: ${otp}. It will expire in 10 minutes.`

    try{
        // Sending email
        await sendEmail({
            email: user.email,
            subject: 'Scrap password recovery OTP sent',
            message
        })

        // Sending response message
        res.status(200).json({
            success: true,
            message: `Email sent to ${user.email} successfully`
        })

    } catch(error){
        user.otp = undefined
        user.otpExpire = undefined

        await user.save({ validateBeforeSave: false })

        console.log(error)
        
        // Sending error response
        return res.status(500).json({
            success: false,
            message: 'Email could not be sent'
        })
    }
})

// Reset Password Post API 
exports.resetPassword = catchAsyncErrors ( async (req, res, next) => {
    // Getting the request body
    const { email, otp, password, confirmPassword } = req.body;

    // Check if the user exists and OTP valid or not 
    const user = await User.findOne({ email, otp, otpExpire: { $gt: Date.now() } });

    // user check
    if (!user) {
        return next(new ErrorHandler('Invalid OTP or OTP has expired', 400));
    }

    // Checkling password
    if (password !== confirmPassword) {
        return next(new ErrorHandler( 'Passwords do not match' , 400))
    }

    // Storing the value
    user.password = password;
    user.otp = undefined; // Clearing OTP after successful password change
    user.otpExpire = undefined;

    // Saving the user.
    await user.save();

    // Sending response message
    res.status(200).json({
        success: true,
        message: 'Password updated successfully'
    })
})

// Delete User Account API
exports.deleteUser = catchAsyncErrors ( async (req, res, next) => {

    // Getting the user id
    const { email, password } = req.body;

    // Empty form handling error.
    if (!email || !password){
        return next(new ErrorHandler('Please enter email and password', 400))
    }

    // Getting the user details or checking wheater use exists or not.
    const user = await User.findOne({ email }).select('+password')

    // Error handling while user not found
    if (!user){
        return next(new ErrorHandler('User not found or Invalid email ID', 404))
    }

    // Checking password
    const isMatch = await bcrypt.compare(password, user.password)

    // Password check
    if (!isMatch){
        return next(new ErrorHandler('Invalid email or password', 401))
    }

    // Deleting the user
    await user.remove()

    // Sending response message
    res.status(200).json({
        success: true,
        message: 'Account deleted successfully'
    })
})

exports.getUserHistory = catchAsyncErrors( async (req, res, next) => {
    const history = await History.find({ 
        updatedBy: req.user._id
    }).populate('updatedBy', 'userName email').sort({ timestamp: -1 });

    res.status(200).json({
        success: true,
        data: history
    });
});