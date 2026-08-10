/**
 * Catches errors thrown inside async route handlers (via the asyncHandler
 * wrapper) plus multer errors, and returns a consistent JSON error shape
 * instead of leaking stack traces to API clients.
 */
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
    console.error(err);

    if (err.name === 'MulterError' || /not allowed/.test(err.message || '')) {
        return res.status(400).json({ error: err.message });
    }

    const status = err.statusCode || 500;
    res.status(status).json({
        error: status === 500 ? 'Internal server error' : err.message
    });
}

/**
 * Wraps an async Express handler so a rejected promise is forwarded to
 * errorHandler instead of crashing the process or hanging the request.
 */
function asyncHandler(fn) {
    return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { errorHandler, asyncHandler };
