require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const mongoose  = require('mongoose');
const verifyToken    = require('./middleware/authMiddleware');
const bookingRoutes  = require('./routes/booking');
const roomsRoute     = require('./routes/rooms');

// ===== CONNECT TO MONGODB =====
mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('✅ MongoDB Connected');
    try {
      await mongoose.connection.syncIndexes();
      console.log('✅ MongoDB indexes synced');
    } catch (err) {
      console.log('⚠️ MongoDB index sync skipped:', err.message);
    }
  })
  .catch(err => console.log('❌ MongoDB Error:', err));

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===== ROUTES =====
app.use('/rooms',         roomsRoute);
app.use('/booking',       bookingRoutes);
app.use('/auth',          require('./routes/auth'));
app.use('/dashboard',     require('./routes/dashboard'));
app.use('/webhook',       require('./routes/webhook'));
app.use('/api/chats',     require('./routes/chatRoutes'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/payments',  require('./routes/payment'));

// ===== ADMIN: ADD HOTEL =====
// Use this to onboard every new hotel client
app.post('/admin/add-hotel', async (req, res) => {
  try {
    const bcrypt = require('bcryptjs');
    const Hotel  = require('./models/Hotel');

    const {
      hotelName,
      email,
      password,
      phone,
      whatsappPhoneNumberId,
      whatsappToken,
      shortCode,
      plan,
      systemPrompt,
    } = req.body;

    if (!hotelName || !email || !password || !whatsappPhoneNumberId || !whatsappToken) {
      return res.status(400).json({
        error: 'Missing required fields: hotelName, email, password, whatsappPhoneNumberId, whatsappToken'
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const hotel = await Hotel.create({
      name:                  hotelName,
      email,
      password:              hashedPassword,
      whatsappNumber:        phone,
      whatsappPhoneNumberId,
      whatsappToken,
      shortCode:             shortCode || hotelName.slice(0, 3).toUpperCase(),
      isActive:              true,
      plan:                  plan || 'trial',
      botConfig: {
        assistantName: 'Inna',
        systemPrompt:  systemPrompt || 'You are Inna, a smart hotel booking assistant.',
      },
    });

    res.json({
      success: true,
      hotelId: hotel._id,
      message: `✅ Hotel "${hotelName}" onboarded successfully!`,
    });
  } catch (err) {
    console.error('❌ add-hotel error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ===== UPDATE HOTEL TOKEN (use when token needs refresh) =====
app.post('/admin/update-token', async (req, res) => {
  try {
    const Hotel = require('./models/Hotel');
    const { whatsappPhoneNumberId, whatsappToken } = req.body;

    if (!whatsappPhoneNumberId || !whatsappToken) {
      return res.status(400).json({ error: 'Missing whatsappPhoneNumberId or whatsappToken' });
    }

    const hotel = await Hotel.findOneAndUpdate(
      { whatsappPhoneNumberId },
      { whatsappToken },
      { new: true }
    );

    if (!hotel) return res.status(404).json({ error: 'Hotel not found' });

    res.json({ success: true, message: `✅ Token updated for ${hotel.name}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/admin/update-hotel-rooms', async (req, res) => {
  try {
    const Hotel = require('./models/Hotel');
    const { whatsappPhoneNumberId, rooms } = req.body;

    const hotel = await Hotel.findOneAndUpdate(
      { whatsappPhoneNumberId },
      { rooms },
      { new: true }
    );

    if (!hotel) return res.status(404).json({ error: 'Hotel not found' });
    res.json({ success: true, message: `✅ Rooms updated for ${hotel.name}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== PROTECTED ROUTE =====
app.get('/api/protected', verifyToken, (req, res) => {
  res.json({ message: 'Protected data accessed', user: req.user });
});

app.get('/', (req, res) => res.send('🏨 Innhance Bot is running!'));


// ===== START SERVER =====
const PORT = process.env.PORT || 5000;
const http = require("http");
const { Server } = require("socket.io");

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: ["http://localhost:5173","https://innhance-hotels-dashboard.vercel.app"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true
  }
});

io.on("connection", (socket) => {

  socket.on("join_hotel_room", (hotelId) => {
    socket.join(hotelId);
    console.log("Joined hotel room:", hotelId);
  });

  socket.on("disconnect", () => {
    console.log("Disconnected:", socket.id);
  });

});

app.set("io", io);

server.listen(PORT, () => {
  console.log("Server running ");
});