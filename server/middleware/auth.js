const jwt = require('jsonwebtoken');
const User = require('../models/user');

module.exports = (roles = []) => async (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'No token' });

    let decoded;
    try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
        return res.status(401).json({ message: 'Invalid token' });
    }

    const user = await User.findById(decoded.userId).select('role is_active');
    if (!user || user.is_active === false) {
        return res.status(401).json({ message: 'Account is inactive or no longer exists' });
    }
    if (roles.length && !roles.includes(user.role)) {
        return res.status(403).json({ message: 'Forbidden' });
    }

    req.user = { ...decoded, role: user.role };
    next();
};