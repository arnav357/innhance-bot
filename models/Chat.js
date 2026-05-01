const mongoose = require("mongoose");

// Schema for individual messages
const messageSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ["user", "assistant"],
    required: true,
  },
  content: {
    type: String,
    required: true,
  },
  time: {
    type: String, // Stores time like "10:00 AM"
  },
});

// Schema for the entire conversation
const chatSchema = new mongoose.Schema(
  {
    name: { type: String, default: "New Customer" },
    phone: { type: String, required: true },
    hotelId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Hotel",
      required: true,
    },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer" },
    lastMessage: { type: String, default: "" },
    time: { type: String, default: "Just now" }, // e.g., "2 min ago" or "10:05 AM"
    unread: { type: Number, default: 0 },
    status: {
      type: String,
      enum: [
        "inquiry",
        "booking_in_progress",
        "awaiting_confirmation",
        "payment_pending",
        "payment_expired",
        "booked",
        "cancelled",
        "human_support",
      ],
      default: "inquiry",
    },
    avatar: { type: String, default: "U" },
    messages: [messageSchema],
    bookingFlow: {
      active: { type: Boolean, default: false },
      source: { type: String, default: "button" }, // button or text
      awaitingResume: { type: Boolean, default: false },
      data: {
        name: String,
        roomType: String,
        checkIn: Date,
        checkOut: Date,
        guests: Number,
        roomsCount: { type: Number, default: 1 },
      },
    },
    mode: {
      type: String,
      enum: ["bot", "human"],
      default: "bot",
    },
  },
  { timestamps: true },
);

// One chat thread per phone per hotel.
chatSchema.index({ phone: 1, hotelId: 1 }, { unique: true });

module.exports = mongoose.model("Chat", chatSchema);
