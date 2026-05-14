const express = require('express');
const router = express.Router();

const Booking = require('../models/Booking');
const verifyToken = require('../middleware/verifyToken');

// Change this or fetch dynamically from Hotel model
const TOTAL_HOTEL_ROOMS = 20;

router.get('/', verifyToken, async (req, res) => {
  try {
    const { period = '6M' } = req.query;

    const now = new Date();
    let startDate = new Date();

    // ─────────────────────────────────────
    // PERIOD FILTER
    // ─────────────────────────────────────
    switch (period) {
      case '1W':
        startDate.setDate(now.getDate() - 7);
        break;

      case '1M':
        startDate.setMonth(now.getMonth() - 1);
        break;

      case '3M':
        startDate.setMonth(now.getMonth() - 3);
        break;

      case '6M':
        startDate.setMonth(now.getMonth() - 6);
        break;

      case '1Y':
        startDate.setFullYear(now.getFullYear() - 1);
        break;

      default:
        startDate.setMonth(now.getMonth() - 6);
    }

    // ─────────────────────────────────────
    // FETCH BOOKINGS
    // Ignore cancelled bookings
    // ─────────────────────────────────────
    const bookings = await Booking.find({
      hotelId: req.user.hotelId,
      status: { $ne: 'cancelled' },
      checkIn: {
        $gte: startDate.toISOString(),
        $lte: now.toISOString(),
      },
    }).sort({ createdAt: -1 });

    // ─────────────────────────────────────
    // REVENUE DATA
    // ─────────────────────────────────────
    const revenueMap = {};

    // ─────────────────────────────────────
    // ROOM DISTRIBUTION
    // ─────────────────────────────────────
    const roomMap = {};

    // ─────────────────────────────────────
    // WEEKLY DATA
    // ─────────────────────────────────────
    const currentDayIndex = now.getDay();

    const startOfWeek = new Date(now);
    const distanceToMonday =
      currentDayIndex === 0 ? 6 : currentDayIndex - 1;

    startOfWeek.setDate(now.getDate() - distanceToMonday);
    startOfWeek.setHours(0, 0, 0, 0);

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);

    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    const weeklyMap = {
      Mon: { day: 'Mon', checkins: 0, checkouts: 0, revenue: 0, isToday: currentDayIndex === 1 },
      Tue: { day: 'Tue', checkins: 0, checkouts: 0, revenue: 0, isToday: currentDayIndex === 2 },
      Wed: { day: 'Wed', checkins: 0, checkouts: 0, revenue: 0, isToday: currentDayIndex === 3 },
      Thu: { day: 'Thu', checkins: 0, checkouts: 0, revenue: 0, isToday: currentDayIndex === 4 },
      Fri: { day: 'Fri', checkins: 0, checkouts: 0, revenue: 0, isToday: currentDayIndex === 5 },
      Sat: { day: 'Sat', checkins: 0, checkouts: 0, revenue: 0, isToday: currentDayIndex === 6 },
      Sun: { day: 'Sun', checkins: 0, checkouts: 0, revenue: 0, isToday: currentDayIndex === 0 },
    };

    // ─────────────────────────────────────
    // TOP GUESTS
    // ─────────────────────────────────────
    const guestMap = {};

    // ─────────────────────────────────────
    // REPEAT GUESTS
    // ─────────────────────────────────────
    const phoneMap = {};

    // ─────────────────────────────────────
    // AVG STAY + OCCUPANCY
    // ─────────────────────────────────────
    let totalNights = 0;
    let occupiedRoomNights = 0;

    // ─────────────────────────────────────
    // PROCESS BOOKINGS
    // ─────────────────────────────────────
    bookings.forEach((b) => {
      const checkInDate = new Date(b.checkIn);
      const checkOutDate = new Date(b.checkOut);

      const amount = b.totalAmount || 0;

      // Stay duration
      const nights = Math.max(
        1,
        Math.ceil(
          (checkOutDate - checkInDate) /
            (1000 * 60 * 60 * 24)
        )
      );

      totalNights += nights;

      // Occupancy only for confirmed/completed
      if (
        b.status === 'confirmed' ||
        b.status === 'completed'
      ) {
        occupiedRoomNights +=
          nights * (b.numberOfRooms || 1);
      }

      // ─────────────────────────────────────
      // REVENUE CHART
      // ─────────────────────────────────────
      let label;

      if (period === '1W') {
        label = checkInDate.toLocaleDateString('en-IN', {
          weekday: 'short',
        });
      } else if (period === '1M') {
        label = checkInDate.getDate().toString();
      } else {
        label = checkInDate.toLocaleDateString('en-IN', {
          month: 'short',
        });
      }

      if (!revenueMap[label]) {
        revenueMap[label] = {
          month: label,
          revenue: 0,
          bookings: 0,
          occupancy: 0,
        };
      }

      revenueMap[label].revenue += amount;
      revenueMap[label].bookings += 1;

      // ─────────────────────────────────────
      // ROOM DISTRIBUTION
      // ─────────────────────────────────────
      const roomType = b.roomType || 'Standard';

      if (!roomMap[roomType]) {
        roomMap[roomType] = {
          name: roomType,
          value: 0,
          bookings: 0,
          revenue: 0,
        };
      }

      roomMap[roomType].bookings += 1;
      roomMap[roomType].revenue += amount;

      // ─────────────────────────────────────
      // WEEKLY DATA
      // ─────────────────────────────────────
      if (
        checkInDate >= startOfWeek &&
        checkInDate <= endOfWeek
      ) {
        weeklyMap[days[checkInDate.getDay()]].checkins += 1;
        weeklyMap[days[checkInDate.getDay()]].revenue += amount;
      }

      if (
        checkOutDate >= startOfWeek &&
        checkOutDate <= endOfWeek
      ) {
        weeklyMap[days[checkOutDate.getDay()]].checkouts += 1;
      }

      // ─────────────────────────────────────
      // TOP GUESTS
      // ─────────────────────────────────────
      const guestName = b.guestName || 'Guest';

      if (!guestMap[guestName]) {
        guestMap[guestName] = {
          name: guestName,
          visits: 0,
          spentNum: 0,
          room: roomType,
        };
      }

      guestMap[guestName].visits += 1;
      guestMap[guestName].spentNum += amount;

      // ─────────────────────────────────────
      // REPEAT GUESTS
      // ─────────────────────────────────────
      const phone = b.phone;

      phoneMap[phone] = (phoneMap[phone] || 0) + 1;
    });

    // ─────────────────────────────────────
    // TOTAL REVENUE
    // ─────────────────────────────────────
    const totalRevenue = bookings.reduce((sum, b) => {
      return sum + (b.totalAmount || 0);
    }, 0);

    // ─────────────────────────────────────
    // TOTAL BOOKINGS
    // ─────────────────────────────────────
    const totalBookings = bookings.length;

    // ─────────────────────────────────────
    // AVG STAY
    // ─────────────────────────────────────
    const avgStay =
      bookings.length > 0
        ? (totalNights / bookings.length).toFixed(1)
        : 0;

    // ─────────────────────────────────────
    // TOP ROOM
    // ─────────────────────────────────────
    let topRoom = 'N/A';
    let topRoomBookings = 0;

    Object.values(roomMap).forEach((room) => {
      if (room.bookings > topRoomBookings) {
        topRoom = room.name;
        topRoomBookings = room.bookings;
      }
    });

    const topRoomShare =
      totalBookings > 0
        ? Math.round(
            (topRoomBookings / totalBookings) * 100
          )
        : 0;

    // ─────────────────────────────────────
    // REPEAT GUESTS %
    // ─────────────────────────────────────
    const uniqueGuests = Object.keys(phoneMap).length;

    const repeatGuestsCount = Object.values(phoneMap)
      .filter((count) => count > 1)
      .length;

    const repeatGuestPercentage =
      uniqueGuests > 0
        ? Math.round(
            (repeatGuestsCount / uniqueGuests) * 100
          )
        : 0;

    // ─────────────────────────────────────
    // OCCUPANCY
    // ─────────────────────────────────────
    const totalDays = Math.max(
      1,
      Math.ceil(
        (now - startDate) /
          (1000 * 60 * 60 * 24)
      )
    );

    const availableRoomNights =
      TOTAL_HOTEL_ROOMS * totalDays;

    const avgOccupancy =
      availableRoomNights > 0
        ? Math.round(
            (occupiedRoomNights /
              availableRoomNights) *
              100
          )
        : 0;

    // ─────────────────────────────────────
    // ROOM DISTRIBUTION %
    // ─────────────────────────────────────
    Object.values(roomMap).forEach((room) => {
      room.value =
        totalBookings > 0
          ? Math.round(
              (room.bookings / totalBookings) * 100
            )
          : 0;
    });

    // Add colors
    const colors = [
      '#60a5fa',
      '#e8b86d',
      '#22c55e',
      '#f97316',
      '#a855f7',
    ];

    const finalRoomData = Object.values(roomMap).map(
      (room, index) => ({
        ...room,
        color: colors[index % colors.length],
      })
    );

    // ─────────────────────────────────────
    // TOP GUESTS
    // ─────────────────────────────────────
    const finalTopGuests = Object.values(guestMap)
      .sort((a, b) => b.spentNum - a.spentNum)
      .slice(0, 4)
      .map((g) => ({
        ...g,
        spent: `₹${g.spentNum.toLocaleString()}`,
      }));

    // ─────────────────────────────────────
    // FINAL DATA
    // ─────────────────────────────────────
    const revenueData = Object.values(revenueMap);

    const weeklyData = [
      weeklyMap.Mon,
      weeklyMap.Tue,
      weeklyMap.Wed,
      weeklyMap.Thu,
      weeklyMap.Fri,
      weeklyMap.Sat,
      weeklyMap.Sun,
    ];

    // ─────────────────────────────────────
    // RESPONSE
    // ─────────────────────────────────────
    res.status(200).json({
      totalRevenue,
      totalBookings,
      avgStay,
      avgOccupancy,

      topRoom,
      topRoomShare,

      repeatGuestPercentage,

      revenueData,
      roomData: finalRoomData,
      weeklyData,
      topGuests: finalTopGuests,
    });

  } catch (error) {
    console.error('Analytics Error:', error);

    res.status(500).json({
      message: 'Server error fetching analytics data',
    });
  }
});

module.exports = router;