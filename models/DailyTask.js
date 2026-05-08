const mongoose = require("mongoose");

const dailyTaskSchema = new mongoose.Schema(
  {
    hotelId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Hotel",
      required: true,
    },

    title: {
      type: String,
      required: true,
      trim: true,
    },

    description: {
      type: String,
      default: "",
      trim: true,
    },

    taskDate: {
      type: Date,
      required: true,
    },

    completed: {
      type: Boolean,
      default: false,
    }
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("DailyTask", dailyTaskSchema);