const axios = require("axios");
const Chat = require("../models/Chat");
// ============================================================
// DATABASE FUNCTIONS
// ============================================================

async function saveMessage(
  phone,
  hotelId,
  customerId,
  role,
  content,
  hotelTimezone = "Asia/Kolkata",
) {
  try {
    const now = new Date();

    const time = now.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: hotelTimezone,
    });

    const date = now.toLocaleDateString("en-US", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: hotelTimezone,
    });
    await Chat.updateOne(
      { phone, hotelId },
      {
        $setOnInsert: {
          phone,
          hotelId,
          name: "Guest " + String(phone).slice(-4),
          avatar: "G",
          // unread: 0,
        },
        $set: {
          customerId,

          lastMessage: String(content).substring(0, 120),

          // formatted hotel-local time
          time,

          // formatted hotel-local date
          lastMessageDate: date,

          // actual UTC timestamp
          lastMessageTimestamp: now,
        },
        $push: {
          messages: {
            role,
            content,

            // formatted hotel-local
            time,
            date,

            // actual UTC timestamp
            timestamp: now,
          },
        },
        ...(role === "user" ? { $inc: { unread: 1 } } : {}),
      },
      { upsert: true },
    );
  } catch (err) {
    console.error("❌ saveMessage error:", err.message);
  }
}

async function getHistory(phone, hotelId) {
  try {
    const chat = await Chat.findOne({ phone, hotelId });
    if (!chat?.messages?.length) return [];
    return chat.messages
      .filter(
        (m) =>
          typeof m.content === "string" &&
          !m.content.startsWith("[") &&
          m.content.trim().length > 0,
      )
      .slice(-40)
      .map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      }));
  } catch (err) {
    console.error("❌ getHistory error:", err.message);
    return [];
  }
}

async function isFirstMessage(phone, hotelId) {
  try {
    const chat = await Chat.findOne({ phone, hotelId });
    return !chat?.messages?.length;
  } catch {
    return true;
  }
}

module.exports = {
  saveMessage,
  getHistory,
  isFirstMessage,
};