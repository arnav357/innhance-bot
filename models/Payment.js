const mongoose = require('mongoose');

// Stores every payment received, tied to a hotel and booking
const paymentSchema = new mongoose.Schema({

  // Which hotel this payment is for
  hotelId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Hotel', required: true },
  hotelName: { type: String, required: true },

  // Booking reference
  bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
  bookingRef: { type: String }, // short ref like "15DAB3"

  // Customer info
  customerPhone: { type: String },
  guestName:     { type: String },

  // Payment details
  amount:        { type: Number, required: true },
  currency:      { type: String, default: 'INR' },

  // The UPI transaction note that was embedded in the QR
  // Format: HOTEL-{hotelCode}-BOOK-{bookingRef}
  transactionNote: { type: String },

  // Extracted from screenshot by GPT-4o OCR
  transactionId:   { type: String },   // UPI transaction ID from screenshot
  paidAt:          { type: String },   // date extracted from screenshot
  screenshotVerified: { type: Boolean, default: false },

  // Payment status
  // pending   = QR sent, waiting for customer to pay
  // verified  = screenshot received and OCR passed
  // failed    = screenshot OCR failed
  // settled   = you have manually transferred to hotel
  
  status: {
    type:    String,
    enum:    ['pending', 'verified', 'failed', 'settled','expired'],
    default: 'pending',
  },

  // When you manually transferred money to the hotel
  settledAt:   { type: Date },
  settledNote: { type: String }, // e.g. "Transferred via NEFT on 5 Nov"
  reminderCount: { type: Number, default: 0 },
  expiresAt: Date,

}, { timestamps: true });

// Indexes for fast dashboard queries
paymentSchema.index({ hotelId: 1, status: 1 });
paymentSchema.index({ bookingRef: 1 });
paymentSchema.index({ transactionNote: 1 });

module.exports = mongoose.model('Payment', paymentSchema);