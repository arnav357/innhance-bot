const express = require("express");
const router = express.Router();
const Hotel = require("../models/Hotel"); // Ensure this path points to your Mongoose schema!
const verifyToken = require("../middleware/authMiddleware"); // Middleware to protect routes (optional for now)

// Helper function: Finds your demo hotel (or creates one if your DB is totally empty)
async function getHotel() {
  let hotel = await Hotel.findOne();
  if (!hotel) {
    hotel = new Hotel({
      name: "Demo Hotel",
      email: "demo@innhance.com",
      password: "123", // Note: Add proper hashing later
      botConfig: { systemPrompt: "Default Prompt" }
    });
    await hotel.save();
  }
  return hotel;
}

// GET: Fetch all rooms
router.get("/all",verifyToken, async (req, res) => {
  try {
    const hotel = await Hotel.findById(req.user.hotelId);
    res.json({ rooms: hotel.rooms });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST: Add a new room
router.post("/add",verifyToken, async (req, res) => {
  try {
    const hotel = await Hotel.findById(req.user.hotelId);

    // Add the new room sent from the React frontend into the array
    hotel.rooms.push(req.body); 
    await hotel.save(); 
    
    res.status(200).json({ message: "Room added successfully", rooms: hotel.rooms });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT: Edit an existing room (Also handles toggling the 'Booked/Available' grid)
router.put("/:roomId",verifyToken, async (req, res) => {
  try {
    const hotel = await Hotel.findById(req.user.hotelId);

    // Find the specific room inside the array using the passed ID
    const roomIndex = hotel.rooms.findIndex(r => r._id.toString() === req.params.roomId);

    if (roomIndex === -1) {
      return res.status(404).json({ error: "Room not found in database" });
    }

    // Merge the old room data with the new incoming data (updating the whole object)
    hotel.rooms[roomIndex] = { ...hotel.rooms[roomIndex].toObject(), ...req.body };
    await hotel.save();

    res.status(200).json({ message: "Room updated successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE: Remove a room
router.delete("/:roomId",verifyToken, async (req, res) => {
  try {
    const hotel = await Hotel.findById(req.user.hotelId);

    // Filter out the room that matches the ID, effectively deleting it
    hotel.rooms = hotel.rooms.filter(r => r._id.toString() !== req.params.roomId);
    await hotel.save();
    
    res.status(200).json({ message: "Room deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;