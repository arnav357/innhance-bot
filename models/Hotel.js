const mongoose = require('mongoose');

const hotelSchema = new mongoose.Schema({
  name:     { type: String, required: true },
  email:    { type: String, required: true, unique: true },
  password: { type: String, required: true },

  whatsappNumber:        { type: String },
  whatsappPhoneNumberId: { type: String, unique: true },
  whatsappToken:         { type: String },   // ← per-hotel permanent token
  shortCode:             { type: String },   // ← e.g. "14G" for payment refs

  botConfig: {
    assistantName: { type: String, default: 'Inna' },
    systemPrompt:  { type: String, required: true },
  },

  
  rooms: [
    {
      name:           { type: String },
      price:          { type: Number },
      totalRooms:     { type: Number },
      availableRooms: { type: Number },
      description:    { type: String },
      amenities:      [{ type: String }],
      image:          { type: String },
      roomNumbers: [
        {
          num:    { type: String },
          booked: { type: Boolean, default: false }
        }
      ]
    }
  ],
  upiId: { type: String },        // e.g. hotel@upi
  upiName: { type: String },      // receiver name
  images: {
    lobby:       { type: String },
    standardRoom: { type: String },
    deluxeRoom:  { type: String },
    suite:       { type: String },
  },

  plan:     { type: String, enum: ['trial', 'basic', 'pro'], default: 'trial' },
  isActive: { type: Boolean, default: true },

}, { timestamps: true });

module.exports = mongoose.model('Hotel', hotelSchema);