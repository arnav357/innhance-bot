const express = require("express");
const router = express.Router();

const Booking = require("../models/Booking");
const Hotel = require("../models/Hotel");
const Customer = require("../models/Customer");
const verifyToken = require("../middleware/authMiddleware"); // Middleware to protect routes (optional for now)
const Payment = require("../models/Payment");

// ===== CREATE BOOKING =====

router.post("/create", verifyToken, async (req, res) => {
  try {
    const {
      guestName,
      phone,
      checkIn,
      checkOut,
      roomType,
      numberOfGuests,
      totalAmount
    } = req.body;

    // ✅ Get correct hotel from token
    const hotel = await Hotel.findById(req.user.hotelId);

    if (!hotel) {
      return res.status(404).json({ error: "Hotel not found" });
    }

    // ✅ Find or create customer (scoped to hotel)
    let customer = await Customer.findOne({ phone, hotelId: hotel._id });

    if (!customer) {
      customer = await Customer.create({
        phone,
        hotelId: hotel._id
      });
    }

    // ✅ Create booking linked to hotel
    const booking = await Booking.create({
      hotelId: hotel._id,
      customerId: customer._id,
      guestName,
      phone,
      checkIn,
      checkOut,
      roomType,
      numberOfGuests,
      totalAmount,
      status: "pending"
    });

    return res.json({ booking });

  } catch (err) {
    console.error("Booking error:", err.message);
    return res.status(500).json({ error: "Booking failed" });
  }
});



router.get("/all", verifyToken, async (req, res) => {
  try {
    const bookings = await Booking.find({
      hotelId: req.user.hotelId
    }).sort({ createdAt: -1 });

    const bookingsWithPayment = await Promise.all(
      bookings.map(async (booking) => {
        const payment = await Payment.findOne({
          bookingId: booking._id
        });

        return {
          ...booking.toObject(),
          paymentStatus: payment ? payment.status : "unpaid"
        };
      })
    );

    res.json({ bookings: bookingsWithPayment });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch bookings" });
  }
});

// ===== CANCEL PAY AT DESK BOOKING =====
router.patch("/cancel-pay-at-desk/:id", verifyToken, async (req, res) => {
  try {
    const bookingId = req.params.id;

    // ✅ Only update booking belonging to this hotel
    const updatedBooking = await Booking.findOneAndUpdate(
      { _id: bookingId, hotelId: req.user.hotelId },
      { status: "cancelled" },
      { new: true }
    );

    if (!updatedBooking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    return res.json({
      message: "Booking cancelled successfully",
      booking: updatedBooking
    });

  } catch (err) {
    console.error("Cancellation error:", err.message);
    return res.status(500).json({ error: "Cancellation failed" });
  }
});

// ✅ EXPORT
module.exports = router;