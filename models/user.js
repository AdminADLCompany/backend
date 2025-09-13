const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const historyPlugin = require("../middleware/historyPlugin");

const userSchema = mongoose.Schema({
    userName: {
        type: String,
        required: true,
    },
    employeeId: {
        type: String,
        required: true,
    },
    role: {
        type: String,
        required: true,
    },
    email: {
        type: String,
        required: true,
    },
    password: {
        type: String,
        required: true,
    },
    access : {
        type: Array,
        required: true,
    },
    date: {
        type: Date,
        default: Date.now,
    },
    resetPasswordToken: String,
    resetPasswordExpire: Date,
    otp: String,
    otpExpire: Date
});

userSchema.pre('save', async function (next) {
    // Only hash the password if it has been modified (or is new)
    if(!this.isModified('password')){
        return next()
    }

    // Hashing the password
    const salt = await bcrypt.genSalt(10)
    this.password = await bcrypt.hash(this.password, salt)
    next();
})

userSchema.methods.comparePassword = async function (enteredPassword) {
    // Comparing the Entered password in login page with the current User passsword
    return await bcrypt.compare(enteredPassword, this.password)
}

userSchema.methods.getJwtToken = function () {
    // Generating the Token while the user registering the account or Getting the token comparing the ID signIn
    return jwt.sign({id: this._id}, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_TIME
    })
}

userSchema.methods.getResetPasswordToken = function () {
    // Generate the reset token for changing password. Using crypto module to HEXA values 
    const resetToken = crypto.randomBytes(20).toString('hex');

    // Hashing and adding resetPasswordToken to userSchema
    this.resetPasswordToken = crypto
        .createHash('sha256')
        .update(resetToken)
        .digest('hex')

    // Setting the expire time for resetPassword token generated to User.
    this.resetPasswordExpire = Date.now() + 30 * 60 * 1000

    return resetToken
}

userSchema.plugin(historyPlugin, { collectionName: "User" });

module.exports = mongoose.model("User", userSchema);