const express = require('express');
const router = express.Router();
const Chat = require('../models/Chat'); // Import the model we just created
const Hotel = require('../models/Hotel');
const verifyToken = require("../middleware/authMiddleware"); 
const {sendImage,sendVideo,sendText,saveMessage}=require("../routes/webhook");
const multer = require("multer");
const  uploadToCloudinary  = require("../config/cloudinary")
const upload = multer({ dest: "uploads/" });

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

/* =========================================================
4. SWITCH MODE
POST /:id/mode
body: { mode: "human" | "bot" }
========================================================= */
router.post("/:id/mode", verifyToken, async (req, res) => {
  try {
    const { mode } = req.body;

    if (!["human", "bot"].includes(mode)) {
      return res.status(400).json({
        error: "Invalid mode"
      });
    }

    const chat = await Chat.findByIdAndUpdate(
      req.params.id,
      { mode },
      { new: true }
    );

    res.json({
      success: true,
      mode: chat.mode
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// 5. MANUAL REPLY
// POST /manual-reply
// multipart/form-data

// fields:
// chatId
// message
// file(optional)


router.post(
  "/manual-reply",
  verifyToken,
  upload.single("file"),
  async (req, res) => {
    try {
      const { chatId, message } = req.body;

      const chat = await Chat.findById(chatId);
      console.log("chat id in manual reply:",chatId);
      if (!chat) {
        return res.status(404).json({ error: "Chat not found" });
      }

      const hotel = await Hotel.findById(chat.hotelId);
      console.log("hotel id in manual reply:",hotel._id);
      if (!hotel) {
        return res.status(404).json({ error: "Hotel not found" });
      }

      const phone = String(chat.phone).trim();
      const phoneNumberId = hotel.whatsappPhoneNumberId;
      const token = hotel.whatsappToken;

      let savedContent = (message || "").trim();

      // TEXT ONLY
      if (!req.file) {
        if (!savedContent) {
          return res.status(400).json({
            error: "Message required"
          });
        }

        await sendText(
          phone,
          savedContent,
          phoneNumberId,
          token
        );
      }

      // MEDIA
      else {
        const mediaUrl = await uploadToCloudinary(req.file.path);

        if (req.file.mimetype.startsWith("image")) {
          await sendImage(
            phone,
            mediaUrl,
            savedContent,
            phoneNumberId,
            token
          );

          if (!savedContent) {
            savedContent = "[Sent Image]";
          }
        }

        else if (req.file.mimetype.startsWith("video")) {
          await sendVideo(
            phone,
            mediaUrl,
            savedContent,
            phoneNumberId,
            token
          );

          if (!savedContent) {
            savedContent = "[Sent Video]";
          }
        }
      }

      // SAVE MESSAGE IN SAME CHAT
      await saveMessage(
        phone,
        chat.hotelId,   // IMPORTANT use chat.hotelId
        chat.customerId,
        "assistant",
        savedContent
      );

      res.json({
        success: true
      });

    } catch (err) {
      console.error("manual-reply error:", err);
      res.status(500).json({
        error: err.message
      });
    }
  }
);

module.exports = router;