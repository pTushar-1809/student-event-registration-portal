const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['student', 'alumni', 'admin'], required: true },
    collegeId: { type: String, required: true },
    is_verified: { type: Boolean, default: false },
    is_active: { type: Boolean, default: true },
    refreshToken: { type: String } // NEW FIELD ADDED
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);