const express = require("express");
const router = express.Router();
const axios = require("axios");
const OpenAI = require("openai");
const QRCode = require("qrcode");
const FormData = require("form-data");

const Hotel = require("../models/Hotel");
const Customer = require("../models/Customer");
const Chat = require("../models/Chat");
const Booking = require("../models/Booking");
const Payment = require("../models/Payment");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const sendHumanAlertEmail = require("../config/mail");
const {
  buildSystemPrompt,
  normalizePhone,
  buildUpiLink,
  buildTransactionNote,
  detectLanguage,
  looksLikeQuestion,
  detectInterruption,
  askPendingStep,
  classifyMessage,
} = require("../components/webhookFunctions");
const classifyIntent = require("../services/intentClassifier");
const { mergeBooking, getMissing } = require("../services/bookEngine");
const answerHotelQuestion = require("../services/hotelKnowledge");

// ============================================================
// PLATFORM PAYMENT CONFIG
// All customer payments go to Innhance account first
// ============================================================
const PLATFORM_UPI_ID = process.env.PLATFORM_UPI_ID || "arnav@okicici";
const PLATFORM_UPI_NAME = process.env.PLATFORM_UPI_NAME || "Arnav Prabhakar";
const IMGBB_API_KEY = process.env.IMGBB_API_KEY;

// ============================================================
// FALLBACK ROOM IMAGES (used if hotel has no images in DB)
// ============================================================
const FALLBACK_IMAGES = {
  standard:
    "https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=800",
  deluxe: "https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=800",
  suite: "https://images.unsplash.com/photo-1631049552057-403cdb8f0658?w=800",
};

// ============================================================
// WHATSAPP SEND FUNCTIONS — all accept token param
// ============================================================

function parseDDMMYYYY(str) {
  const parts = str.split(/[\/\-]/);

  if (parts.length !== 3) return null;

  let [day, month, year] = parts.map(Number);

  // convert 2-digit year
  if (year < 100) year += 2000;

  const date = new Date(year, month - 1, day);

  // strict validation
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

async function sendText(to, message, phoneNumberId, token) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: message },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      },
    );
  } catch (err) {
    console.error("❌ sendText error:", err.response?.data || err.message);
  }
}

async function sendImage(to, imageUrl, caption, phoneNumberId, token) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "image",
        image: { link: imageUrl, caption },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      },
    );
  } catch (err) {
    console.error("❌ sendImage error:", err.response?.data || err.message);
  }
}

async function sendVideo(to, videoUrl, caption, phoneNumberId, token) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "video",
        video: {
          link: videoUrl,
          caption,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      },
    );
  } catch (err) {
    console.error("❌ sendVideo error:", err.response?.data || err.message);
  }
}

async function sendButtons(to, bodyText, buttons, phoneNumberId, token) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: bodyText },
          action: {
            buttons: buttons.map((btn) => ({
              type: "reply",
              reply: { id: btn.id, title: btn.title },
            })),
          },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      },
    );
  } catch (err) {
    console.error("❌ sendButtons error:", err.response?.data || err.message);
  }
}

async function sendMainMenu(to, phoneNumberId, token, hotel) {
  const rows = [
    {
      id: "menu_book",
      title: "🛏️ Book a Room",
      description: "Reserve your perfect stay",
    },
    {
      id: "menu_rooms",
      title: "🏨 Rooms & Photos",
      description: "See all rooms with prices",
    },
  ];

  // ✅ Add banquet option only if available
  if (hotel.banquets?.length) {
    rows.push({
      id: "menu_banquet",
      title: "🎉 Banquet Facilities",
      description: "Birthday & anniversary events",
    });
  }

  // Existing human support option
  rows.push({
    id: "talk_human",
    title: "👤 Talk to Human",
    description: "Chat with our team directly",
  });

  await sendList(
    to,
    `👋 *Welcome to ${hotel.name}!*\n\nI'm Inna, your personal assistant. How can I help you today? 😊`,
    [
      {
        title: "What can we help with?",
        rows,
      },
    ],
    phoneNumberId,
    token,
  );
}

async function sendRoomMenu(to, phoneNumberId, token, hotel) {
  let rows = [];

  if (hotel.rooms?.length) {
    rows = hotel.rooms.map((room) => ({
      id: `room_custom_${room._id}`,
      title: room.name.substring(0, 24), // ✅ FIX
      description: room.plans?.length
        ? room.plans
            .map((p) => `${p.name} ₹${p.price}`)
            .join(" | ")
            .slice(0, 72)
        : `₹${room.price}/night`,
    }));
  } else {
    // Fallback default rooms
    rows = [
      {
        id: "room_standard",
        title: "🛏️ Standard Room — ₹2,500/night",
        description: "Cozy & comfortable",
      },
      {
        id: "room_deluxe",
        title: "✨ Deluxe Room — ₹4,000/night",
        description: "Spacious with city view",
      },
      {
        id: "room_suite",
        title: "👑 Suite — ₹7,500/night",
        description: "Ultimate luxury",
      },
    ];
  }

  const bodyText = hotel.rooms?.length
    ? "🏨 *Choose your room type:*\n\n✅ Please ask about amenities for each room!\n👶 Children under 12 may stay FREE — ask for details!"
    : "🏨 *Choose your room type:*\n\n✅ All rooms include FREE breakfast & WiFi!\n👶 Children under 12 stay FREE!";

  await sendList(
    to,
    bodyText,
    [{ title: "Available Rooms", rows }],
    phoneNumberId,
    token,
  );
}

async function sendRoomPhotos(to, phoneNumberId, token, hotel) {
  await sendText(
    to,
    `📸 *Here's a look at our rooms at ${hotel.name}!* 😍`,
    phoneNumberId,
    token,
  );

  if (hotel.rooms?.length) {
    for (const room of hotel.rooms) {
      const images = room.images?.length
        ? room.images.slice(0, 2) // limit to 2 images
        : [FALLBACK_IMAGES.deluxe];

      const amenityText = room.amenities?.length
        ? room.amenities.slice(0, 3).join(" • ")
        : "Contact hotel for amenities";

      const pricingText = room.plans?.length
        ? room.plans.map((p) => `${p.name}: ₹${p.price}`).join(" | ")
        : `₹${room.price}/night`;

      for (const img of images) {
        await sendImage(
          to,
          img,
          `🛏️ *${room.name}* \n ${pricingText}-${amenityText} ✅`,
          phoneNumberId,
          token,
        );
      }
    }
  } else {
    // Fallback
    await sendImage(
      to,
      FALLBACK_IMAGES.standard,
      "🛏️ *Standard Room* — Free breakfast & WiFi ✅",
      phoneNumberId,
      token,
    );
    await sendImage(
      to,
      FALLBACK_IMAGES.deluxe,
      "✨ *Deluxe Room* — Free breakfast & WiFi ✅",
      phoneNumberId,
      token,
    );
    await sendImage(
      to,
      FALLBACK_IMAGES.suite,
      "👑 *Suite* — Free breakfast & WiFi ✅",
      phoneNumberId,
      token,
    );
  }

  await sendButtons(
    to,
    "Which room would you like to book? 😊",
    [
      { id: "photo_book", title: "🛏️ Book a Room" },
      { id: "photo_ask", title: "❓ Ask a Question" },
    ],
    phoneNumberId,
    token,
  );
}

// ============================================================
// DYNAMIC UPI QR GENERATOR
// ============================================================
async function sendPaymentQR(to, phoneNumberId, token, booking, hotel) {
  try {
    const bookingRef = booking._id.toString().slice(-6).toUpperCase();
    const hotelCode =
      hotel.shortCode || hotel._id.toString().slice(-6).toUpperCase();
    const transactionNote = buildTransactionNote(hotelCode, bookingRef);
    const upiId = hotel.upiId || "prabhakararnav28@ptaxis";
    const upiName = hotel.upiName || "Arnav Prabhakar";
    const upiLink = buildUpiLink(
      booking.totalAmount,
      transactionNote,
      upiId,
      upiName,
    );

    const qrBuffer = await QRCode.toBuffer(upiLink, { width: 400, margin: 2 });

    await Payment.findOneAndUpdate(
      { bookingId: booking._id },
      {
        hotelId: hotel._id,
        hotelName: hotel.name,
        bookingId: booking._id,
        bookingRef,
        customerPhone: booking.phone,
        guestName: booking.guestName,
        amount: booking.totalAmount,
        transactionNote,
        status: "pending",
      },
      { upsert: true, returnDocument: "after" },
    );

    const form = new FormData();
    form.append("image", qrBuffer.toString("base64"));

    const imgbbRes = await axios.post(
      `https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`,
      form,
      { headers: form.getHeaders() },
    );
    const qrUrl = imgbbRes.data.data.url;

    await sendImage(
      to,
      qrUrl,
      `💳 *Pay ₹${booking.totalAmount?.toLocaleString()} to confirm your booking*\n\n` +
        `📱 Scan with GPay / PhonePe / Paytm / any UPI app\n\n` +
        `📸 After paying, please *send a screenshot* of the successful payment!`,
      phoneNumberId,
      token,
    );

    console.log(
      `✅ QR sent | Booking: ${bookingRef} | Note: ${transactionNote}`,
    );
    return transactionNote;
  } catch (err) {
    console.error("❌ sendPaymentQR error:", err.message);

    // Fallback: plain text UPI details
    const bookingRef = booking._id.toString().slice(-6).toUpperCase();
    const hotelCode =
      hotel.shortCode || hotel._id.toString().slice(-6).toUpperCase();
    const transactionNote = buildTransactionNote(hotelCode, bookingRef);

    await sendText(
      to,
      `💳 *Pay ₹${booking.totalAmount?.toLocaleString()} via UPI*\n\n` +
        `UPI ID: *${PLATFORM_UPI_ID}*\n` +
        `Name: *${PLATFORM_UPI_NAME}*\n` +
        `Amount: *₹${booking.totalAmount?.toLocaleString()}*\n` +
        `Note: *${transactionNote}* ← paste this as payment note!\n\n` +
        `📸 After paying, please *send a screenshot* of the successful payment!`,
      phoneNumberId,
      token,
    );
    return transactionNote;
  }
}

// ============================================================
// FETCH WHATSAPP MEDIA
// ============================================================
async function fetchWhatsAppMedia(mediaId, token) {
  try {
    const mediaRes = await axios.get(
      `https://graph.facebook.com/v18.0/${mediaId}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const imageRes = await axios.get(mediaRes.data.url, {
      headers: { Authorization: `Bearer ${token}` },
      responseType: "arraybuffer",
    });
    return {
      base64: Buffer.from(imageRes.data, "binary").toString("base64"),
      mimeType: imageRes.headers["content-type"] || "image/jpeg",
    };
  } catch (err) {
    console.error("❌ fetchWhatsAppMedia error:", err.message);
    return null;
  }
}

// ============================================================
// VERIFY PAYMENT SCREENSHOT WITH GPT-4o VISION
// ============================================================
async function verifyPaymentScreenshot(
  base64Image,
  mimeType,
  expectedAmount,
  hotel,
  bookingCreatedAt, // pass booking.createdAt OR payment.createdAt
) {
  try {
    const prompt = `
You are a payment verification assistant.

Examine this UPI payment screenshot carefully.

Return ONLY valid JSON:

{
  "receiverName": "exact payee name",
  "amountPaid": 1234,
  "transactionDate": "DD/MM/YYYY or null",
  "transactionTime": "HH:MM AM/PM or null",
  "transactionId": "UPI reference number or null",
  "isSuccessful": true
}

Rules:
- receiverName = exact receiver/payee visible
- amountPaid = number only
- transactionDate = visible payment date
- transactionTime = visible payment time
- transactionId = exact visible txn/ref id
- isSuccessful = true only if screenshot clearly says success/completed
- If missing, use null
- Return ONLY JSON
`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`,
                detail: "high",
              },
            },
          ],
        },
      ],
      max_tokens: 400,
      temperature: 0,
    });

    const raw = response.choices[0].message.content
      .trim()
      .replace(/```json|```/g, "");

    const data = JSON.parse(raw);

    // ------------------------------------------------
    // BASIC CHECKS
    // ------------------------------------------------
    const expectedName = hotel.upiName || PLATFORM_UPI_NAME;

    const nameMatch =
      data.receiverName &&
      data.receiverName.toLowerCase().includes(expectedName.toLowerCase());

    const amountMatch =
      Math.abs(Number(data.amountPaid) - Number(expectedAmount)) <= 1;

    const isSuccess = data.isSuccessful === true;

    // ------------------------------------------------
    // TIME VALIDATION
    // ------------------------------------------------
    let timeMatch = false;
    let transactionDateTime = null;

    if (data.transactionDate && data.transactionTime) {
      transactionDateTime = parseIndianTxnDateTime(
        data.transactionDate,
        data.transactionTime,
      );

      if (transactionDateTime) {
        const bookingTime = new Date(bookingCreatedAt);

        // screenshot payment must happen AFTER booking creation
        // allow 2 mins clock mismatch
        const minAllowed = bookingTime.getTime() - 2 * 60 * 1000;

        // payment should not be too old
        // max 24 hrs after booking
        const maxAllowed = bookingTime.getTime() + 24 * 60 * 60 * 1000;

        const txnMs = transactionDateTime.getTime();

        if (txnMs >= minAllowed && txnMs <= maxAllowed) {
          timeMatch = true;
        }
      }
    }

    // ------------------------------------------------
    // FINAL VERIFY
    // ------------------------------------------------
    const verified = nameMatch && amountMatch && isSuccess && timeMatch;

    return {
      verified,
      nameMatch,
      amountMatch,
      isSuccess,
      timeMatch,
      extracted: data,
      expectedAmount,
      bookingCreatedAt,
      transactionDateTime,
    };
  } catch (err) {
    console.error("❌ verifyPaymentScreenshot error:", err.message);

    return {
      verified: false,
      error: err.message,
    };
  }
}

// ====================================================
// HELPER FUNCTION
// ====================================================
function parseIndianTxnDateTime(dateStr, timeStr) {
  try {
    const [day, month, year] = dateStr.split("/").map(Number);

    let [time, meridian] = timeStr.split(" ");

    let [hour, minute] = time.split(":").map(Number);

    meridian = meridian?.toUpperCase();

    if (meridian === "PM" && hour !== 12) hour += 12;
    if (meridian === "AM" && hour === 12) hour = 0;

    return new Date(year, month - 1, day, hour, minute, 0);
  } catch {
    return null;
  }
}

// ============================================================
// DATABASE FUNCTIONS
// ============================================================

async function saveMessage(phone, hotelId, customerId, role, content) {
  try {
    const time = new Date().toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
    await Chat.updateOne(
      { phone, hotelId },
      {
        $setOnInsert: {
          phone,
          hotelId,
          name: "Guest " + String(phone).slice(-4),
          avatar: "G",
          // unread: 0,
        },
        $set: {
          customerId,
          lastMessage: String(content).substring(0, 120),
          time: "Just now",
        },
        $push: { messages: { role, content, time } },
        ...(role === "user" ? { $inc: { unread: 1 } } : {}),
      },
      { upsert: true },
    );
  } catch (err) {
    console.error("❌ saveMessage error:", err.message);
  }
}

async function getHistory(phone, hotelId) {
  try {
    const chat = await Chat.findOne({ phone, hotelId });
    if (!chat?.messages?.length) return [];
    return chat.messages
      .filter(
        (m) =>
          typeof m.content === "string" &&
          !m.content.startsWith("[") &&
          m.content.trim().length > 0,
      )
      .slice(-40)
      .map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      }));
  } catch (err) {
    console.error("❌ getHistory error:", err.message);
    return [];
  }
}

async function isFirstMessage(phone, hotelId) {
  try {
    const chat = await Chat.findOne({ phone, hotelId });
    return !chat?.messages?.length;
  } catch {
    return true;
  }
}

function parseDate(input) {
  const parts = input.trim().split("/");

  if (parts.length !== 3) return null;

  const [day, month, year] = parts.map(Number);

  if (!day || !month || !year) return null;

  const currentYear = new Date().getFullYear();

  // allow bookings only this year to next 5 years
  if (year < currentYear || year > currentYear + 5) return null;

  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);

  if (date < today) return null;

  return date;
}

// ============================================================
// CORE AI FUNCTION
// ============================================================
async function getSmartReply(
  phone,
  hotelId,
  customerId,
  userMessage,
  contextHint = null,
  hotel,
) {
  try {
    await saveMessage(phone, hotelId, customerId, "user", userMessage);
    const history = await getHistory(phone, hotelId);
    const language = detectLanguage(userMessage);

    const systemMessages = [
      { role: "system", content: buildSystemPrompt(hotel) },
      {
        role: "system",
        content:
          "CRITICAL RULE: Never claim a booking is confirmed, completed, reserved, saved, created, paid, or guaranteed unless backend explicitly confirms it. Never invent bookings, payment status, QR generation, or reservations.",
      },
      {
        role: "system",
        content:
          "IDENTITY REMINDER: You are Inna, the hotel receptionist. " +
          "Every message is FROM you TO the customer. " +
          "Never produce a reply that reads like the customer is speaking. " +
          'Never start with "I want to..." or any first-person guest phrasing.',
      },
      {
        role: "system",
        content: `Respond in ${language}. Stay in this language unless customer switches.`,
      },
      ...(looksLikeQuestion(userMessage)
        ? [
            {
              role: "system",
              content:
                "Customer asked a direct question. Answer it COMPLETELY first. " +
                "If we do not have something they asked about, honestly say so and mention what we DO have. " +
                "Continue booking flow only AFTER answering.",
            },
          ]
        : []),
      ...(contextHint
        ? [{ role: "system", content: `[CONTEXT: ${contextHint}]` }]
        : []),
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [...systemMessages, ...history],
      max_tokens: 600,
      temperature: 0.75,
      presence_penalty: 0.3,
      frequency_penalty: 0.3,
    });

    const reply = completion.choices[0].message.content.trim();
    await saveMessage(phone, hotelId, customerId, "assistant", reply);
    return reply;
  } catch (err) {
    console.error("❌ getSmartReply error:", err.message);
    return "Oops, I ran into a little issue! 😅 Please try again in a moment.";
  }
}

// ============================================================
// EXTRACT & SAVE BOOKING FROM CONVERSATION
// ============================================================
async function tryExtractAndSaveBooking(
  phone,
  hotelId,
  customerId,
  history,
  hotel,
) {
  try {
    const roomTypes = hotel.rooms?.length
      ? hotel.rooms.map((r) => r.name).join(" / ")
      : "Standard Room / Deluxe Room / Suite";

    const extractPrompt = `Look at this conversation and extract booking details if ALL are present.
Return ONLY a JSON object or return null if any required field is missing:
{
  "guestName": "full name",
  "checkIn": "YYYY-MM-DD",
  "checkOut": "YYYY-MM-DD",
  "roomType": "exact room type name — must be one of: ${roomTypes}",
  "numberOfGuests": 2,
  "numberOfRooms": 1,
  "adultsCount": 2,
  "childrenCount": 0
}
Return null if guestName, checkIn, checkOut, or roomType is missing.
Return ONLY valid JSON, no explanation.

Conversation:
${history.map((m) => `${m.role}: ${m.content}`).join("\n")}`;

    const extraction = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: extractPrompt }],
      max_tokens: 250,
      temperature: 0,
    });

    const raw = extraction.choices[0].message.content
      .trim()
      .replace(/```json|```/g, "");
    if (raw === "null" || !raw.startsWith("{")) return null;

    const details = JSON.parse(raw);
    if (
      !details.guestName ||
      !details.checkIn ||
      !details.checkOut ||
      !details.roomType
    )
      return null;

    // Get price from hotel's room config
    const roomConfig = hotel.rooms?.find((r) => r.name === details.roomType);
    let pricePerNight = roomConfig?.price || 2500;

    // if plans exist
    if (roomConfig?.plans?.length) {
      const selectedPlan = roomConfig.plans.find(
        (p) => p.name.toLowerCase() === details.planName?.toLowerCase(),
      );

      if (selectedPlan) {
        pricePerNight = selectedPlan.price;
      }
    }
    const nights = Math.ceil(
      (new Date(details.checkOut) - new Date(details.checkIn)) /
        (1000 * 60 * 60 * 24),
    );
    const totalAmount = pricePerNight * nights * (details.numberOfRooms || 1);

    if (nights <= 0) return null;

    const existing = await Booking.findOne({
      phone: { $in: [normalizePhone(phone), phone] },
      hotelId,
      status: "pending",
    }).sort({ createdAt: -1 });

    if (existing) {
      Object.assign(existing, {
        guestName: details.guestName,
        checkIn: new Date(details.checkIn),
        checkOut: new Date(details.checkOut),
        roomType: details.roomType,
        numberOfGuests: details.numberOfGuests,
        totalAmount,
      });
      await existing.save();
      return existing;
    }

    return await Booking.create({
      hotelId,
      customerId,
      guestName: details.guestName,
      phone: normalizePhone(phone),
      checkIn: new Date(details.checkIn),
      checkOut: new Date(details.checkOut),
      roomType: details.roomType,
      numberOfGuests: details.numberOfGuests || 1,
      totalAmount,
      status: "pending",
      source: "whatsapp",
    });
  } catch (err) {
    console.log("ℹ️ Booking extraction skipped:", err.message);
    return null;
  }
}

// ============================================================
// VERIFY WEBHOOK GET
// ============================================================
router.get("/", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log("✅ Webhook verified");
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ============================================================
// MAIN WEBHOOK POST
// ============================================================
router.post("/", async (req, res) => {
  res.sendStatus(200);

  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    if (value?.statuses || !value?.messages) return;

    const message = value.messages[0];
    const phoneNumberId = value.metadata?.phone_number_id;
    const customerPhone = message.from;
    console.log("Customer phone: ", customerPhone);
    if (customerPhone === phoneNumberId) return;

    // Skip stale messages older than 30s
    const msgTime = parseInt(message.timestamp) * 1000;
    if (Date.now() - msgTime > 180000) {
      console.log("⏩ Skipping stale message from", customerPhone);
      return;
    }

    // ── Find Hotel ────────────────────────────────────────────
    const hotel = await Hotel.findOne({ whatsappPhoneNumberId: phoneNumberId });
    if (!hotel) {
      console.log("❌ No hotel found for phoneNumberId:", phoneNumberId);
      return;
    }

    // ── Get this hotel's token (falls back to env if not set) ─
    const token = hotel.whatsappToken || process.env.WHATSAPP_TOKEN;
    if (!token) {
      console.log("❌ No WhatsApp token for hotel:", hotel.name);
      return;
    }

    // ── Find or Create Customer ───────────────────────────────
    const customer = await Customer.findOneAndUpdate(
      { phone: customerPhone, hotelId: hotel._id },
      { lastSeen: new Date() },
      { upsert: true, returnDocument: "after" },
    );

    const chat = await Chat.findOne({
      phone: customerPhone,
      hotelId: hotel._id,
    });

    const normalizedPhone = normalizePhone(customerPhone);

    // ══════════════════════════════════════════════════════════
    // HANDLER: IMAGE — Payment Screenshot
    // ══════════════════════════════════════════════════════════
    if (message.type === "image") {
      const mediaId = message.image?.id;
      if (!mediaId) {
        await sendText(
          customerPhone,
          "I couldn't read that image. Please try sending the screenshot again! 📸",
          phoneNumberId,
          token,
        );
        return;
      }

      // ✅ Find latest pending payment
      const payment = await Payment.findOne({
        customerPhone,
        hotelId: hotel._id,
        status: "pending",
      }).sort({ createdAt: -1 });

      if (!payment) {
        await sendText(
          customerPhone,
          "No pending payment found. Please request a payment QR first 😊",
          phoneNumberId,
          token,
        );
        return;
      }

      // ✅ Get booking from payment
      const booking = await Booking.findById(payment.bookingId);

      await sendText(
        customerPhone,
        "🔍 Verifying your payment screenshot, please wait...",
        phoneNumberId,
        token,
      );

      const media = await fetchWhatsAppMedia(mediaId, token);
      if (!media) {
        await sendText(
          customerPhone,
          "Sorry, I couldn't download your screenshot. Please try again! 📸",
          phoneNumberId,
          token,
        );
        return;
      }

      const result = await verifyPaymentScreenshot(
        media.base64,
        media.mimeType,
        payment.amount,
        hotel,
        payment.createdAt,
      );
      console.log("💳 Verification result:", JSON.stringify(result));

      // Prevent duplicate verification
      if (payment.status === "verified") {
        await sendText(
          customerPhone,
          "Payment already verified for this booking 😊",
          phoneNumberId,
          token,
        );
        return;
      }

      payment.transactionId = result.extracted?.transactionId || null;
      payment.paidAt = result.extracted?.transactionDate || null;
      payment.screenshotVerified = result.verified;
      payment.status = result.verified ? "verified" : "failed";

      await payment.save();

      if (result.verified) {
        // booking.status = "confirmed";
        // await booking.save();

        await Chat.findOneAndUpdate(
          { phone: customerPhone, hotelId: hotel._id },
          { status: "booked" },
        );

        const nights = Math.ceil(
          (new Date(booking.checkOut) - new Date(booking.checkIn)) /
            (1000 * 60 * 60 * 24),
        );
        const payment = await Payment.findOne({ bookingId: booking._id });

        const confirmMsg = `🎉 *Payment Verified & Booking Confirmed!*

✅ *Name:* ${booking.guestName}
🛏️ *Room:* ${booking.roomType}
${booking.planName ? `🍽️ *Plan:* ${booking.planName}\n` : ""}
📅 *Check-in:* ${new Date(booking.checkIn).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
📅 *Check-out:* ${new Date(booking.checkOut).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
🌙 *Nights:* ${nights}
👥 *Guests:* ${booking.numberOfGuests}
💰 *Amount Paid:* ₹${booking.totalAmount?.toLocaleString()}

Thank you for choosing *${hotel.name}!* 🏨
We look forward to hosting you. See you soon! 😊

_Booking ID: #${booking._id.toString().slice(-6).toUpperCase()}_
_Ref: ${payment?.transactionNote || ""}_`;

        await saveMessage(
          customerPhone,
          hotel._id,
          customer._id,
          "user",
          "[Sent: Payment screenshot]",
        );
        await saveMessage(
          customerPhone,
          hotel._id,
          customer._id,
          "assistant",
          confirmMsg,
        );
        await sendText(customerPhone, confirmMsg, phoneNumberId, token);
      } else {
        let failReason =
          "I couldn't verify the payment. Please send a clearer screenshot. 🙏";
        if (!result.isSuccess)
          failReason =
            "The screenshot doesn't show a successful payment. Please make sure payment went through and send the success screenshot. 🙏";
        else if (!result.nameMatch)
          failReason = `Payment receiver name doesn't match. Please pay to *${hotel.upiName}* and send screenshot again. 🙏`;
        else if (!result.amountMatch)
          failReason = `Amount on screenshot (₹${result.extracted?.amountPaid}) doesn't match booking total ₹${result.expectedAmount}. Please check and send correct screenshot. 🙏`;

        await saveMessage(
          customerPhone,
          hotel._id,
          customer._id,
          "user",
          "[Sent: Payment screenshot]",
        );
        await saveMessage(
          customerPhone,
          hotel._id,
          customer._id,
          "assistant",
          `❌ ${failReason}`,
        );
        await sendText(customerPhone, `❌ ${failReason}`, phoneNumberId, token);
      }
      return;
    }

    // ── Only text and interactive from here ───────────────────
    if (!["text", "interactive"].includes(message.type)) {
      await sendText(
        customerPhone,
        "Sorry, I can only process text, images and supported interactions",
        phoneNumberId,
        token,
      );
      return;
    }

    let userMessage = "";
    let interactiveId = "";

    if (message.type === "text") {
      userMessage = message.text.body.trim();
    } else if (message.type === "interactive") {
      if (message.interactive.type === "button_reply") {
        interactiveId = message.interactive.button_reply.id;
        userMessage = message.interactive.button_reply.title;
      } else if (message.interactive.type === "list_reply") {
        interactiveId = message.interactive.list_reply.id;
        userMessage = message.interactive.list_reply.title;
      }
    }

    const io = req.app.get("io");

    io.to(hotel._id.toString()).emit("refreshChats", {
      hotelId: hotel._id,
      phone: customerPhone,
    });

    if (interactiveId === "menu_banquet") {
      if (!hotel.banquets?.length) {
        await sendText(
          customerPhone,
          "Sorry, banquet facility is not available currently 😊",
          phoneNumberId,
          token,
        );
        return;
      }

      await sendText(
        customerPhone,
        "🎉 Here's a look at our banquet facilities 😊",
        phoneNumberId,
        token,
      );

      for (const banquet of hotel.banquets) {
        // Send banquet details
        await sendText(
          customerPhone,
          `🎊 *${banquet.name}*\n\n` +
            `👥 Capacity: ${banquet.capacity || "N/A"} pax\n` +
            `📝 ${banquet.description || ""}\n\n` +
            `✨ Amenities:\n${banquet.amenities?.join(" • ") || "N/A"}`,
          phoneNumberId,
          token,
        );

        // Send images
        if (banquet.images?.length) {
          for (const img of banquet.images) {
            await sendImage(
              customerPhone,
              img,
              `📸 ${banquet.name}`,
              phoneNumberId,
              token,
            );
          }
        }

        // Send videos
        if (banquet.videos?.length) {
          for (const vid of banquet.videos) {
            await sendVideo(
              customerPhone,
              vid,
              `🎥 ${banquet.name}`,
              phoneNumberId,
              token,
            );
          }
        }
      }

      await sendButtons(
        customerPhone,
        "For banquet booking, pricing and availability, please connect with our team 😊",
        [
          { id: "talk_human", title: "👤 Talk to Human" },
          { id: "menu_book", title: "🛏️ Book Room" },
        ],
        phoneNumberId,
        token,
      );

      return;
    }

    if (interactiveId === "rooms_accept") {
      const freshChat = await Chat.findOne({
        phone: customerPhone,
        hotelId: hotel._id,
      });

      if (!freshChat?.bookingFlow?.active) {
        await sendText(
          customerPhone,
          "Please start a booking first 😊",
          phoneNumberId,
          token,
        );
        return;
      }

      const data = freshChat.bookingFlow.data || {};

      const room = hotel.rooms.find(
        (r) => r.name.toLowerCase() === data.roomType?.toLowerCase(),
      );

      if (!room) {
        await sendText(
          customerPhone,
          "Selected room type not found 😊",
          phoneNumberId,
          token,
        );
        return;
      }

      const maxGuests = room.maximumGuests || 2;
      const neededRooms = Math.ceil(data.guests / maxGuests);

      await Chat.findOneAndUpdate(
        { phone: customerPhone, hotelId: hotel._id },
        {
          "bookingFlow.data.roomsCount": neededRooms,
        },
      );

      await sendText(
        customerPhone,
        `✅ Updated to ${neededRooms} rooms.`,
        phoneNumberId,
        token,
      );

      const updatedChat = await Chat.findOne({
        phone: customerPhone,
        hotelId: hotel._id,
      });

      const missing = getMissing(updatedChat.bookingFlow.data, hotel);

      if (missing === "name") {
        await sendText(
          customerPhone,
          "😊 May I know your full name?",
          phoneNumberId,
          token,
        );
        return;
      }

      // if complete, continue booking engine
      return await handleSmartBooking(
        { type: "booking", fields: {} },
        "",
        updatedChat,
        customerPhone,
        phoneNumberId,
        token,
        hotel,
        customer,
      );
    }

    if (interactiveId === "continue_bot") {
      await sendText(
        customerPhone,
        "😊 Sure, please continue. How can I help you",
        phoneNumberId,
        token,
      );
      return;
    }

    if (interactiveId === "stay_human") {
      await sendText(
        customerPhone,
        "👤 Sure 😊 Please stay connected. Our team will reply soon.",
        phoneNumberId,
        token,
      );
      return;
    }

    if (interactiveId === "talk_human") {
      await saveMessage(
        customerPhone,
        hotel._id,
        customer._id,
        "user",
        "[User]: Talk to Human",
      );

      await Chat.findOneAndUpdate(
        { phone: customerPhone, hotelId: hotel._id },
        { mode: "human" },
        { upsert: true },
      );

      await saveMessage(
        customerPhone,
        hotel._id,
        customer._id,
        "assistant",
        "👤 You're now connected to our team.",
      );

      await sendText(
        customerPhone,
        "👤 You're now connected to our team. Someone will reply shortly 😊",
        phoneNumberId,
        token,
      );

      const io = req.app.get("io");

      io.to(hotel._id.toString()).emit("human_request", {
        phone: customerPhone,
        hotelName: hotel.name,
        message: "Customer wants human support",
        time: new Date(),
      });

      await sendHumanAlertEmail(hotel, customerPhone);

      // ⏰ Auto check after 2 minutes
      setTimeout(
        async () => {
          try {
            const latestChat = await Chat.findOne({
              phone: customerPhone,
              hotelId: hotel._id,
            });

            // still human mode?
            if (!latestChat || latestChat.mode !== "human") return;

            // if no staff replied recently
            const lastMsg =
              latestChat.messages?.[latestChat.messages.length - 1];

            const staffReplied =
              lastMsg &&
              lastMsg.role === "assistant" &&
              !lastMsg.content.includes("connected to our team");

            if (!staffReplied) {
              await sendButtons(
                customerPhone,
                "👤 Our team seems busy right now.\nWould you like me to continue helping you? 😊",
                [
                  { id: "back_to_bot", title: "🤖 Back to Bot" },
                  { id: "stay_human", title: "👤 Keep Waiting" },
                ],
                phoneNumberId,
                token,
              );
            }
          } catch (err) {
            console.log("Human timeout check error:", err.message);
          }
        },
        2 * 60 * 1000, // 2 minutes wait
      );

      return;
    }

    if (interactiveId === "back_to_bot") {
      await saveMessage(
        customerPhone,
        hotel._id,
        customer._id,
        "user",
        "[User]: Back to Bot",
      );

      await Chat.findOneAndUpdate(
        { phone: customerPhone, hotelId: hotel._id },
        { mode: "bot" },
      );

      await saveMessage(
        customerPhone,
        hotel._id,
        customer._id,
        "assistant",
        "🤖 Bot resumed",
      );

      await sendText(
        customerPhone,
        "🤖 I'm back! How can I help you? 😊",
        phoneNumberId,
        token,
      );

      return;
    }

    if (chat?.mode === "human") {
      console.log("👤 Human mode active — skipping bot");

      const incomingText =
        message.text?.body ||
        message.interactive?.button_reply?.title ||
        message.interactive?.list_reply?.title ||
        "interaction";

      await saveMessage(
        customerPhone,
        hotel._id,
        customer._id,
        "user",
        "[User]: " + incomingText,
      );

      // 🔘 Always show "Back to Bot" option
      await sendButtons(
        customerPhone,
        "👤 You're chatting with our team.",
        [{ id: "back_to_bot", title: "🤖 Back to Bot" }],
        phoneNumberId,
        token,
      );
      return;
    }

    if (!userMessage) return;

    console.log(
      `📩 [${hotel.name}] [${customerPhone}] "${userMessage}" | id: "${interactiveId}"`,
    );

    let messageForIntent = userMessage;

    // get fresh chat first
    const freshChat = await Chat.findOne({
      phone: customerPhone,
      hotelId: hotel._id,
    });

    const bookingActive = freshChat?.bookingFlow?.active;
    const currentMissing = bookingActive
      ? getMissing(freshChat.bookingFlow.data || {}, hotel)
      : null;

    // // If waiting for guests and user typed only number
    // if (bookingActive && /^\d{1,2}$/.test(userMessage.trim())) {
    //   const n = userMessage.trim();

    //   if (currentMissing === "guests") {
    //     messageForIntent = `${n} guest${n === "1" ? "" : "s"}`;
    //   }

    //   if (currentMissing === "roomsCount") {
    //     messageForIntent = `${n} room${n === "1" ? "" : "s"}`;
    //   }
    // }

    let intent;

    // ROOMS COUNT deterministic
    if (bookingActive && currentMissing === "roomsCount") {
      const match = userMessage.trim().match(/^(\d{1,2})(?:\s*room[s]?)?$/i);

      if (match) {
        intent = {
          type: "booking",
          confidence: 1,
          fields: {
            roomsCount: parseInt(match[1]),
          },
        };
        console.log("Intent:", intent);
      }
    }

    // GUESTS deterministic
    if (
      !intent &&
      bookingActive &&
      currentMissing === "guests" &&
      currentMissing !== "roomsCount"
    ) {
      const match = userMessage
        .trim()
        .match(
          /^(\d{1,2})(?:\s*(guest|guests|adult|adults|people|peoples|log))?$/i,
        );

      if (match) {
        intent = {
          type: "booking",
          confidence: 1,
          fields: {
            guests: parseInt(match[1]),
          },
        };
        console.log("Intent:", intent);
      }
    }

    // fallback GPT
    if (!intent) {
      intent = await classifyIntent(messageForIntent, currentMissing);
      console.log("Intent:", intent);
    }
    // if (
    //   /human|agent|real person|baat karni|insaan|customer care/i.test(
    //     userMessage,
    //   )
    // ) {
    //   await Chat.findOneAndUpdate(
    //     { phone: customerPhone, hotelId: hotel._id },
    //     { mode: "human" },
    //     { upsert: true },
    //   );

    //   await sendText(
    //     customerPhone,
    //     "👤 Connecting you to our team... Please wait 😊",
    //     phoneNumberId,
    //     token,
    //   );

    //   return; // 🚨 VERY IMPORTANT
    // }

    // const chat = await Chat.findOne({
    //   phone: customerPhone,
    //   hotelId: hotel._id,
    // });

    const latestBooking = await Booking.findOne({
      phone: { $in: [normalizedPhone, customerPhone] },
      hotelId: hotel._id,
      status: "confirmed",
    }).sort({ createdAt: -1 });

    const pendingPayment = latestBooking
      ? await Payment.findOne({
          bookingId: latestBooking._id,
          status: "pending",
        })
      : null;

    if (
      pendingPayment &&
      message.type === "text" &&
      interactiveId !== "resend_qr"
    ) {
      // Expired?
      if (
        pendingPayment.expiresAt &&
        new Date() > new Date(pendingPayment.expiresAt)
      ) {
        pendingPayment.status = "expired";
        await pendingPayment.save();

        // Reset chat state
        await Chat.findOneAndUpdate(
          { phone: customerPhone, hotelId: hotel._id },
          {
            mode: "bot",
            status: "payment_expired",
            bookingFlow: {
              active: false,
              data: {},
            },
          },
        );

        await sendButtons(
          customerPhone,
          "⏳ Your previous booking payment has expired.\n\n✅ Your booking is still confirmed.\n\nYou can pay now, pay at desk, or start a new booking 😊",
          [
            { id: "pay_qr", title: "💳 Pay Now" },
            { id: "pay_desk", title: "🏨 Pay at Desk" },
            { id: "start_new_booking", title: "🆕 New Booking" },
          ],
          phoneNumberId,
          token,
        );

        return;
      }

      // pendingPayment.reminderCount += 1;
      // await pendingPayment.save();

      // let msg = "";

      // if (pendingPayment.reminderCount === 1) {
      //   msg = "Kindly send your payment screenshot for verification 📸";
      // } else if (pendingPayment.reminderCount === 2) {
      //   msg = "We're waiting for your payment screenshot 😊";
      // } else {
      //   msg = "Please upload screenshot to confirm your booking.";
      // }

      // await sendButtons(
      //   customerPhone,
      //   msg,
      //   [
      //     { id: "resend_qr", title: "🔁 Resend QR" },
      //     { id: "talk_human", title: "👤 Talk to Human" },
      //   ],
      //   phoneNumberId,
      //   token,
      // );
      // ✅ NON-EXPIRED CASE
      await sendButtons(
        customerPhone,
        "💳 Your booking payment is still pending.\n\nHow would you like to continue? 😊",
        [
          { id: "pay_qr", title: "💳 Pay Now" },
          { id: "pay_desk", title: "🏨 Pay at Desk" },
          { id: "start_new_booking", title: "🆕 New Booking" },
          { id: "ask_question", title: "Ask a question" },
        ],
        phoneNumberId,
        token,
      );

      return;
    }

    //     if (chat?.bookingFlow?.step) {
    //       const flow = chat.bookingFlow;

    //       // ===================================
    //       // 1. Waiting for continue confirmation
    //       // ===================================
    //       if (flow.awaitingResume) {
    //         if (/^(yes|haan|ha|yeah|sure|ok|continue)$/i.test(userMessage.trim())) {
    //           flow.awaitingResume = false;
    //           await chat.save();

    //           return await askPendingStep(
    //             flow.step,
    //             customerPhone,
    //             phoneNumberId,
    //             token,
    //           );
    //         }

    //         if (/^(no|later|cancel)$/i.test(userMessage.trim())) {
    //           flow.awaitingResume = false;
    //           await chat.save();

    //           await sendText(
    //             customerPhone,
    //             "No problem 😊 Message me anytime to continue your booking.",
    //             phoneNumberId,
    //             token,
    //           );
    //           return;
    //         }

    //         await sendText(
    //           customerPhone,
    //           "Would you like to continue your booking? 😊",
    //           phoneNumberId,
    //           token,
    //         );
    //         return;
    //       }

    //       // ===================================
    //       // 2. Detect interruption question
    //       // ===================================
    //       const cls = await classifyMessage(userMessage, flow.step);

    //       if (cls.type === "show_rooms") {
    //         flow.awaitingResume = true;
    //         await chat.save();
    //         await sendRoomPhotos(customerPhone, phoneNumberId, token, hotel);
    //         await sendText(customerPhone, "Here are the rooms images. Can I continue with my booking? 😊", phoneNumberId, token);
    //         return;
    //       }

    //       if (cls.type === "interruption_question" || cls.type === "pricing_query" || cls.type === "policy_query") {
    //         // GPT answer question + resume
    //         flow.awaitingResume = true;
    //         await chat.save();

    //         const reply = await getSmartReply(
    //           customerPhone,
    //           hotel._id,
    //           customer._id,
    //           userMessage,
    //           `
    //             Customer is in active booking flow.
    //             Current step: ${flow.step}
    //             Known data: ${JSON.stringify(flow.data)}

    //             Answer all questions warmly.
    //             Then ask if customer wants to continue booking.
    // `,
    //           hotel,
    //         );

    //         await sendText(customerPhone, reply, phoneNumberId, token);
    //         return;
    //       }

    //       if(cls.type==="human_request"){
    //         flow.awaitingResume = true;
    //         await chat.save();
    //         await sendButtons(
    //         customerPhone,
    //         "Need more help?",
    //         [
    //           { id: "talk_human", title: "👤 Talk to Human" },
    //           { id: "resume_booking", title: "🤖 Continue with Bot" },
    //         ],
    //         phoneNumberId,
    //         token,
    //       );
    //       return;
    //       }

    // //       if (isQuestion) {
    // //         flow.awaitingResume = true;
    // //         await chat.save();

    // //         const reply = await getSmartReply(
    // //           customerPhone,
    // //           hotel._id,
    // //           customer._id,
    // //           userMessage,
    // //           `
    // //             Customer is in active booking flow.
    // //             Current step: ${flow.step}
    // //             Known data: ${JSON.stringify(flow.data)}

    // //             Answer all questions warmly.
    // //             Then ask if customer wants to continue booking.
    // // `,
    // //           hotel,
    // //         );

    // //         await sendText(customerPhone, reply, phoneNumberId, token);
    // //         return;
    // //       }

    //       // ===================================
    //       // 3. Normal booking step processing
    //       // ===================================

    //       // STEP 1: NAME
    //       if (flow.step === "ask_name") {
    //         flow.data.name = userMessage;
    //         flow.step = "ask_checkin";

    //         await chat.save();

    //         await sendText(
    //           customerPhone,
    //           "Nice to meet you! 😊 What's your check-in date? (DD/MM/YYYY)",
    //           phoneNumberId,
    //           token,
    //         );
    //         return;
    //       }

    //       // STEP 2: CHECK-IN
    //       if (flow.step === "ask_checkin") {
    //         const checkIn = parseDate(userMessage);

    //         if (!checkIn) {
    //           await sendText(
    //             customerPhone,
    //             "Please enter a valid date 😊",
    //             phoneNumberId,
    //             token,
    //           );
    //           return;
    //         }

    //         flow.data.checkIn = checkIn.toISOString();
    //         flow.step = "ask_checkout";

    //         await chat.save();

    //         await sendText(
    //           customerPhone,
    //           "Got it 👍 Now your check-out date?",
    //           phoneNumberId,
    //           token,
    //         );
    //         return;
    //       }

    //       // STEP 3: CHECK-OUT
    //       if (flow.step === "ask_checkout") {
    //         const checkOut = parseDate(userMessage);
    //         const checkIn = new Date(flow.data.checkIn);

    //         if (!checkOut) {
    //           await sendText(
    //             customerPhone,
    //             "Please enter a valid future check-out date 😊",
    //             phoneNumberId,
    //             token,
    //           );
    //           return;
    //         }

    //         if (checkOut <= checkIn) {
    //           await sendText(
    //             customerPhone,
    //             "Check-out must be after check-in 😊",
    //             phoneNumberId,
    //             token,
    //           );
    //           return;
    //         }

    //         flow.data.checkOut = checkOut.toISOString();
    //         flow.step = "ask_guests";

    //         await chat.save();

    //         await sendText(customerPhone, "How many guests?", phoneNumberId, token);
    //         return;
    //       }

    //       // STEP 4: GUESTS
    //       if (flow.step === "ask_guests") {
    //         const guests = parseInt(userMessage);

    //         if (isNaN(guests) || guests <= 0) {
    //           await sendText(
    //             customerPhone,
    //             "Please enter a valid number 😊",
    //             phoneNumberId,
    //             token,
    //           );
    //           return;
    //         }

    //         flow.data.guests = guests;
    //         flow.step = "confirm";

    //         await chat.save();

    //         const checkIn = new Date(flow.data.checkIn);
    //         const checkOut = new Date(flow.data.checkOut);

    //         const nights = Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));
    //         const room = hotel.rooms.find((r) => r.name === flow.data.roomType);

    //         if (!room) {
    //           await sendText(
    //             customerPhone,
    //             "Sorry, selected room was not found ",
    //             phoneNumberId,
    //             token,
    //           );
    //           return;
    //         }

    //         const total = room.price * nights;

    //         await sendText(
    //           customerPhone,
    //           `📋 Booking Summary:\n\n👤 ${flow.data.name}\n🛏️ ${flow.data.roomType}\n📅 ${flow.data.checkIn.toDateString()} → ${flow.data.checkOut.toDateString()}\n👥 ${guests} guests\n💰 ₹${total}\n\nType *confirm* to proceed`,
    //           phoneNumberId,
    //           token,
    //         );

    //         return;
    //       }

    //       // STEP 5: CONFIRM
    //       if (flow.step === "confirm") {
    //         if (!/confirm/i.test(userMessage)) {
    //           await sendText(
    //             customerPhone,
    //             "Please type *confirm* to proceed 😊",
    //             phoneNumberId,
    //             token,
    //           );
    //           return;
    //         }

    //         const nights = Math.ceil(
    //           (flow.data.checkOut - flow.data.checkIn) / (1000 * 60 * 60 * 24),
    //         );
    //         const room = hotel.rooms.find((r) => r.name === flow.data.roomType);
    //         if (!room) {
    //           await sendText(
    //             customerPhone,
    //             "Sorry, this room is not available 😔",
    //             phoneNumberId,
    //             token,
    //           );
    //           return;
    //         }
    //         const total = room.price * nights;

    //         await Booking.create({
    //           hotelId: hotel._id,
    //           customerId: customer._id,
    //           guestName: flow.data.name,
    //           phone: customerPhone,
    //           checkIn: flow.data.checkIn,
    //           checkOut: flow.data.checkOut,
    //           roomType: flow.data.roomType,
    //           numberOfGuests: flow.data.guests,
    //           totalAmount: total,
    //           status: "confirmed",
    //         });

    //         // ✅ UPDATE CHAT STATUS (CHANGE 3)
    //         await Chat.findOneAndUpdate(
    //           { phone: customerPhone, hotelId: hotel._id },
    //           {
    //             status: "booked",
    //             bookingFlow: { step: null, data: {} },
    //           },
    //         );

    //         await sendText(
    //           customerPhone,
    //           "🎉 Booking created! Now choose payment method.",
    //           phoneNumberId,
    //           token,
    //         );

    //         await sendButtons(
    //           customerPhone,
    //           "How would you like to pay?",
    //           [
    //             { id: "pay_qr", title: "Pay via QR" },
    //             { id: "pay_desk", title: "Pay at Desk" },
    //           ],
    //           phoneNumberId,
    //           token,
    //         );

    //         return;
    //       }
    //     }

    // ══════════════════════════════════════════════════════════
    // HANDLER 1: "paid" text → ask for screenshot
    // ══════════════════════════════════════════════════════════
    // if (
    //   /^(paid|payment done|payment complete|pay kar diya|pay ho gaya)/i.test(
    //     userMessage,
    //   )
    // ) {
    //   const booking = await Booking.findOne({
    //     phone: { $in: [normalizedPhone, customerPhone] },
    //     hotelId: hotel._id,
    //     status: "confirmed",
    //   }).sort({ createdAt: -1 });

    //   const payment = booking
    //     ? await Payment.findOne({
    //         bookingId: booking._id,
    //         status: "pending",
    //       })
    //     : null;

    //   if (booking && payment) {
    //     await saveMessage(
    //       customerPhone,
    //       hotel._id,
    //       customer._id,
    //       "user",
    //       userMessage,
    //     );

    //     const msg =
    //       `📸 Please send a *screenshot* of your successful payment so I can verify it!\n\n` +
    //       `✅ Receiver: *${PLATFORM_UPI_NAME}*\n` +
    //       `✅ Amount: ₹${booking.totalAmount?.toLocaleString()}`;

    //     await sendText(customerPhone, msg, phoneNumberId, token);
    //   } else {
    //     await sendText(
    //       customerPhone,
    //       "Please request a payment QR first before confirming payment 😊",
    //       phoneNumberId,
    //       token,
    //     );
    //   }

    //   return;
    // }

    // ══════════════════════════════════════════════════════════
    // HANDLER 2: Pay at desk
    // ══════════════════════════════════════════════════════════
    if (
      /\b(pay at desk|pay at hotel|pay on arrival|cash at hotel|paying at desk|will pay at desk|pay when i arrive|pay there|at desk|at the desk)\b/i.test(
        userMessage,
      )
    ) {
      await saveMessage(
        customerPhone,
        hotel._id,
        customer._id,
        "user",
        userMessage,
      );

      const booking = await Booking.findOne({
        phone: { $in: [normalizedPhone, customerPhone] },
        hotelId: hotel._id,
        status: "confirmed",
      }).sort({ createdAt: -1 });

      if (booking) {
        // booking.status = "confirmed";
        // await booking.save();

        const existingPayment = await Payment.findOne({
          bookingId: booking._id,
        });

        if (!existingPayment) {
          const bookingRef = booking._id.toString().slice(-6).toUpperCase();

          await Payment.create({
            hotelId: hotel._id,
            hotelName: hotel.name,
            bookingId: booking._id,
            bookingRef,
            customerPhone,
            guestName: booking.guestName,
            amount: booking.totalAmount,
            transactionNote: `HOTEL-${hotel.shortCode}-BOOK-${bookingRef}`,

            // 🔥 KEY DIFFERENCE
            status: "pending",
          });
        }

        await Chat.findOneAndUpdate(
          { phone: customerPhone, hotelId: hotel._id },
          { status: "booked" },
        );

        const nights = Math.ceil(
          (new Date(booking.checkOut) - new Date(booking.checkIn)) /
            (1000 * 60 * 60 * 24),
        );

        const confirmMsg = `✅ *Booking Confirmed — Pay at Desk!*

👤 *Name:* ${booking.guestName}
🛏️ *Room:* ${booking.roomType}
${booking.planName ? `🍽️ *Plan:* ${booking.planName}\n` : ""}
📅 *Check-in:* ${new Date(booking.checkIn).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
📅 *Check-out:* ${new Date(booking.checkOut).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
🌙 *Nights:* ${nights}
👥 *Guests:* ${booking.numberOfGuests}
💰 *Amount Due:* ₹${booking.totalAmount?.toLocaleString()} _(payable at hotel)_

Thank you for choosing *${hotel.name}!* 🏨
Please carry a valid ID at check-in. See you soon! 😊

_Booking ID: #${booking._id.toString().slice(-6).toUpperCase()}_`;

        await saveMessage(
          customerPhone,
          hotel._id,
          customer._id,
          "assistant",
          confirmMsg,
        );
        await sendText(customerPhone, confirmMsg, phoneNumberId, token);
      } else {
        const reply = await getSmartReply(
          customerPhone,
          hotel._id,
          customer._id,
          userMessage,
          "Customer wants to pay at desk but no pending booking found. Ask them to complete booking first.",
          hotel,
        );
        await sendText(customerPhone, reply, phoneNumberId, token);
      }
      return;
    }

    // ══════════════════════════════════════════════════════════
    // HANDLER 3: First message / Greeting → Main Menu
    // ══════════════════════════════════════════════════════════
    const firstTime = await isFirstMessage(customerPhone, hotel._id);
    const isGreeting =
      /^(hi|hii|hiii|hello|hey|helo|hola|good morning|good evening|good afternoon|namaste|namaskar|start|menu)\b/i.test(
        userMessage,
      );
    const isMenuRequest =
      /^(menu|main menu|start|help|options|back to menu)\b/i.test(userMessage);

    if ((firstTime && isGreeting) || isMenuRequest) {
      await saveMessage(
        customerPhone,
        hotel._id,
        customer._id,
        "user",
        userMessage,
      );
      await sendMainMenu(customerPhone, phoneNumberId, token, hotel);
      await saveMessage(
        customerPhone,
        hotel._id,
        customer._id,
        "assistant",
        "[Sent: Main Menu]",
      );
      return;
    }

    // ══════════════════════════════════════════════════════════
    // HANDLER 4: Interactive menu selections
    // ══════════════════════════════════════════════════════════
    if (interactiveId === "menu_rooms") {
      await saveMessage(
        customerPhone,
        hotel._id,
        customer._id,
        "user",
        "I want to see the rooms",
      );
      await sendRoomPhotos(customerPhone, phoneNumberId, token, hotel);
      await saveMessage(
        customerPhone,
        hotel._id,
        customer._id,
        "assistant",
        "[Sent: Room photos]",
      );
      return;
    }

    if (interactiveId === "menu_book" || interactiveId === "photo_book") {
      await saveMessage(
        customerPhone,
        hotel._id,
        customer._id,
        "user",
        "I want to book a room",
      );

      // 🔍 Get latest booking
      const latestBooking = await Booking.findOne({
        phone: { $in: [normalizedPhone, customerPhone] },
        hotelId: hotel._id,
      }).sort({ createdAt: -1 });

      let payment = null;

      if (latestBooking) {
        payment = await Payment.findOne({
          bookingId: latestBooking._id,
        }).sort({ createdAt: -1 });
      }

      // =====================================================
      // ✅ SCENARIO B1 → booking incomplete
      // =====================================================
      if (latestBooking && latestBooking.status === "pending") {
        await sendButtons(
          customerPhone,
          "😊 You already have an unfinished booking.\n\nWould you like to continue or start a new one?",
          [
            { id: "continue_old_booking", title: "📌 Continue" },
            { id: "start_new_booking", title: "🆕 Start New" },
          ],
          phoneNumberId,
          token,
        );

        return;
      }

      // =====================================================
      // ✅ SCENARIO B2 → booking confirmed but payment pending
      // =====================================================
      if (
        latestBooking &&
        latestBooking.status === "confirmed" &&
        payment &&
        ["pending", "failed"].includes(payment.status)
      ) {
        await sendButtons(
          customerPhone,
          "😊 You already have a booking with pending payment.\n\nWould you like to pay now, pay at desk, or start a new booking?",
          [
            { id: "pay_qr", title: "💳 Pay Now" },
            { id: "pay_desk", title: "🏨 Pay at Desk" },
            { id: "start_new_booking", title: "🆕 New Booking" },
          ],
          phoneNumberId,
          token,
        );

        return;
      }

      // =====================================================
      // ✅ SCENARIO A → old booking completed / already paid
      // =====================================================
      if (latestBooking) {
        const isPaid = payment && payment.status === "verified";

        if (
          latestBooking.status === "completed" ||
          (latestBooking.status === "confirmed" && isPaid)
        ) {
          await sendButtons(
            customerPhone,
            "😊 You already had a booking with us earlier.\n\nWould you like to create a fresh new booking or ask a question?",
            [
              { id: "fresh_booking", title: "🆕 New Booking" },
              { id: "ask_question", title: "❓ Ask Question" },
            ],
            phoneNumberId,
            token,
          );

          return;
        }
      }

      // =====================================================
      // ✅ DEFAULT → no previous booking
      // =====================================================
      await sendRoomMenu(customerPhone, phoneNumberId, token, hotel);

      await saveMessage(
        customerPhone,
        hotel._id,
        customer._id,
        "assistant",
        "[Sent: Room selection menu]",
      );

      return;
    }

    if (interactiveId === "continue_old_booking") {
      await sendText(
        customerPhone,
        "😊 Let's continue your booking.",
        phoneNumberId,
        token,
      );

      return;
    }

    if (interactiveId === "start_new_booking") {
      await Booking.updateMany(
        {
          phone: { $in: [normalizedPhone, customerPhone] },
          hotelId: hotel._id,
          status: "pending",
        },
        { status: "cancelled" },
      );

      await Payment.updateMany(
        {
          customerPhone,
          hotelId: hotel._id,
          status: "pending",
        },
        { status: "expired" },
      );

      await Chat.findOneAndUpdate(
        { phone: customerPhone, hotelId: hotel._id },
        {
          bookingFlow: { active: false, data: {} },
          status: "booking_in_progress",
        },
      );

      await sendRoomMenu(customerPhone, phoneNumberId, token, hotel);
      return;
    }

    if (interactiveId === "fresh_booking") {
      await Chat.findOneAndUpdate(
        { phone: customerPhone, hotelId: hotel._id },
        {
          bookingFlow: { active: false, data: {} },
          status: "booking_in_progress",
        },
      );

      await sendRoomMenu(customerPhone, phoneNumberId, token, hotel);
      return;
    }

    if (interactiveId === "ask_question") {
      await sendText(
        customerPhone,
        "😊 Sure! Ask me anything about rooms, pricing, check-in, or facilities.",
        phoneNumberId,
        token,
      );

      return;
    }

    if (interactiveId === "menu_offers") {
      const reply = await getSmartReply(
        customerPhone,
        hotel._id,
        customer._id,
        "What special offers and deals do you have?",
        "Customer clicked Special Offers. Tell them about all current deals warmly.",
        hotel,
      );
      await sendText(customerPhone, reply, phoneNumberId, token);
      return;
    }

    if (interactiveId === "menu_checkin") {
      const reply = await getSmartReply(
        customerPhone,
        hotel._id,
        customer._id,
        "What are the check-in and check-out timings and cancellation policy?",
        "Customer clicked Timings & Policies. Give all timing info clearly.",
        hotel,
      );
      await sendText(customerPhone, reply, phoneNumberId, token);
      return;
    }

    if (interactiveId === "menu_contact") {
      const reply = await getSmartReply(
        customerPhone,
        hotel._id,
        customer._id,
        "How can I contact the hotel directly?",
        "Customer wants contact info. Share phone number and email warmly.",
        hotel,
      );
      await sendText(customerPhone, reply, phoneNumberId, token);
      return;
    }

    // if (interactiveId === "resume_booking") {
    //   flow.awaitingResume = false;
    //   await chat.save();

    //   return await askPendingStep(flow.step, customerPhone, phoneNumberId, token);
    // }

    // ── Room selected from menu (dynamic room IDs) ────────────
    if (interactiveId.startsWith("room_custom_")) {
      const roomId = interactiveId.replace("room_custom_", "");
      const roomConfig = hotel.rooms?.find((r) => r._id.toString() === roomId);
      const roomPriceText = roomConfig?.plans?.length
  ? roomConfig.plans
      .map((p) => `${p.name} ₹${p.price}`)
      .join(" | ")
  : `₹${roomConfig.price?.toLocaleString()}/night`;

const roomLabel = roomConfig
  ? `${roomConfig.name} (${roomPriceText})`
  : "selected room";

      if (!roomConfig) {
        await sendText(
          customerPhone,
          "Sorry, this room is not available 😔",
          phoneNumberId,
          token,
        );
        return;
      }
      await Chat.findOneAndUpdate(
        { phone: customerPhone, hotelId: hotel._id },
        {
          bookingFlow: {
            active: true,
            data: {
              roomType: roomConfig.name,
            },
          },
          status: "booking_in_progress",
        },
      );

      await sendText(
        customerPhone,
        `Great choice! 😊 You selected *${roomConfig.name}*.\n\nWhat's your full name?`,
        phoneNumberId,
        token,
      );

      return;
    }

    if (interactiveId === "resend_qr") {
      const booking = await Booking.findOne({
        phone: { $in: [normalizedPhone, customerPhone] },
        hotelId: hotel._id,
        status: "confirmed",
      }).sort({ createdAt: -1 });

      await Chat.findOneAndUpdate(
        { phone: customerPhone, hotelId: hotel._id },
        { status: "payment_pending" },
      );

      if (booking) {
        await sendPaymentQR(
          customerPhone,
          phoneNumberId,
          token,
          booking,
          hotel,
        );
      }

      return;
    }

    if (interactiveId === "pay_qr") {
      const booking = await Booking.findOne({
        phone: { $in: [normalizedPhone, customerPhone] },
        hotelId: hotel._id,
        status: "confirmed",
      }).sort({ createdAt: -1 });

      if (!booking) {
        await sendText(
          customerPhone,
          "No confirmed booking found 😊",
          phoneNumberId,
          token,
        );
        return;
      }

      let payment = await Payment.findOne({
        bookingId: booking._id,
        status: "pending",
      });

      if (!payment) {
        const bookingRef = booking._id.toString().slice(-6).toUpperCase();

        payment = await Payment.create({
          hotelId: hotel._id,
          hotelName: hotel.name,
          bookingId: booking._id,
          bookingRef,
          customerPhone,
          guestName: booking.guestName,
          amount: booking.totalAmount,
          transactionNote: `HOTEL-${hotel.shortCode}-BOOK-${bookingRef}`,
          status: "pending",
          reminderCount: 0,
          expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        });
      }

      await sendPaymentQR(customerPhone, phoneNumberId, token, booking, hotel);
      return;
    }

    // ── Fallback default room IDs ─────────────────────────────
    if (
      ["room_standard", "room_deluxe", "room_suite"].includes(interactiveId)
    ) {
      const roomLabels = {
        room_standard: "Standard Room (₹2,500/night)",
        room_deluxe: "Deluxe Room (₹4,000/night)",
        room_suite: "Suite (₹7,500/night)",
      };
      const reply = await getSmartReply(
        customerPhone,
        hotel._id,
        customer._id,
        `I'd like to book the ${roomLabels[interactiveId]}`,
        `Customer selected ${roomLabels[interactiveId]}. Start booking flow — ask for full name next. Do NOT ask room type again.`,
        hotel,
      );
      await sendText(customerPhone, reply, phoneNumberId, token);
      return;
    }

    if (interactiveId === "photo_ask") {
      const reply = await getSmartReply(
        customerPhone,
        hotel._id,
        customer._id,
        "I have a question about the hotel",
        "Customer clicked Ask a Question. Warmly invite them to ask anything.",
        hotel,
      );
      await sendText(customerPhone, reply, phoneNumberId, token);
      return;
    }

    if (message.type === "text") {
      const freshChat = await Chat.findOne({
        phone: customerPhone,
        hotelId: hotel._id,
      });

      const bookingActive =
        freshChat?.bookingFlow?.active ||
        freshChat?.status === "booking_in_progress";

      console.log("bookingActive =", bookingActive);
      console.log("status =", freshChat?.status);
      console.log("intent =", intent.type);

      // =====================================================
      // 🚨 NEW: Handle fresh booking attempt (TEXT BASED)
      // =====================================================
      if (!bookingActive && intent.type === "booking") {
        const latestBooking = await Booking.findOne({
          phone: { $in: [normalizedPhone, customerPhone] },
          hotelId: hotel._id,
        }).sort({ createdAt: -1 });

        let payment = null;

        if (latestBooking) {
          payment = await Payment.findOne({
            bookingId: latestBooking._id,
          }).sort({ createdAt: -1 });
        }

        // ----------------------------
        // Scenario B1 → unfinished booking
        // ----------------------------
        if (latestBooking && latestBooking.status === "pending") {
          console.log("Scenario B1 -> unfinished booking");
          await sendButtons(
            customerPhone,
            "😊 You already have an unfinished booking.\n\nWould you like to continue or start a new one?",
            [
              { id: "continue_old_booking", title: "📌 Continue" },
              { id: "start_new_booking", title: "🆕 Start New" },
            ],
            phoneNumberId,
            token,
          );

          return;
        }

        // ----------------------------
        // Scenario B2 → payment pending
        // ----------------------------
        if (
          latestBooking &&
          latestBooking.status === "confirmed" &&
          payment &&
          ["pending", "failed"].includes(payment.status)
        ) {
          console.log("Scenario B2 -> payment pending");
          await sendButtons(
            customerPhone,
            "😊 You already have a booking with pending payment.\n\nWould you like to pay now, pay at desk, or start a new booking?",
            [
              { id: "pay_qr", title: "💳 Pay Now" },
              { id: "pay_desk", title: "🏨 Pay at Desk" },
              { id: "start_new_booking", title: "🆕 New Booking" },
            ],
            phoneNumberId,
            token,
          );

          return;
        }

        // ----------------------------
        // Scenario A → old completed/paid booking
        // ----------------------------
        if (latestBooking) {
          const isPaid = payment && payment.status === "verified";

          if (latestBooking.status === "confirmed" && isPaid) {
            console.log("Scenario A -> old completed/paid booking");
            await sendButtons(
              customerPhone,
              "😊 You already had a booking with us earlier.\n\nWould you like to create a fresh booking or ask a question?",
              [
                { id: "fresh_booking", title: "🆕 New Booking" },
                { id: "ask_question", title: "❓ Ask Question" },
              ],
              phoneNumberId,
              token,
            );

            return;
          }
        }

        // If no previous booking → allow normal flow
      }

      if (bookingActive || intent.type === "booking") {
        const continueWords =
          /^(yes|yep|yeah|haan|ha|hmm|ok|okay|sure|continue|go ahead|proceed)$/i;

        if (
          intent.type === "command" &&
          continueWords.test(userMessage.trim())
        ) {
          return await handleSmartBooking(
            { type: "booking", fields: {} },
            userMessage,
            freshChat,
            customerPhone,
            phoneNumberId,
            token,
            hotel,
            customer,
          );
        }

        if (intent.type === "unknown") {
          // let booking engine try first
          return await handleSmartBooking(
            intent,
            userMessage,
            freshChat,
            customerPhone,
            phoneNumberId,
            token,
            hotel,
            customer,
          );
        }

        // Human request during booking
        if (intent.type === "human") {
          await Chat.findOneAndUpdate(
            {
              phone: customerPhone,
              hotelId: hotel._id,
            },
            {
              mode: "human",
            },
          );

          await sendText(
            customerPhone,
            "👤 Connecting you with our team... please wait 😊",
            phoneNumberId,
            token,
          );

          return;
        }

        // Show rooms during booking
        if (intent.type === "show_rooms") {
          await sendRoomPhotos(customerPhone, phoneNumberId, token, hotel);

          await sendText(
            customerPhone,
            "😊 Shall we continue your booking?",
            phoneNumberId,
            token,
          );
          return;
        }

        // Hotel question during booking
        if (intent.type === "hotel_question") {
          const answer = await answerHotelQuestion(
            userMessage,
            hotel,
            customerPhone,
            customer?._id,
            freshChat?.bookingFlow,
          );

          if (answer) {
            await sendText(
              customerPhone,
              answer + "\n\n😊 Shall we continue your booking?",
              phoneNumberId,
              token,
            );
          } else {
            await sendButtons(
              customerPhone,
              "I'm not able to answer that right now 😊 Would you like to talk with our team directly?",
              [
                { id: "talk_human", title: "👤 Talk to Human" },
                { id: "menu_book", title: "🛏️ Book Room" },
              ],
              phoneNumberId,
              token,
            );
          }

          return;
        }

        // Otherwise continue booking normally
        return await handleSmartBooking(
          intent,
          userMessage,
          freshChat,
          customerPhone,
          phoneNumberId,
          token,
          hotel,
          customer,
        );
      }
    }

    if (intent.type === "unknown") {
      await sendButtons(
        customerPhone,
        "😔 Sorry, I couldn't understand that properly.\nWould you like to talk with our team?",
        [
          { id: "talk_human", title: "👤 Talk to Human" },
          { id: "continue_bot", title: "🤖 Continue with Bot" },
        ],
        phoneNumberId,
        token,
      );
      return;
    }

    // ══════════════════════════════════════════════════════════
    // HANDLER 5: Show rooms via text
    // ══════════════════════════════════════════════════════════
    if (
      /\b(show.*rooms?|rooms?.*photo|see.*rooms?|view.*rooms?|photos?|pictures?|images?)\b/i.test(
        userMessage,
      )
    ) {
      await saveMessage(
        customerPhone,
        hotel._id,
        customer._id,
        "user",
        userMessage,
      );
      await sendRoomPhotos(customerPhone, phoneNumberId, token, hotel);
      await saveMessage(
        customerPhone,
        hotel._id,
        customer._id,
        "assistant",
        "[Sent: Room photos]",
      );
      return;
    }

    // ══════════════════════════════════════════════════════════
    // HANDLER 6: Payment / QR request via text
    // ══════════════════════════════════════════════════════════
    if (
      /\b(pay|payment|qr|upi|gpay|phonepe|paytm|how.*pay|online.*pay|send.*qr|qr.*bhejo)\b/i.test(
        userMessage,
      )
    ) {
      await saveMessage(
        customerPhone,
        hotel._id,
        customer._id,
        "user",
        userMessage,
      );

      // ✅ Only confirmed booking
      const booking = await Booking.findOne({
        phone: { $in: [normalizedPhone, customerPhone] },
        hotelId: hotel._id,
        status: "confirmed",
      }).sort({ createdAt: -1 });

      if (!booking) {
        await sendText(
          customerPhone,
          "Please complete your booking first before making payment 😊",
          phoneNumberId,
          token,
        );
        return;
      }

      // ✅ Prevent duplicate payments
      const existingPayment = await Payment.findOne({
        bookingId: booking._id,
        status: "pending",
      });

      if (existingPayment) {
        await sendText(
          customerPhone,
          "Payment is already initiated for this booking 😊\nPlease complete it or send the screenshot.",
          phoneNumberId,
          token,
        );
        return;
      }

      // ✅ Create payment entry
      const bookingRef = booking._id.toString().slice(-6).toUpperCase();

      const payment = await Payment.create({
        hotelId: hotel._id,
        hotelName: hotel.name,
        bookingId: booking._id,
        bookingRef,
        customerPhone,
        guestName: booking.guestName,
        amount: booking.totalAmount,
        transactionNote: `HOTEL-${hotel.shortCode}-BOOK-${bookingRef}`,
        status: "pending",
        reminderCount: 0,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      });

      await Chat.findOneAndUpdate(
        { phone: customerPhone, hotelId: hotel._id },
        { status: "payment_pending" },
      );

      // ✅ Send QR
      const upiId = hotel.upiId;
      const upiName = hotel.upiName;
      await sendPaymentQR(customerPhone, phoneNumberId, token, booking, hotel);

      await saveMessage(
        customerPhone,
        hotel._id,
        customer._id,
        "assistant",
        "[Sent: Payment QR]",
      );

      return;
    }
    // ══════════════════════════════════════════════════════════
    // HANDLER 7: All other messages → Smart AI
    // ══════════════════════════════════════════════════════════
    const reply = await getSmartReply(
      customerPhone,
      hotel._id,
      customer._id,
      userMessage,
      null,
      hotel,
    );
    await sendText(customerPhone, reply, phoneNumberId, token);

    if (Math.random() < 0.5) {
      await sendButtons(
        customerPhone,
        "Need more help?",
        [
          { id: "talk_human", title: "👤 Talk to Human" },
          { id: "continue_bot", title: "🤖 Continue with Bot" },
        ],
        phoneNumberId,
        token,
      );
    }

    // Try to extract booking in background
    // const history = await getHistory(customerPhone, hotel._id);
    // const booking = await tryExtractAndSaveBooking(
    //   normalizedPhone,
    //   hotel._id,
    //   customer._id,
    //   history,
    //   hotel,
    // );

    // // Auto-send QR if booking summary was shown (and not pay-at-desk)
    // const lowerReply = reply.toLowerCase();
    // const isPayAtDesk =
    //   lowerReply.includes("pay at desk") || lowerReply.includes("upon arrival");
    // const bookingComplete =
    //   lowerReply.includes("booking summary") ||
    //   lowerReply.includes("total cost") ||
    //   lowerReply.includes("total amount") ||
    //   (lowerReply.includes("confirm") && lowerReply.includes("₹"));

    // if (bookingComplete && booking && !isPayAtDesk) {
    //   setTimeout(async () => {
    //     await sendPaymentQR(
    //       customerPhone,
    //       phoneNumberId,
    //       token,
    //       booking,
    //       hotel,
    //     );
    //   }, 2000);
    // }
  } catch (err) {
    console.error("❌ Webhook error:", err.message, err.stack);
  }
});

module.exports = router;

async function handleSmartBooking(
  intent,
  userMessage,
  chat,
  customerPhone,
  phoneNumberId,
  token,
  hotel,
  customer,
) {
  console.log("Handling smart booking with intent:", intent);
  const latestChat = await Chat.findOne({
    phone: customerPhone,
    hotelId: hotel._id,
  });

  let oldData = latestChat?.bookingFlow?.data || {};

  let fields = { ...intent.fields };

  // --------------------
  // SMART NAME FALLBACK
  // --------------------

  const msg = userMessage.trim();
  const currentMissing = getMissing(oldData, hotel);

  console.log("OLD DATA:", oldData);
  console.log("CURRENT MISSING:", currentMissing);
  console.log("FIELDS FROM INTENT:", fields);

  const looksLikeQuestion =
    /hai|\?|parking|lift|wifi|breakfast|price|room|available/i.test(msg);

  const looksLikeName = /^[A-Za-z]+(?:\s+[A-Za-z]+){0,3}$/.test(msg);

  if (
    Object.keys(fields).length === 0 &&
    currentMissing === "name" &&
    looksLikeName &&
    !looksLikeQuestion
  ) {
    fields.name = msg;
  }

  // --------------------
  // DATE FALLBACK
  // --------------------

  if (
    Object.keys(fields).length === 0 &&
    /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(msg)
  ) {
    fields.date = msg;
  }

  // --------------------
  // DATE MAPPING
  // --------------------

  // If classifier gives generic date

  if (fields.date) {
    const parsedDate = parseDDMMYYYY(fields.date);

    // invalid date
    if (!parsedDate) {
      await sendText(
        customerPhone,
        "📅 Please enter a valid date like 29/04/2026 😊",
        phoneNumberId,
        token,
      );
      return;
    }

    if (!oldData.checkIn) {
      fields.checkIn = parsedDate;
    } else if (!oldData.checkOut) {
      fields.checkOut = parsedDate;
    }

    delete fields.date;
  }

  // --------------------
  // ROOMS FALLBACK
  // --------------------

  if (Object.keys(fields).length === 0 && currentMissing === "roomsCount") {
    const roomMatch = msg.match(/\b(\d{1,2})\b/);

    if (roomMatch) {
      const num = parseInt(roomMatch[1]);

      if (num >= 1 && num <= 10) {
        fields.roomsCount = num;
      }
    }
  }

  // --------------------
  // GUESTS FALLBACK
  // --------------------

  if (Object.keys(fields).length === 0 && currentMissing === "guests") {
    const guestMatch = msg.match(/\b(\d{1,2,3,4,5,6,7,8,9})\b/);

    if (guestMatch) {
      const num = parseInt(guestMatch[1]);

      if (num >= 1 && num <= 20) {
        fields.guests = num;
      }
    }
  }

  let data = mergeBooking(oldData, fields);

  await Chat.findOneAndUpdate(
    { phone: customerPhone, hotelId: hotel._id },
    {
      bookingFlow: {
        active: true,
        data,
      },
      status: "booking_in_progress",
    },
  );

  const missing = getMissing(data, hotel);

  if (
    data.checkIn &&
    data.checkOut &&
    new Date(data.checkOut) <= new Date(data.checkIn)
  ) {
    await Chat.findOneAndUpdate(
      { phone: customerPhone, hotelId: hotel._id },
      {
        "bookingFlow.data.checkOut": null,
      },
    );

    await sendText(
      customerPhone,
      "📅 Check-out must be after check-in date 😊 Please enter check-out again.",
      phoneNumberId,
      token,
    );

    return;
  }

  if (missing === "name") {
    await sendText(
      customerPhone,
      "😊 May I know your full name?",
      phoneNumberId,
      token,
    );
    return;
  }

  if (missing === "checkIn") {
    await sendText(
      customerPhone,
      "📅 What is your check-in date? 😊",
      phoneNumberId,
      token,
    );
    return;
  }

  if (missing === "checkOut") {
    await sendText(
      customerPhone,
      "📅 What is your check-out date? 😊",
      phoneNumberId,
      token,
    );
    return;
  }

  if (missing === "roomsCount") {
    await sendText(
      customerPhone,
      "🏨 How many rooms would you like? 😊",
      phoneNumberId,
      token,
    );
    return;
  }

  if (missing === "guests") {
    await sendText(
      customerPhone,
      "👥 How many guests? 😊",
      phoneNumberId,
      token,
    );
    return;
  }

  if (missing === "roomType") {
    await sendRoomMenu(customerPhone, phoneNumberId, token, hotel);
    return;
  }

  if (missing === "planName") {
    const room = hotel.rooms.find(
      (r) => r.name.toLowerCase() === data.roomType.toLowerCase(),
    );

    const text = room.plans
      .map(
        (p, i) => `${i + 1}️⃣ ${p.name} — ₹${p.price}\n${p.description || ""}`,
      )
      .join("\n\n");

    await sendText(
      customerPhone,
      `🍽️ Available plans for *${room.name}*:\n\n${text}\n\nWhich plan would you like? 😊`,
      phoneNumberId,
      token,
    );

    return;
  }

  // ALL DATA COMPLETE -> CREATE BOOKING

  const existingBooking = await Booking.findOne({
    phone: { $in: [customerPhone, normalizePhone(customerPhone)] },
    hotelId: hotel._id,
    status: "confirmed",
  }).sort({ createdAt: -1 });

  if (existingBooking) {
    const createdAgo =
      Date.now() - new Date(existingBooking.createdAt).getTime();

    // within last 30 minutes
    if (createdAgo < 30 * 60 * 1000) {
      await sendText(
        customerPhone,
        "😊 Your booking is already ready. Please choose payment method.",
        phoneNumberId,
        token,
      );

      await sendButtons(
        customerPhone,
        "How would you like to pay?",
        [
          { id: "pay_qr", title: "💳 Pay QR" },
          { id: "pay_desk", title: "🏨 Pay at Desk" },
        ],
        phoneNumberId,
        token,
      );

      return;
    }
  }

  const nights =
    Math.ceil(
      (new Date(data.checkOut) - new Date(data.checkIn)) /
        (1000 * 60 * 60 * 24),
    ) || 1;

  const room = hotel.rooms.find(
    (r) => r.name.toLowerCase() === data.roomType.toLowerCase(),
  );

  const maxGuestsPerRoom = room?.maximumGuests || 2;
  const totalCapacity = maxGuestsPerRoom * data.roomsCount;

  if (data.guests > totalCapacity) {
    const neededRooms = Math.ceil(data.guests / maxGuestsPerRoom);

    await Chat.findOneAndUpdate(
      { phone: customerPhone, hotelId: hotel._id },
      {
        "bookingFlow.data.roomsCount": neededRooms,
      },
    );

    await sendButtons(
      customerPhone,
      `😊 ${data.roomType} allows up to ${maxGuestsPerRoom} guests per room.\n\nFor ${data.guests} guests, you'll need at least ${neededRooms} rooms.`,
      [
        { id: "rooms_accept", title: `✅ ${neededRooms} Rooms` },
        { id: "menu_rooms", title: "🔁 Change Room Type" },
      ],
      phoneNumberId,
      token,
    );

    return;
  }

  let pricePerNight = room?.price || 2500;

  // If plans exist, use selected plan price
  if (room?.plans?.length && data.planName) {
    const selectedPlan = room.plans.find(
      (p) => p.name.toLowerCase() === data.planName.toLowerCase(),
    );

    if (selectedPlan?.price) {
      pricePerNight = selectedPlan.price;
    }
  }

  
  // let pricePerNight = room?.price || 2500;

  // If plans exist, use selected plan price
  if (room?.plans?.length && data.planName) {
    const selectedPlan = room.plans.find(
      (p) => p.name.toLowerCase() === data.planName.toLowerCase(),
    );

    if (selectedPlan?.price) {
      pricePerNight = selectedPlan.price;
    }
  }

  const total = pricePerNight * nights * data.roomsCount;

  const booking = await Booking.create({
    hotelId: hotel._id,
    customerId: customer._id,
    guestName: data.name,
    phone: customerPhone,
    checkIn: new Date(data.checkIn),
    checkOut: new Date(data.checkOut),
    roomType: data.roomType,
    planName: data.planName,
    numberOfRooms: data.roomsCount,
    numberOfGuests: data.guests,
    totalAmount: total,
    status: "confirmed",
    source: "whatsapp",
  });

  const bookingRef = booking._id.toString().slice(-6).toUpperCase();

  await Payment.findOneAndUpdate(
    { bookingId: booking._id },
    {
      hotelId: hotel._id,
      hotelName: hotel.name,
      bookingId: booking._id,
      bookingRef,
      customerPhone,
      guestName: data.name,
      amount: total,
      transactionNote: `HOTEL-${hotel.shortCode}-BOOK-${bookingRef}`,
      status: "pending",
      reminderCount: 0,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    },
    {
      upsert: true,
      returnDocument: "after",
    },
  );

  await Chat.findOneAndUpdate(
    { phone: customerPhone, hotelId: hotel._id },
    {
      status: "awaiting_confirmation",
      bookingFlow: { active: false, data: {} },
    },
  );

  await sendText(
    customerPhone,
    `🎉 Booking Ready!

👤 ${data.name}
🛏️ ${data.roomType}
📅 ${new Date(data.checkIn).toDateString()}
📅 ${new Date(data.checkOut).toDateString()}
🏨 ${data.roomsCount} Rooms
👥 ${data.guests} Guests
💰 ₹${total}

Choose payment method 😊`,
    phoneNumberId,
    token,
  );

  await sendButtons(
    customerPhone,
    "How would you like to pay?",
    [
      { id: "pay_qr", title: "💳 Pay QR" },
      { id: "pay_desk", title: "🏨 Pay at Desk" },
    ],
    phoneNumberId,
    token,
  );
}
