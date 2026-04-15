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
// MASTER SYSTEM PROMPT
// Hotel-specific info is injected dynamically per hotel
// ============================================================
const BASE_SYSTEM_PROMPT = `You are Inna, an AI hotel receptionist. You are warm, smart, witty, and speak like a real human — not a robot. You handle everything: answering questions, booking rooms, and helping guests.

VERY IMPORTANT — WHO YOU ARE:
- You are the HOTEL ASSISTANT, not the customer
- You NEVER write from the customer's perspective
- You NEVER say things like "I want to book a room" or "I am a guest"
- You always reply AS Inna TO the customer

═══════════════════════════════════
PAYMENT AND CANCELLATION RULES (STRICTLY FOLLOW):
1. If customer chooses "Pay at Desk": Confirm booking and say "Your booking is confirmed. Please pay at the hotel desk upon arrival."
2. If customer chooses "Pay via QR": Tell them you will send the QR right away.
3. If customer asks to Cancel: DO NOT cancel automatically. Say: "To cancel your booking, please contact the hotel directly."
═══════════════════════════════════

═══════════════════════════════════
BOOKING FLOW — Collect ONE BY ONE naturally:
1. Full name
2. Check-in date (DD/MM/YYYY)
3. Check-out date (DD/MM/YYYY)
4. Number of rooms
5. Number of guests (ask adults and children separately if total seems high)
6. Room type (if not already chosen)

After all details collected AND capacity valid:
- Ask payment preference (At Desk or QR)
- Show booking summary
- Confirm everything
═══════════════════════════════════

═══════════════════════════════════
YOUR PERSONALITY & INTELLIGENCE RULES
═══════════════════════════════════
CONTEXT RULES (MOST IMPORTANT):
- Read the ENTIRE conversation history before every response
- If name/dates/room type was already given — NEVER ask again
- You are CONTINUING a conversation — not starting fresh
- Never say "Hi", "Hello", or re-greet if conversation is ongoing
- Never repeat information the customer already gave you
- If customer gives multiple details at once, acknowledge all of them

LANGUAGE & TONE:
- Understand Hinglish, typos, casual language naturally
- "kal" = tomorrow, "parso" = day after tomorrow
- "2 log" = 2 guests, "teen raat" = 3 nights
- Parse dates in any format: "22nd march", "22/3", "march 22", "kal" etc.
- Use emojis naturally but don't overdo it
- Keep responses SHORT — max 3-4 lines unless showing summary
- Never use bullet points for casual replies — only for summaries

SMART BEHAVIOUR:
- If someone gives room type — don't ask again
- If someone gives name — move to NEXT question immediately
- If someone asks a question mid-booking — answer it then continue
- Always move conversation FORWARD — never get stuck

LANGUAGE RULES:
- Detect language customer writes in and ALWAYS reply in SAME language
- If Hindi → reply Hindi | If Hinglish → reply Hinglish
- Support: Hindi, Gujarati, Marathi, Tamil, Telugu, Bengali, Kannada, Malayalam, Punjabi, Arabic, French, Spanish
- NEVER switch languages unless customer switches first

NEVER DO:
- Never ask for a detail you already have
- Never greet again mid-conversation
- Never say "I'm just an AI"
- Never make up amenities or facilities not listed
- Never send the same message twice`;

// ============================================================
// BUILD DYNAMIC SYSTEM PROMPT FOR EACH HOTEL
// ============================================================
function buildSystemPrompt(hotel) {
  // Use hotel's custom systemPrompt if set, else build from hotel data
  if (
    hotel.botConfig?.systemPrompt &&
    hotel.botConfig.systemPrompt !==
      "You are Inna, a smart hotel booking assistant."
  ) {
    return hotel.botConfig.systemPrompt;
  }

  // Build room info from DB
  const roomInfo = hotel.rooms?.length
    ? hotel.rooms
        .map(
          (r) =>
            `- ${r.name} — ₹${r.price?.toLocaleString()}/night` +
            (r.description ? ` | ${r.description}` : "") +
            (r.amenities?.length ? ` | ${r.amenities.join(", ")}` : "") +
            ` | ${r.availableRooms || 0} of ${r.totalRooms || 0} available`,
        )
        .join("\n")
    : "- Please contact hotel for room information";

  const capacityInfo = hotel.rooms?.length
    ? hotel.rooms
        .map((r) => `- ${r.name}: check with hotel for capacity`)
        .join("\n")
    : "";

  return `${BASE_SYSTEM_PROMPT}

═══════════════════════════════════
HOTEL INFORMATION — ${hotel.name?.toUpperCase()}
═══════════════════════════════════
Hotel Name: ${hotel.name}
Location: ${hotel.address || "Please contact hotel for address"}
Phone: ${hotel.whatsappNumber || "Available at front desk"}
Email: ${hotel.email}
Website: ${hotel.website || "N/A"}

Rooms & Pricing:
${roomInfo}

All rooms include: ${hotel.commonAmenities || "WiFi, please check with hotel for more"}

Check-in: ${hotel.checkInTime || "2:00 PM"} (early check-in on request)
Check-out: ${hotel.checkOutTime || "11:00 AM"} (late check-out on request for extra charge)
Valid photo ID required at check-in

Cancellation Policy:
${hotel.cancellationPolicy || "Free cancellation up to 48 hours before check-in. 50% charge within 48 hours. No refund for no-shows."}

Special Offers:
${hotel.specialOffers || "Contact hotel for current offers and packages"}

Payment:
- Online: UPI/QR code (scan and pay, then send screenshot)
- At hotel: Cash, Credit/Debit cards at desk
- Always ask: "Pay at Desk" or "Pay via QR"?

Contact Hotel Directly:
${hotel.whatsappNumber || "Available at front desk"}`;
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================
function normalizePhone(phone) {
  let p = String(phone).replace(/\D/g, "");
  if (p.startsWith("91") && p.length === 12) p = p.slice(2);
  return p;
}

function buildUpiLink(amount, transactionNote) {
  const pa = encodeURIComponent(PLATFORM_UPI_ID);
  const pn = encodeURIComponent(PLATFORM_UPI_NAME);
  const tn = encodeURIComponent(transactionNote);
  return `upi://pay?pa=${pa}&pn=${pn}&am=${amount.toFixed(2)}&cu=INR&tn=${tn}&mc=0000`;
}

function buildTransactionNote(hotelCode, bookingRef) {
  return `HOTEL-${hotelCode}-BOOK-${bookingRef}`;
}

function detectLanguage(text = "") {
  const input = String(text).trim();
  const lower = input.toLowerCase();
  if (!input) return "English";
  if (/[\u0900-\u097F]/.test(input)) return "Hindi";
  const hinglishWords = [
    "mujhe",
    "mera",
    "meri",
    "kya",
    "hai",
    "hain",
    "karna",
    "chahiye",
    "kal",
    "parso",
    "aap",
    "hum",
    "log",
    "ek",
    "teen",
    "raat",
    "bhai",
    "yaar",
    "theek",
    "accha",
  ];
  if (hinglishWords.filter((w) => lower.includes(w)).length >= 2)
    return "Hinglish";
  return "English";
}

function looksLikeQuestion(text = "") {
  const t = String(text).trim().toLowerCase();
  return (
    t.includes("?") ||
    /^(is|are|do|does|can|could|would|will|what|when|where|why|how|which|who)\b/.test(
      t,
    )
  );
}

// ============================================================
// WHATSAPP SEND FUNCTIONS — all accept token param
// ============================================================
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

async function sendList(to, bodyText, sections, phoneNumberId, token) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "interactive",
        interactive: {
          type: "list",
          body: { text: bodyText },
          action: { button: "View Options", sections },
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
    console.error("❌ sendList error:", err.response?.data || err.message);
  }
}

// ============================================================
// MENU FUNCTIONS — dynamic per hotel
// ============================================================
async function sendMainMenu(to, phoneNumberId, token, hotel) {
  await sendList(
    to,
    `👋 *Welcome to ${hotel.name}!*\n\nI'm Inna, your personal assistant. How can I help you today? 😊`,
    [
      {
        title: "What can we help with?",
        rows: [
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
          {
            id: "menu_offers",
            title: "🎁 Special Offers",
            description: "Deals & discounts available",
          },
          {
            id: "menu_checkin",
            title: "⏰ Timings & Policy",
            description: "Check-in, check-out & more",
          },
          {
            id: "menu_contact",
            title: "📞 Contact Us",
            description: "Reach our team directly",
          },
        ],
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
      description: `₹${room.price?.toLocaleString()}/night`,
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
      const img = room.image || FALLBACK_IMAGES.deluxe;
      const amenityText = room.amenities?.length
        ? room.amenities.slice(0, 3).join(" • ")
        : "Contact hotel for amenities";
      await sendImage(
        to,
        img,
        `🛏️ *${room.name}* — ₹${room.price?.toLocaleString()}/night\n${amenityText} ✅`,
        phoneNumberId,
        token,
      );
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
    const upiLink = buildUpiLink(booking.totalAmount, transactionNote);

    const qrBuffer = await QRCode.toBuffer(upiLink, { width: 400, margin: 2 });

    // await Payment.findOneAndUpdate(
    //   { bookingId: booking._id },
    //   {
    //     hotelId: hotel._id,
    //     hotelName: hotel.name,
    //     bookingId: booking._id,
    //     bookingRef,
    //     customerPhone: booking.phone,
    //     guestName: booking.guestName,
    //     amount: booking.totalAmount,
    //     transactionNote,
    //     status: "pending",
    //   },
    //   { upsert: true, new: true },
    // );

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
async function verifyPaymentScreenshot(base64Image, mimeType, expectedAmount) {
  try {
    const prompt = `You are a payment verification assistant. Examine this UPI payment screenshot carefully.

Return ONLY a JSON object:
{
  "receiverName": "exact name shown as receiver/payee",
  "amountPaid": 1234,
  "transactionDate": "DD/MM/YYYY or null",
  "transactionId": "UPI transaction ID or null",
  "isSuccessful": true or false
}

Rules:
- receiverName: exact payee name on screenshot
- amountPaid: number only, no ₹ symbol
- isSuccessful: true ONLY if screenshot clearly shows SUCCESS/COMPLETED
- Return ONLY valid JSON, nothing else`;

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
      max_tokens: 300,
      temperature: 0,
    });

    const raw = response.choices[0].message.content
      .trim()
      .replace(/```json|```/g, "");
    const data = JSON.parse(raw);

    const nameMatch = data.receiverName
      ?.toLowerCase()
      .includes(PLATFORM_UPI_NAME.toLowerCase());
    const amountMatch = Math.abs(data.amountPaid - expectedAmount) <= 1;
    const isSuccess = data.isSuccessful === true;

    return {
      verified: nameMatch && amountMatch && isSuccess,
      nameMatch,
      amountMatch,
      isSuccess,
      extracted: data,
      expectedAmount,
    };
  } catch (err) {
    console.error("❌ verifyPaymentScreenshot error:", err.message);
    return { verified: false, error: err.message };
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
  const parts = input.split('/');

  if (parts.length !== 3) return null;

  const [day, month, year] = parts.map(Number);

  const date = new Date(year, month - 1, day);

  // Validate correct date (avoid 32/13/2026 etc)
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

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
      model: "gpt-4o-mini",
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
    const pricePerNight = roomConfig?.price || 2500;
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

    if (customerPhone === phoneNumberId) return;

    // Skip stale messages older than 30s
    const msgTime = parseInt(message.timestamp) * 1000;
    if (Date.now() - msgTime > 30000) {
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
      { upsert: true, new: true },
    );

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
      );
      console.log("💳 Verification result:", JSON.stringify(result));

      // Prevent duplicate verification
      if (payment.status === "verified") {
        await sendText(
          customerPhone,
          "Payment already verified for this booking 😊",
          phoneNumberId,
          token
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
          failReason = `Payment receiver name doesn't match. Please pay to *${PLATFORM_UPI_NAME}* and send screenshot again. 🙏`;
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
        "Sorry, I can only process text messages and images right now! 😊",
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

    if (!userMessage) return;

    console.log(
      `📩 [${hotel.name}] [${customerPhone}] "${userMessage}" | id: "${interactiveId}"`,
    );

    const chat = await Chat.findOne({
      phone: customerPhone,
      hotelId: hotel._id,
    });

    if (chat?.bookingFlow?.step) {
      const flow = chat.bookingFlow;

      // STEP 1: NAME
      if (flow.step === "ask_name") {
        flow.data.name = userMessage;
        flow.step = "ask_checkin";

        await chat.save();

        await sendText(
          customerPhone,
          "Nice to meet you! 😊 What's your check-in date? (DD/MM/YYYY)",
          phoneNumberId,
          token,
        );
        return;
      }

      // STEP 2: CHECK-IN
      if (flow.step === "ask_checkin") {
        const checkIn = new parseDate(userMessage);

        if (isNaN(checkIn)) {
          await sendText(
            customerPhone,
            "Please enter a valid date like 25/04/2026 😊",
            phoneNumberId,
            token,
          );
          return;
        }

        flow.data.checkIn = checkIn;
        flow.step = "ask_checkout";

        await chat.save();

        await sendText(
          customerPhone,
          "Got it 👍 Now your check-out date?",
          phoneNumberId,
          token,
        );
        return;
      }

      // STEP 3: CHECK-OUT
      if (flow.step === "ask_checkout") {
        const checkOut = new parseDate(userMessage);

        if (isNaN(checkOut) || checkOut <= flow.data.checkIn) {
          await sendText(
            customerPhone,
            "Check-out must be after check-in 😊",
            phoneNumberId,
            token,
          );
          return;
        }

        flow.data.checkOut = checkOut;
        flow.step = "ask_guests";

        await chat.save();

        await sendText(customerPhone, "How many guests?", phoneNumberId, token);
        return;
      }

      // STEP 4: GUESTS
      if (flow.step === "ask_guests") {
        const guests = parseInt(userMessage);

        if (isNaN(guests) || guests <= 0) {
          await sendText(
            customerPhone,
            "Please enter a valid number 😊",
            phoneNumberId,
            token,
          );
          return;
        }

        flow.data.guests = guests;
        flow.step = "confirm";

        await chat.save();

        const nights = Math.ceil(
          (flow.data.checkOut - flow.data.checkIn) / (1000 * 60 * 60 * 24),
        );
        const room = hotel.rooms.find((r) => r.name === flow.data.roomType);

        const total = room.price * nights;

        await sendText(
          customerPhone,
          `📋 Booking Summary:\n\n👤 ${flow.data.name}\n🛏️ ${flow.data.roomType}\n📅 ${flow.data.checkIn.toDateString()} → ${flow.data.checkOut.toDateString()}\n👥 ${guests} guests\n💰 ₹${total}\n\nType *confirm* to proceed`,
          phoneNumberId,
          token,
        );

        return;
      }

      // STEP 5: CONFIRM
      if (flow.step === "confirm") {
        if (!/confirm/i.test(userMessage)) {
          await sendText(
            customerPhone,
            "Please type *confirm* to proceed 😊",
            phoneNumberId,
            token,
          );
          return;
        }

        const nights = Math.ceil(
          (flow.data.checkOut - flow.data.checkIn) / (1000 * 60 * 60 * 24),
        );
        const room = hotel.rooms.find((r) => r.name === flow.data.roomType);
        if (!room) {
          await sendText(
            customerPhone,
            "Sorry, this room is not available 😔",
            phoneNumberId,
            token,
          );
          return;
        }
        const total = room.price * nights;

        await Booking.create({
          hotelId: hotel._id,
          customerId: customer._id,
          guestName: flow.data.name,
          phone: customerPhone,
          checkIn: flow.data.checkIn,
          checkOut: flow.data.checkOut,
          roomType: flow.data.roomType,
          numberOfGuests: flow.data.guests,
          totalAmount: total,
          status: "confirmed",
        });

        // ✅ UPDATE CHAT STATUS (CHANGE 3)
        await Chat.findOneAndUpdate(
          { phone: customerPhone, hotelId: hotel._id },
          {
            status: "booked",
            bookingFlow: { step: null, data: {} },
          },
        );

        await sendText(
          customerPhone,
          "🎉 Booking created! Now choose payment method.",
          phoneNumberId,
          token,
        );

        await sendButtons(
          customerPhone,
          "How would you like to pay?",
          [
            { id: "pay_qr", title: "Pay via QR" },
            { id: "pay_desk", title: "Pay at Desk" },
          ],
          phoneNumberId,
          token,
        );

        return;
      }
    }

    // ══════════════════════════════════════════════════════════
    // HANDLER 1: "paid" text → ask for screenshot
    // ══════════════════════════════════════════════════════════
    if (
      /^(paid|payment done|payment complete|pay kar diya|pay ho gaya)/i.test(
        userMessage,
      )
    ) {
      const booking = await Booking.findOne({
        phone: { $in: [normalizedPhone, customerPhone] },
        hotelId: hotel._id,
        status: "confirmed",
      }).sort({ createdAt: -1 });

      const payment = booking
        ? await Payment.findOne({
            bookingId: booking._id,
            status: "pending",
          })
        : null;

      if (booking && payment) {
        await saveMessage(
          customerPhone,
          hotel._id,
          customer._id,
          "user",
          userMessage,
        );

        const msg =
          `📸 Please send a *screenshot* of your successful payment so I can verify it!\n\n` +
          `✅ Receiver: *${PLATFORM_UPI_NAME}*\n` +
          `✅ Amount: ₹${booking.totalAmount?.toLocaleString()}`;

        await sendText(customerPhone, msg, phoneNumberId, token);
      } else {
        await sendText(
          customerPhone,
          "Please request a payment QR first before confirming payment 😊",
          phoneNumberId,
          token,
        );
      }

      return;
    }

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

    // ── Room selected from menu (dynamic room IDs) ────────────
    if (interactiveId.startsWith("room_custom_")) {
      const roomId = interactiveId.replace("room_custom_", "");
      const roomConfig = hotel.rooms?.find((r) => r._id.toString() === roomId);
      const roomLabel = roomConfig
        ? `${roomConfig.name} (₹${roomConfig.price?.toLocaleString()}/night)`
        : "selected room";

      await Chat.findOneAndUpdate(
        { phone: customerPhone, hotelId: hotel._id },
        {
          status: "booking_in_progress",
          bookingFlow: {
            step: "ask_name",
            data: {
              roomType: roomConfig.name,
            },
          },
        },
        { upsert: true, returnDocument: "after" },
      );

      await sendText(
        customerPhone,
        `Great choice! 😊 You selected *${roomConfig.name}*.\n\nWhat's your full name?`,
        phoneNumberId,
        token,
      );

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
      });

      // ✅ Send QR
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
