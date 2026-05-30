require('dotenv').config();
const express      = require('express');
const mongoose     = require('mongoose');
const nodemailer   = require('nodemailer');
const helmet       = require('helmet');
const rateLimit    = require('express-rate-limit');
const cors         = require('cors');
const path         = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── MIDDLEWARE ────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 min
  max: 100,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many requests, please try again later.' },
});
app.use('/api', apiLimiter);

// ── DATABASE ──────────────────────────────────────────────────
mongoose
  .connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/smartroom', {
    useNewUrlParser:    true,
    useUnifiedTopology: true,
  })
  .then(() => console.log('✅  MongoDB connected'))
  .catch(err => console.error('❌  MongoDB error:', err.message));

// ── SCHEMAS ───────────────────────────────────────────────────
const roomSchema = new mongoose.Schema({
  name:       { type: String, required: true, unique: true, trim: true },
  capacity:   { type: Number, required: true, min: 1 },
  type:       { type: String, enum: ['conf','board','lab','exec','pod','training'], default: 'conf' },
  amenities:  { type: [String], default: [] },
  status:     { type: String, enum: ['available','occupied','maintenance'], default: 'available' },
  floor:      { type: Number, default: 1 },
  createdAt:  { type: Date, default: Date.now },
});

const bookingSchema = new mongoose.Schema({
  title:      { type: String, required: true, trim: true },
  room:       { type: String, required: true },
  organizer:  { type: String, required: true, trim: true },
  email:      { type: String, trim: true },
  date:       { type: String, required: true },   // YYYY-MM-DD
  start:      { type: String, required: true },   // HH:MM
  end:        { type: String, required: true },
  attendees:  { type: Number, default: 1, min: 1 },
  notes:      { type: String, default: '' },
  amenities:  { type: [String], default: [] },
  status:     { type: String, enum: ['confirmed','reserved','cancelled','completed'], default: 'confirmed' },
  recurring:  {
    enabled:   { type: Boolean, default: false },
    frequency: { type: String, enum: ['daily','weekly','biweekly','monthly'], default: 'weekly' },
    until:     { type: String },
    groupId:   { type: String },
  },
  createdAt:  { type: Date, default: Date.now },
});

const Room    = mongoose.model('Room',    roomSchema);
const Booking = mongoose.model('Booking', bookingSchema);

// ── EMAIL TRANSPORTER ─────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

async function sendConfirmationEmail({ to, title, room, date, start, end, organizer }) {
  if (!process.env.EMAIL_USER || !to) return;
  try {
    await transporter.sendMail({
      from:    `"SmartRoom Scheduler" <${process.env.EMAIL_USER}>`,
      to,
      subject: `✅ Booking Confirmed: ${title}`,
      html: `
        <div style="font-family:sans-serif;max-width:500px;margin:auto;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden">
          <div style="background:#0a0c10;padding:24px 28px">
            <h2 style="color:#4fffb0;margin:0">SmartRoom</h2>
          </div>
          <div style="padding:28px">
            <h3 style="margin-top:0">Booking Confirmed 🎉</h3>
            <table style="width:100%;border-collapse:collapse;font-size:14px">
              <tr><td style="padding:8px 0;color:#6b7280;width:40%">Meeting</td><td><strong>${title}</strong></td></tr>
              <tr><td style="padding:8px 0;color:#6b7280">Room</td><td>${room}</td></tr>
              <tr><td style="padding:8px 0;color:#6b7280">Date</td><td>${date}</td></tr>
              <tr><td style="padding:8px 0;color:#6b7280">Time</td><td>${start} – ${end}</td></tr>
              <tr><td style="padding:8px 0;color:#6b7280">Organizer</td><td>${organizer}</td></tr>
            </table>
            <p style="font-size:12px;color:#9ca3af;margin-top:24px">This is an automated message from SmartRoom Scheduler.</p>
          </div>
        </div>`,
    });
  } catch (err) {
    console.error('Email error:', err.message);
  }
}

async function sendReminderEmail({ to, title, room, date, start }) {
  if (!process.env.EMAIL_USER || !to) return;
  try {
    await transporter.sendMail({
      from:    `"SmartRoom Scheduler" <${process.env.EMAIL_USER}>`,
      to,
      subject: `⏰ Reminder: ${title} in 30 minutes`,
      html: `<p>Your meeting <strong>${title}</strong> in <strong>${room}</strong> starts at ${start} on ${date}.</p>`,
    });
  } catch (err) {
    console.error('Reminder email error:', err.message);
  }
}

// ── HELPERS ───────────────────────────────────────────────────
function advanceDate(dateStr, frequency) {
  const d = new Date(dateStr);
  if (frequency === 'daily')    d.setDate(d.getDate() + 1);
  if (frequency === 'weekly')   d.setDate(d.getDate() + 7);
  if (frequency === 'biweekly') d.setDate(d.getDate() + 14);
  if (frequency === 'monthly')  d.setMonth(d.getMonth() + 1);
  return d.toISOString().split('T')[0];
}

function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

async function checkConflict(room, date, start, end, excludeId = null) {
  const query = { room, date, status: { $ne: 'cancelled' } };
  if (excludeId) query._id = { $ne: excludeId };
  const existing = await Booking.find(query);
  return existing.find(b => {
    const bStart = timeToMinutes(b.start);
    const bEnd   = timeToMinutes(b.end);
    const nStart = timeToMinutes(start);
    const nEnd   = timeToMinutes(end);
    return !(nEnd <= bStart || nStart >= bEnd);
  });
}

// ── ROUTES: ROOMS ─────────────────────────────────────────────
app.get('/api/rooms', async (req, res) => {
  try {
    const { status, type } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (type)   filter.type   = type;
    const rooms = await Room.find(filter).sort('name');
    res.json({ success: true, data: rooms });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/rooms', async (req, res) => {
  try {
    const room = await Room.create(req.body);
    res.status(201).json({ success: true, data: room });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.patch('/api/rooms/:id', async (req, res) => {
  try {
    const room = await Room.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!room) return res.status(404).json({ success: false, error: 'Room not found' });
    res.json({ success: true, data: room });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.delete('/api/rooms/:id', async (req, res) => {
  try {
    const room = await Room.findByIdAndDelete(req.params.id);
    if (!room) return res.status(404).json({ success: false, error: 'Room not found' });
    res.json({ success: true, message: 'Room deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── ROUTES: BOOKINGS ──────────────────────────────────────────
app.get('/api/bookings', async (req, res) => {
  try {
    const { date, room, organizer, status } = req.query;
    const filter = {};
    if (date)      filter.date      = date;
    if (room)      filter.room      = room;
    if (organizer) filter.organizer = new RegExp(organizer, 'i');
    if (status)    filter.status    = status;

    const bookings = await Booking.find(filter).sort({ date: 1, start: 1 });
    res.json({ success: true, data: bookings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/bookings', async (req, res) => {
  try {
    const { title, room, organizer, email, date, start, end, attendees, notes, amenities, recurring } = req.body;

    // Validation
    if (!title || !room || !organizer || !date || !start || !end) {
      return res.status(400).json({ success: false, error: 'Missing required fields: title, room, organizer, date, start, end' });
    }
    if (timeToMinutes(start) >= timeToMinutes(end)) {
      return res.status(400).json({ success: false, error: 'End time must be after start time' });
    }

    // Conflict check
    const conflict = await checkConflict(room, date, start, end);
    if (conflict) {
      return res.status(409).json({ success: false, error: `Room "${room}" is already booked from ${conflict.start} to ${conflict.end} on ${date}` });
    }

    const groupId = recurring?.enabled ? `${Date.now()}-${Math.random().toString(36).slice(2,8)}` : undefined;
    const created = [];

    // Create primary booking
    const primary = await Booking.create({ title, room, organizer, email, date, start, end, attendees, notes, amenities, recurring: { ...recurring, groupId } });
    created.push(primary);

    // Create recurring instances
    if (recurring?.enabled && recurring?.until) {
      let currentDate = advanceDate(date, recurring.frequency);
      let safetyCount = 0;
      while (currentDate <= recurring.until && safetyCount < 52) {
        const hasConflict = await checkConflict(room, currentDate, start, end);
        if (!hasConflict) {
          const rec = await Booking.create({ title, room, organizer, email, date: currentDate, start, end, attendees, notes, amenities, recurring: { ...recurring, groupId } });
          created.push(rec);
        }
        currentDate = advanceDate(currentDate, recurring.frequency);
        safetyCount++;
      }
    }

    // Send confirmation email
    await sendConfirmationEmail({ to: email, title, room, date, start, end, organizer });

    res.status(201).json({ success: true, data: created, message: `${created.length} booking(s) created` });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.patch('/api/bookings/:id', async (req, res) => {
  try {
    const { room, date, start, end } = req.body;
    if (room && date && start && end) {
      const conflict = await checkConflict(room, date, start, end, req.params.id);
      if (conflict) return res.status(409).json({ success: false, error: `Conflict with existing booking: ${conflict.title}` });
    }
    const booking = await Booking.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!booking) return res.status(404).json({ success: false, error: 'Booking not found' });
    res.json({ success: true, data: booking });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.delete('/api/bookings/:id', async (req, res) => {
  try {
    const { cancelAll } = req.query;
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ success: false, error: 'Booking not found' });

    if (cancelAll === 'true' && booking.recurring?.groupId) {
      await Booking.updateMany({ 'recurring.groupId': booking.recurring.groupId }, { status: 'cancelled' });
      return res.json({ success: true, message: 'All recurring bookings cancelled' });
    }

    booking.status = 'cancelled';
    await booking.save();
    res.json({ success: true, message: 'Booking cancelled', data: booking });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── ROUTES: ANALYTICS ────────────────────────────────────────
app.get('/api/analytics', async (req, res) => {
  try {
    const now   = new Date();
    const month = now.toISOString().slice(0,7);  // YYYY-MM

    const totalRooms    = await Room.countDocuments();
    const totalBookings = await Booking.countDocuments({ status: { $ne: 'cancelled' } });
    const thisMonth     = await Booking.countDocuments({ date: { $regex: `^${month}` }, status: { $ne: 'cancelled' } });
    const cancelled     = await Booking.countDocuments({ status: 'cancelled' });

    // Room utilization: bookings per room
    const byRoom = await Booking.aggregate([
      { $match: { status: { $ne: 'cancelled' } } },
      { $group: { _id: '$room', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    // Bookings per day (last 7 days)
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const ds = d.toISOString().split('T')[0];
      const count = await Booking.countDocuments({ date: ds, status: { $ne: 'cancelled' } });
      days.push({ date: ds, count });
    }

    // Peak hours
    const byHour = await Booking.aggregate([
      { $match: { status: { $ne: 'cancelled' } } },
      { $group: { _id: { $substr: ['$start', 0, 2] }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]);

    res.json({
      success: true,
      data: {
        summary: { totalRooms, totalBookings, thisMonth, cancelled },
        byRoom,
        dailyTrend: days,
        peakHours:  byHour,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── ROUTES: ADMIN ─────────────────────────────────────────────
app.post('/api/admin/send-reminders', async (req, res) => {
  try {
    const now   = new Date();
    const in30  = new Date(now.getTime() + 30 * 60 * 1000);
    const date  = now.toISOString().split('T')[0];
    const hhmm  = in30.toTimeString().slice(0,5);

    const upcoming = await Booking.find({ date, start: hhmm, status: 'confirmed', email: { $exists: true, $ne: '' } });
    const promises  = upcoming.map(b => sendReminderEmail({ to: b.email, title: b.title, room: b.room, date: b.date, start: b.start }));
    await Promise.all(promises);

    res.json({ success: true, message: `Reminders sent for ${upcoming.length} booking(s)` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/mark-completed', async (req, res) => {
  try {
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    const dateStr   = yesterday.toISOString().split('T')[0];
    const result    = await Booking.updateMany({ date: { $lte: dateStr }, status: 'confirmed' }, { status: 'completed' });
    res.json({ success: true, message: `${result.modifiedCount} bookings marked as completed` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── HEALTH CHECK ──────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status:    'ok',
    timestamp: new Date().toISOString(),
    db:        mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
  });
});

// ── CATCH-ALL ─────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── START ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀  SmartRoom server running at http://localhost:${PORT}`);
});

module.exports = app;
