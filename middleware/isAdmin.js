const ErrorHandler = require("../utils/errorHandler");

/**
 * Allows the request only for admins (user.accessLevel === "admin" — the same rule the client
 * uses in services/permissions.js). Use after isAuthenticatedUser, which sets req.user.
 */
const isAdmin = (req, res, next) => {
  if (String(req.user?.accessLevel || "").toLowerCase() !== "admin") {
    return next(
      new ErrorHandler("Only admins can change categories and products. Please ask an admin for access.", 403),
    );
  }
  next();
};

module.exports = isAdmin;
