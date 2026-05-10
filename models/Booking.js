const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
  hotelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hotel', required: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },

  
  guestName: { type: String, required: true },
  phone: { type: String, required: true },
  checkIn: { type: String, required: true },
  checkOut: { type: String, required: true },
  roomType: { type: String, required: true },
  planName: { type: String, default: null },
  numberOfRooms: { type: Number, required: true },
  numberOfGuests: { type: Number, required: true },

  totalAmount: { type: Number },

  status: {
    type: String,
    enum: ['pending', 'confirmed', 'cancelled', 'completed'],
    default: 'pending'
  },

  source: { type: String, default: 'whatsapp' }

}, { timestamps: true }); // ✅ FIX

module.exports = mongoose.model('Booking', bookingSchema);