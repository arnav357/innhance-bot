const express = require("express");
const router = express.Router();
const DailyTask = require("../models/DailyTask");
const Hotel = require("../models/Hotel");
const verifyToken = require("../middleware/verifyToken");

router.get("/", (req, res) => {
  res.json({ message: "Dashboard API working" });
});

router.get("/bookings", (req, res) => {
  res.json([
    { id: 1, name: "John", status: "confirmed" },
    { id: 2, name: "Rahul", status: "pending" }
  ]);
});

// =====================================================
// GET TODAY TASKS
// =====================================================

router.get("/today", verifyToken, async (req, res) => {
  try {
    const hotelId = req.user.hotelId;

    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const end = new Date();
    end.setHours(23, 59, 59, 999);

    const tasks = await DailyTask.find({
      hotelId,
      taskDate: {
        $gte: start,
        $lte: end,
      },
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
    const { title, description, taskDate } = req.body;

    const task = await DailyTask.create({
      hotelId: req.user.hotelId,

      title,
      description,

      taskDate: taskDate || new Date()
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