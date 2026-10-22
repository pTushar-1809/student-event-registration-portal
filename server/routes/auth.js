const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/user');
const sendEmail = require('../utils/sendEmail');
const rateLimit = require('express-rate-limit');
const { check, validationResult } = require('express-validator');

const router = express.Router();

// Limit logins to 5 requests per 15 minutes per IP
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5,
    message: { message: 'Too many login attempts from this IP, please try again after 15 minutes' }
});

// Register User
router.post('/register', [
        check('name', 'Name is required').not().isEmpty(),
        check('email', 'Please include a valid email').isEmail(),
        check('password', 'Use at least 8 characters, including 1 uppercase letter and 1 number')
            .isLength({ min: 8 })
            .matches(/^(?=.*[A-Z])(?=.*\d).{8,}$/),
        check('role', 'Role must be student or alumni').isIn(['student', 'alumni'])
    ], async (req, res) => {
    
    // 1. Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    
    try {
        const { name, email, password, role, collegeId } = req.body;

        // Check if user exists
        let user = await User.findOne({ email });
        if (user) return res.status(400).json({ msg: 'User already exists' });

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Create new user (is_verified defaults to false)
        user = new User({ name, email, password: hashedPassword, role, collegeId });
        await user.save();

        // Generate Verification Token (24hr expiry)
        const verificationToken = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '24h' });
        
        // Send Email
        const verificationUrl = `${process.env.CLIENT_URL}/api/auth/verify/${verificationToken}`;
        const emailHtml = `<p>Hello ${name},</p><p>Please verify your email by clicking <a href="${verificationUrl}">this link</a>.</p>`;
        
        const emailResult = await sendEmail({
            email: email,
            subject: 'Verify Your College Portal Account',
            message: `Please verify your email using this link: ${verificationUrl}`,
            html: emailHtml
        });

        const message = !emailResult.sent
            ? 'Account created, but the verification email could not be sent. Check the server logs and SMTP configuration.'
            : emailResult.previewUrl
                ? 'Registration successful. Open the email preview link printed in the server terminal to verify your account.'
                : 'Registration successful. Check your email for the verification link.';
        res.status(201).json({ msg: message });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// Verify Email
router.get('/verify/:token', async (req, res) => {
    try {
        // Decode token
        const decoded = jwt.verify(req.params.token, process.env.JWT_SECRET);
        
        // Update user
        await User.findByIdAndUpdate(decoded.userId, { is_verified: true });

        const clientUrl = process.env.CLIENT_URL || 'http://localhost:5000';
        res.redirect(`${clientUrl}/login.html?verified=true`);
    } catch (err) {
        console.error(err);
        res.status(400).send('Invalid or expired token');
    }
});

// Login
router.post('/login', loginLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;
        
        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ message: 'Invalid credentials' });

        if (user.is_active === false) return res.status(403).json({ message: 'This account has been suspended. Contact an administrator.' });
        if (!user.is_verified) return res.status(401).json({ message: 'Please verify your email first' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ message: 'Invalid credentials' });

        // Create tokens
        const accessToken = jwt.sign(
            { userId: user._id, role: user.role }, 
            process.env.JWT_SECRET, 
            { expiresIn: '15m' }
        );
        const refreshToken = jwt.sign(
            { userId: user._id }, 
            process.env.REFRESH_SECRET, 
            { expiresIn: '7d' }
        );

        // Save refresh token in DB
        user.refreshToken = refreshToken;
        await user.save();

        // Send refresh token as HTTP-only cookie
        res.cookie('jwt', refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production', // true if HTTPS
            sameSite: 'strict',
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        });

        res.json({ accessToken, role: user.role, name: user.name });
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Refresh Token
router.post('/refresh', async (req, res) => {
    const cookies = req.cookies;
    if (!cookies?.jwt) return res.status(401).json({ message: 'No refresh token' });

    const refreshToken = cookies.jwt;
    const user = await User.findOne({ refreshToken });
    if (!user) return res.status(403).json({ message: 'Invalid refresh token' });

    try {
        jwt.verify(refreshToken, process.env.REFRESH_SECRET);
        const newAccessToken = jwt.sign(
            { userId: user._id, role: user.role }, 
            process.env.JWT_SECRET, 
            { expiresIn: '15m' }
        );
        res.json({ accessToken: newAccessToken });
    } catch {
        res.status(403).json({ message: 'Token expired' });
    }
});

// Logout
router.post('/logout', async (req, res) => {
    const cookies = req.cookies;
    if (!cookies?.jwt) return res.sendStatus(204); 

    const refreshToken = cookies.jwt;
    const user = await User.findOne({ refreshToken });
    if (user) {
        user.refreshToken = '';
        await user.save();
    }

    res.clearCookie('jwt', { httpOnly: true, sameSite: 'strict' });
    res.json({ message: 'Logged out successfully' });
});

module.exports = router;