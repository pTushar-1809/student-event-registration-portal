const express = require('express');
const Event = require('../models/event');
const Registration = require('../models/registration');
const User = require('../models/user');
const sendEmail = require('../utils/sendEmail');
const auth = require('../middleware/auth');
const router = express.Router();

async function promoteWaitlisted(eventId, availableSeats) {
    const promoted = [];

    for (let seat = 0; seat < availableSeats; seat += 1) {
        const registration = await Registration.findOne({ event: eventId, status: 'waitlisted' })
            .sort({ registeredAt: 1 });
        if (!registration) break;

        registration.status = 'confirmed';
        await registration.save();
        promoted.push(registration);
    }

    for (const registration of promoted) {
        const [user, event] = await Promise.all([
            User.findById(registration.user),
            Event.findById(eventId)
        ]);
        if (user && event) {
            await sendEmail({
                email: user.email,
                subject: `Your place is confirmed: ${event.title}`,
                message: `A place has opened for ${event.title}. Your registration is now confirmed.`,
                html: `<p>A place has opened for <strong>${event.title}</strong>. Your registration is now confirmed.</p>`
            });
        }
    }

    return promoted.length;
}

// Get all events (Protected for enrolled and admin users)
router.get('/', auth(['student', 'alumni', 'admin']), async (req, res) => {
    try {
        const events = await Event.find().sort({ date: 1 }).lean();
        const eventIds = events.map((event) => event._id);
        const registrationCounts = eventIds.length
            ? await Registration.aggregate([
                {
                    $match: {
                        event: { $in: eventIds },
                        status: { $in: ['confirmed', 'waitlisted'] }
                    }
                },
                {
                    $group: {
                        _id: { event: '$event', status: '$status' },
                        count: { $sum: 1 }
                    }
                }
            ])
            : [];
        const countsByEvent = new Map();
        for (const item of registrationCounts) {
            const eventId = item._id.event.toString();
            const counts = countsByEvent.get(eventId) || { confirmed: 0, waitlisted: 0 };
            counts[item._id.status] = item.count;
            countsByEvent.set(eventId, counts);
        }

        res.json(events.map((event) => {
            const counts = countsByEvent.get(event._id.toString()) || { confirmed: 0, waitlisted: 0 };
            return {
                ...event,
                confirmedCount: counts.confirmed,
                waitlistCount: counts.waitlisted,
                availableSpots: Math.max(event.capacity - counts.confirmed, 0)
            };
        }));
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Get My Registrations
router.get('/my-registrations', auth(['student', 'alumni']), async (req, res) => {
    try {
        const registrations = await Registration.find({ user: req.user.userId })
            .populate('event', 'title date location');
        res.json(registrations);
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Register for an event
router.post('/:id/register', auth(['student', 'alumni']), async (req, res) => {
    try {
        const eventId = req.params.id;
        const userId = req.user.userId;

        // Check if already registered or waitlisted
        const existingReg = await Registration.findOne({ user: userId, event: eventId, status: { $ne: 'cancelled' } });
        if (existingReg) return res.status(400).json({ message: 'Already registered or waitlisted for this event.' });

        const event = await Event.findById(eventId);
        if (!event) return res.status(404).json({ message: 'Event not found' });

        // Count current confirmed registrations
        const confirmedCount = await Registration.countDocuments({ event: eventId, status: 'confirmed' });

        let status = 'confirmed';
        if (confirmedCount >= event.capacity) {
            status = 'waitlisted';
        }

        const registration = new Registration({ user: userId, event: eventId, status });
        await registration.save();

        let emailResult = { sent: false, previewUrl: null };
        const user = await User.findById(userId);
        if (user) {
            const confirmation = status === 'confirmed'
                ? `Your registration for ${event.title} is confirmed.`
                : `You are on the waitlist for ${event.title}. We will notify you if a place opens.`;
            emailResult = await sendEmail({
                email: user.email,
                subject: status === 'confirmed'
                    ? `Registration confirmed: ${event.title}`
                    : `Waitlist confirmation: ${event.title}`,
                message: confirmation,
                html: `<p>${confirmation}</p>`
            });
        }

        const emailMessage = !emailResult.sent
            ? ' Email delivery failed; check the server logs.'
            : emailResult.previewUrl
                ? ' Open the email preview link printed in the server terminal.'
                : ' A confirmation email was sent.';
        res.status(201).json({
            message: `Registration successful. Status: ${status}.${emailMessage}`,
            status,
            emailSent: emailResult.sent
        });
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Cancel Registration & Auto-Promote Waitlist
router.post('/:id/cancel', auth(['student', 'alumni']), async (req, res) => {
    try {
        const eventId = req.params.id;
        const userId = req.user.userId;

        const registration = await Registration.findOne({ user: userId, event: eventId, status: { $ne: 'cancelled' } });
        if (!registration) return res.status(400).json({ message: 'Active registration not found.' });

        const wasConfirmed = registration.status === 'confirmed';
        registration.status = 'cancelled';
        await registration.save();

        if (wasConfirmed) {
            await promoteWaitlisted(eventId, 1);
        }

        res.json({ message: 'Registration cancelled successfully.' });
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;