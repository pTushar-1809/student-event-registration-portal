const express = require('express');
const path = require('path');
const dotenv = require('dotenv');
const cors = require('cors');
const connectDB = require('./config/db');
const authRoutes = require('./routes/auth');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const errorHandler = require('./middleware/errorHandler');

// Load env vars
dotenv.config();

// Connect to database
connectDB();

const app = express();

// 1. Security Headers & CORS
app.use(helmet());
app.use(cors({
    origin: ['http://localhost:5000', 'http://127.0.0.1:5000', 'http://localhost:5500', 'http://127.0.0.1:5500'],
    credentials: true
}));

// 2. Body Parsers
app.use(express.json());
app.use(cookieParser());

// 3. Serve frontend files
app.use(express.static(path.join(__dirname, '../client')));

// 4. Routes
app.use('/api/auth', authRoutes);
app.use('/api/events', require('./routes/event'));
app.use('/api/admin', require('./routes/admin'));

// Basic route to test server
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/index.html'));
});

// 5. Error Handler (Must be the last middleware after all routes)
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});