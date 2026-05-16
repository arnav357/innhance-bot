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
  // formatted hotel-local time
  time: {
    type: String,
  },

  // formatted hotel-local date
  date: {
    type: String,
  },

  // actual UTC timestamp
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

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
    // hotel-local formatted time
    time: { type: String, default: "" },

    // hotel-local formatted date
    lastMessageDate: {
      type: String,
      default: "",
    },

    // actual UTC timestamp
    lastMessageTimestamp: {
      type: Date,
      default: Date.now,
    },
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
        "availability_in_progress",
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
        planName: String,
        checkIn: String,
        checkOut: String,
        roomsCount: Number,
        guests: Number,
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
