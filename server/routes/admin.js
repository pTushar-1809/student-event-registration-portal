const express = require('express');
const Event = require('../models/event');
const User = require('../models/user');
const Registration = require('../models/registration');
const auth = require('../middleware/auth'); 
const sendEmail = require('../utils/sendEmail');
const multer = require('multer');

const router = express.Router();
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
}[character]));
const bannerUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (req, file, callback) => {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
            return callback(new Error('Banner must be a JPG, PNG, or WebP image'));
        }
        callback(null, true);
    }
});
const handleBannerUpload = (req, res, next) => {
    bannerUpload.single('banner')(req, res, error => {
        if (error) {
            const message = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE'
                ? 'Banner image must be 2 MB or smaller.'
                : error.message;
            return res.status(400).json({ message });
        }
        next();
    });
};

function getEventPayload(body, file, existingBanner = '') {
    body = body || {};
    const { title, description, date, location, category } = body;
    const capacity = Number(body.capacity);
    const eventDate = new Date(date);

    if (![title, description, date, location, category].every(value => typeof value === 'string' && value.trim())) {
        return { error: 'Title, description, date, location, and category are required.' };
    }
    if (!Number.isFinite(capacity) || !Number.isInteger(capacity) || capacity < 1) {
        return { error: 'Capacity must be a positive whole number.' };
    }
    if (Number.isNaN(eventDate.getTime())) {
        return { error: 'Please provide a valid event date.' };
    }

    return {
        value: {
            title: title.trim(),
            description: description.trim(),
            date: eventDate,
            location: location.trim(),
            category: category.trim(),
            capacity,
            bannerImage: file
                ? `data:${file.mimetype};base64,${file.buffer.toString('base64')}`
                : body.removeBanner === 'true'
                    ? ''
                    : existingBanner
        }
    };
}

// Apply admin role protection to all routes in this file
router.use(auth(['admin']));

router.get('/stats', async (req, res) => {
    try {
        const [users, events, registrations, alumni] = await Promise.all([
            User.countDocuments(),
            Event.countDocuments(),
            Registration.countDocuments({ status: { $in: ['confirmed', 'waitlisted'] } }),
            User.countDocuments({ role: 'alumni', is_active: { $ne: false } })
        ]);
        res.json({ users, events, registrations, activeAlumni: alumni });
    } catch (err) {
        console.error('Admin dashboard statistics error:', err);
        res.status(500).json({ message: 'Error loading dashboard statistics' });
    }
});

// ========================
// EVENT CRUD OPERATIONS
// ========================

// 1. CREATE Event
router.post('/events', handleBannerUpload, async (req, res) => {
    try {
        const payload = getEventPayload(req.body, req.file);
        if (payload.error) return res.status(400).json({ message: payload.error });
        const newEvent = new Event(payload.value);
        await newEvent.save();
        res.status(201).json({ message: 'Event created successfully', event: newEvent });
    } catch (err) {
        if (err instanceof multer.MulterError) {
            return res.status(400).json({ message: err.code === 'LIMIT_FILE_SIZE' ? 'Banner image must be 2 MB or smaller.' : err.message });
        }
        console.error('Admin event creation error:', err);
        if (err.name === 'ValidationError') return res.status(400).json({ message: err.message });
        res.status(500).json({ message: 'Error creating event' });
    }
});

// 2. UPDATE Event
router.put('/events/:id', handleBannerUpload, async (req, res) => {
    try {
        const event = await Event.findById(req.params.id);
        if (!event) return res.status(404).json({ message: 'Event not found' });

        const payload = getEventPayload(req.body, req.file, event.bannerImage);
        if (payload.error) return res.status(400).json({ message: payload.error });
        event.set(payload.value);
        await event.save();

        const confirmedCount = await Registration.countDocuments({
            event: event._id,
            status: 'confirmed'
        });
        const availableSeats = Math.max(event.capacity - confirmedCount, 0);
        let promotedCount = 0;

        for (let seat = 0; seat < availableSeats; seat += 1) {
            const registration = await Registration.findOne({
                event: event._id,
                status: 'waitlisted'
            }).sort({ registeredAt: 1 });
            if (!registration) break;

            registration.status = 'confirmed';
            await registration.save();
            promotedCount += 1;

            const user = await User.findById(registration.user);
            if (user) {
                await sendEmail({
                    email: user.email,
                    subject: `Your place is confirmed: ${event.title}`,
                    message: `A place has opened for ${event.title}. Your registration is now confirmed.`,
                    html: `<p>A place has opened for <strong>${event.title}</strong>. Your registration is now confirmed.</p>`
                });
            }
        }

        const message = promotedCount
            ? `Event updated successfully. ${promotedCount} waitlisted student(s) moved to confirmed.`
            : 'Event updated successfully';
        res.json({ message, event, promotedCount });
    } catch (err) {
        if (err instanceof multer.MulterError) {
            return res.status(400).json({ message: err.code === 'LIMIT_FILE_SIZE' ? 'Banner image must be 2 MB or smaller.' : err.message });
        }
        console.error('Admin event update error:', err);
        if (err.name === 'ValidationError') return res.status(400).json({ message: err.message });
        res.status(500).json({ message: 'Error updating event' });
    }
});

// 3. DELETE Event
router.delete('/events/:id', async (req, res) => {
    try {
        const deletedEvent = await Event.findByIdAndDelete(req.params.id);
        if (!deletedEvent) return res.status(404).json({ message: 'Event not found' });
        
        // Also delete associated registrations
        await Registration.deleteMany({ event: req.params.id });
        
        res.json({ message: 'Event and associated registrations deleted' });
    } catch (err) {
        console.error('Admin event deletion error:', err);
        res.status(500).json({ message: 'Error deleting event' });
    }
});

// ========================
// USER & REPORTING
// ========================

// Get and search users
router.get('/users', async (req, res) => {
    try {
        const search = String(req.query.search || '').trim();
        const filter = search
            ? {
                $or: ['name', 'email', 'collegeId'].map(field => ({
                    [field]: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' }
                }))
            }
            : {};
        const users = await User.find(filter).select('-password -refreshToken').sort({ name: 1 }).lean();
        res.json(users);
    } catch (err) {
        console.error('Admin user search error:', err);
        res.status(500).json({ message: 'Error fetching users' });
    }
});

router.patch('/users/:id', async (req, res) => {
    try {
        const allowedRoles = ['student', 'alumni', 'admin'];
        const hasRole = Object.prototype.hasOwnProperty.call(req.body, 'role');
        const hasActive = Object.prototype.hasOwnProperty.call(req.body, 'is_active');
        if ((!hasRole && !hasActive)
            || (hasRole && !allowedRoles.includes(req.body.role))
            || (hasActive && typeof req.body.is_active !== 'boolean')) {
            return res.status(400).json({ message: 'Provide a valid role and/or active status.' });
        }

        if (req.params.id === req.user.userId) {
            return res.status(400).json({ message: 'You cannot change your own role or account status.' });
        }

        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ message: 'User not found' });

        const removingAdminAccess = user.role === 'admin'
            && ((hasRole && req.body.role !== 'admin') || (hasActive && !req.body.is_active));
        if (removingAdminAccess) {
            const activeAdmins = await User.countDocuments({ role: 'admin', is_active: { $ne: false } });
            if (activeAdmins <= 1) {
                return res.status(400).json({ message: 'The last active administrator cannot be demoted or suspended.' });
            }
        }

        if (hasRole) user.role = req.body.role;
        if (hasActive) user.is_active = req.body.is_active;
        await user.save();
        res.json({
            message: 'User updated successfully.',
            user: {
                _id: user._id,
                name: user.name,
                email: user.email,
                collegeId: user.collegeId,
                role: user.role,
                is_active: user.is_active,
                is_verified: user.is_verified
            }
        });
    } catch (err) {
        console.error('Admin user update error:', err);
        res.status(500).json({ message: 'Error updating user' });
    }
});

router.get('/events/:id/registrations', async (req, res) => {
    try {
        const event = await Event.findById(req.params.id).select('title');
        if (!event) return res.status(404).json({ message: 'Event not found' });
        const registrations = await Registration.find({ event: event._id })
            .populate('user', 'name email collegeId')
            .sort({ registeredAt: 1 })
            .lean();
        res.json({ event: event.title, registrations });
    } catch (err) {
        console.error('Admin registration report error:', err);
        res.status(500).json({ message: 'Error loading event registrations' });
    }
});

router.get('/events/:id/export', async (req, res) => {
    try {
        const event = await Event.findById(req.params.id).select('title');
        if (!event) return res.status(404).json({ message: 'Event not found' });
        const registrations = await Registration.find({ event: event._id })
            .populate('user', 'name email collegeId')
            .sort({ registeredAt: 1 })
            .lean();
        const csvValue = value => {
            const rawValue = String(value ?? '');
            const safeValue = /^[\s]*[=+\-@]/.test(rawValue) ? `'${rawValue}` : rawValue;
            return `"${safeValue.replace(/"/g, '""')}"`;
        };
        const rows = [
            ['Event', 'Name', 'Email', 'College ID', 'Status', 'Registered At'],
            ...registrations.map(registration => [
                event.title,
                registration.user?.name,
                registration.user?.email,
                registration.user?.collegeId,
                registration.status,
                registration.registeredAt?.toISOString()
            ])
        ];
        res.type('text/csv');
        res.attachment(`registrations-${event._id}.csv`);
        res.send(rows.map(row => row.map(csvValue).join(',')).join('\r\n'));
    } catch (err) {
        console.error('Admin registration CSV export error:', err);
        res.status(500).json({ message: 'Error exporting registrations' });
    }
});

router.post('/events/:id/notify', async (req, res) => {
    try {
        const { subject, message } = req.body;
        if (typeof subject !== 'string' || !subject.trim() || typeof message !== 'string' || !message.trim()) {
            return res.status(400).json({ message: 'Subject and message are required.' });
        }
        const event = await Event.findById(req.params.id);
        if (!event) return res.status(404).json({ message: 'Event not found' });

        const registrations = await Registration.find({
            event: event._id,
            status: { $in: ['confirmed', 'waitlisted'] }
        }).populate('user', 'email name');
        const recipients = [...new Map(
            registrations.filter(registration => registration.user?.email)
                .map(registration => [registration.user.email, registration.user])
        ).values()];
        const results = await Promise.all(recipients.map(user => sendEmail({
            email: user.email,
            subject: subject.trim(),
            message: message.trim(),
            html: `<p>Hello ${escapeHtml(user.name)},</p><p>${escapeHtml(message.trim()).replace(/\n/g, '<br>')}</p><p>Event: ${escapeHtml(event.title)}</p>`
        })));
        const sent = results.filter(result => result.sent).length;
        res.json({
            message: `${sent} of ${recipients.length} notification emails sent.`,
            total: recipients.length,
            sent,
            failed: recipients.length - sent
        });
    } catch (err) {
        console.error('Admin bulk notification error:', err);
        res.status(500).json({ message: 'Error sending event notifications' });
    }
});

module.exports = router;