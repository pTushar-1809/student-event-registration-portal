const errorHandler = (err, req, res, next) => {
    console.error(err.stack); // Log for the developer

    // Don't leak stack traces in production
    const statusCode = err.statusCode || 500;
    const message = process.env.NODE_ENV === 'production' 
        ? 'Internal Server Error' 
        : err.message;

    res.status(statusCode).json({
        success: false,
        error: message
    });
};

module.exports = errorHandler;