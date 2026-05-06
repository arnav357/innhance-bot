const mongoose = require('mongoose');

const hotelSchema = new mongoose.Schema({
  name:     { type: String, required: true },
  email:    { type: String, required: true, unique: true },
  password: { type: String, required: true },
  managerName: { type: String },
  whatsappNumber:        { type: String },
  whatsappPhoneNumberId: { type: String, unique: true },
  whatsappToken:         { type: String },   // ← per-hotel permanent token
  shortCode:             { type: String },   // ← e.g. "14G" for payment refs

  botConfig: {
    assistantName: { type: String, default: 'Inna' },
    systemPrompt:  { type: String, required: true },
  },

  hotel_location:{type: String},

  rooms: [
    {
      name:           { type: String },
      price:          { type: Number },
      totalRooms:     { type: Number },
      availableRooms: { type: Number },
      maximumGuests:  { type: Number },
      description:    { type: String },
      amenities:      [{ type: String }],
      images:         [{ type: String }],
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

  restaurant: { type: String, enum: ['yes', 'no'], default: 'no' },


  policies: {
    cancellation: {
      freeCancellationWindowHours: { type: Number, default: 48 },
      penaltyWithinWindow:         { type: String,  default: '50%' },
      noShowRefund:                { type: Boolean, default: false },
    },
    pet: {
      allowed:     { type: Boolean, default: false },
      extraCharge: { type: Number,  default: 0 },
      notes:       { type: String,  default: '' },
    },
    child: {
      freeStayAgeLimit: { type: Number, default: 5 },
      extraBedCharge:   { type: Number, default: 500 },
    },
    extraBed: {
      available: { type: Boolean, default: false },
      cost:      { type: Number,  default: 0 },
    },
    smoking: {
      allowedRooms:   { type: Boolean, default: false },
      designatedArea: { type: Boolean, default: false },
      notes:          { type: String,  default: '' },
    },
    coupleFriendly: {
      unmarriedCouplesAllowed: { type: Boolean, default: false },
    },
    localId: {
      accepted: { type: Boolean, default: false },
    },
    earlyLateCheck: {
      earlyCheckInAvailable:  { type: Boolean, default: false },
      earlyCheckInCharge:     { type: Number,  default: 0 },
      lateCheckOutAvailable:  { type: Boolean, default: false },
      lateCheckOutCharge:     { type: Number,  default: 0 },
    },
  },

  locationDetails: {
    airportDistanceKm:    { type: Number, default: null },
    railwayDistanceKm:    { type: Number, default: null },
    busStandDistanceKm:   { type: Number, default: null },
    nearbyLandmarks:      [{ type: String }],
    touristSpots:         [{ type: String }],
    metroAccess:          { type: Boolean, default: false },
    wheelchairAccessible: { type: Boolean, default: false },
  },

  ratings: {
    overall:        { type: Number, min: 0, max: 5, default: 0 },
    cleanliness:    { type: Number, min: 0, max: 5, default: 0 },
    staff:          { type: Number, min: 0, max: 5, default: 0 },
    location:       { type: Number, min: 0, max: 5, default: 0 },
    valueForMoney:  { type: Number, min: 0, max: 5, default: 0 },
    praises:        [{ type: String }],
    complaints:     [{ type: String }],
  },

  otherDetails: { type: String, default: '' },

  plan:     { type: String, enum: ['trial', 'basic', 'pro'], default: 'trial' },
  isActive: { type: Boolean, default: true },

}, { timestamps: true });

module.exports = mongoose.model('Hotel', hotelSchema);