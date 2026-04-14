const express = require('express');
const router = express.Router();
const Chat = require('../models/Chat'); // Import the model we just created
const verifyToken = require("../middleware/authMiddleware"); // Middleware to protect routes (optional for now)

// 1. Get all chats from Database
router.get('/', verifyToken, async (req, res) => {
  try {
    const chats = await Chat.find({
      hotelId: req.user.hotelId   // ✅ filter by hotel
    }).sort({ updatedAt: -1 });

    const formattedChats = chats.map(chat => ({
      id: chat._id,
      name: chat.name,
      phone: chat.phone,
      lastMessage: chat.lastMessage,
      time: chat.time,
      unread: chat.unread,
      status: chat.status,
      avatar: chat.avatar,
      messages: chat.messages
    }));

    res.json(formattedChats);

  } catch (error) {
    console.error("Error fetching chats:", error);
    res.status(500).json({ error: "Failed to fetch chats" });
  }
});

// 2. Mark a specific chat as read
router.post('/:id/read', verifyToken, async (req, res) => {
  try {
    const updated = await Chat.findOneAndUpdate(
      { _id: req.params.id, hotelId: req.user.hotelId }, // ✅ secure
      { unread: 0 },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ error: "Chat not found" });
    }

    res.status(200).json({ message: 'Chat marked as read' });

  } catch (error) {
    res.status(500).json({ error: "Failed to update chat" });
  }
});

// 3. Mark all chats as read
router.post('/mark-all-read', verifyToken, async (req, res) => {
  try {
    await Chat.updateMany(
      { hotelId: req.user.hotelId }, // ✅ only this hotel
      { unread: 0 }
    );

    res.status(200).json({ message: 'All chats marked as read' });

  } catch (error) {
    res.status(500).json({ error: "Failed to update all chats" });
  }
});

module.exports = router;