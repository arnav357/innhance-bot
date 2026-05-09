const express = require("express");
const router = express.Router();
const DailyTask = require("../models/DailyTask");
const Hotel = require("../models/Hotel");
const Booking=require("../models/Booking");

const verifyToken = require("../middleware/authMiddleware");

router.get("/", (req, res) => {
  res.json({ message: "Dashboard API working" });
});

router.get("/bookings", (req, res) => {
  res.json([
    { id: 1, name: "John", status: "confirmed" },
    { id: 2, name: "Rahul", status: "pending" },
  ]);
});

router.get("/alerts", verifyToken, async (req, res) => {
  try {
    const hotelId = req.user.hotelId;

    const hotel = await Hotel.findById(hotelId);

    const timezone = hotel?.timezone || "UTC";

    const now = new Date();

    const hotelNow = new Date(
      now.toLocaleString("en-US", {
        timeZone: timezone,
      }),
    );

    const start = new Date(hotelNow);
    start.setHours(0, 0, 0, 0);

    const end = new Date(hotelNow);
    end.setHours(23, 59, 59, 999);

    const todayCheckIns = await Booking.find({
      hotelId,
      checkIn: {
        $gte: start,
        $lte: end,
      },
      status: {
        $ne: "cancelled",
      },
    });

    const todayCheckOuts = await Booking.find({
      hotelId,
      checkOut: {
        $gte: start,
        $lte: end,
      },
      status: {
        $ne: "cancelled",
      },
    });

    const alerts = [];

    todayCheckIns.forEach((booking) => {
      alerts.push({
        type: "checkin",
        icon: "🟢",
        title: `${booking.guestName} checking in`,
        description: `${booking.roomType} • ${booking.numberOfRooms} room(s)`,
      });
    });

    todayCheckOuts.forEach((booking) => {
      alerts.push({
        type: "checkout",
        icon: "🔵",
        title: `${booking.guestName} checking out`,
        description: `${booking.roomType} • ${booking.numberOfRooms} room(s)`,
      });
    });

    res.json({
      success: true,
      alerts,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Failed to load alerts",
    });
  }
});

// =====================================================
// GET TODAY TASKS
// =====================================================

router.get("/today", verifyToken, async (req, res) => {
  try {
    const hotelId = req.user.hotelId;

    const today = new Date().toLocaleDateString("en-CA");

    const tasks = await DailyTask.find({
      hotelId,
      taskDate: today,
      completed: false,
    }).sort({ createdAt: -1 });

    res.json({
      success: true,
      tasks,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Failed to fetch tasks",
    });
  }
});

// =====================================================
// CREATE TASK
// =====================================================

router.post("/create", verifyToken, async (req, res) => {
  try {
    const { title, description } = req.body;

    const tomorrow = new Date();

    tomorrow.setDate(tomorrow.getDate() + 1);

    const formattedDate = tomorrow.toLocaleDateString("en-CA");

    const task = await DailyTask.create({
      hotelId: req.user.hotelId,
      title,
      description,
      taskDate: formattedDate,
    });

    res.json({
      success: true,
      task,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Failed to create task",
    });
  }
});

// =====================================================
// COMPLETE TASK
// =====================================================

router.patch("/complete/:taskId", verifyToken, async (req, res) => {
  try {
    const task = await DailyTask.findOneAndUpdate(
      {
        _id: req.params.taskId,
        hotelId: req.user.hotelId,
      },
      {
        completed: true,
      },
      {
        new: true,
      },
    );

    if (!task) {
      return res.status(404).json({
        error: "Task not found",
      });
    }

    res.json({
      success: true,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Failed to complete task",
    });
  }
});

// =====================================================
// DELETE TASK
// =====================================================

router.delete("/:taskId", verifyToken, async (req, res) => {
  try {
    await DailyTask.findOneAndDelete({
      _id: req.params.taskId,
      hotelId: req.user.hotelId,
    });

    res.json({
      success: true,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Failed to delete task",
    });
  }
});

module.exports = router;
