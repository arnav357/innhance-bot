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

// ============================================================
// PLATFORM PAYMENT CONFIG
// All customer payments go to Innhance account first
// ============================================================
const PLATFORM_UPI_ID = process.env.PLATFORM_UPI_ID || "arnav@okicici";
const PLATFORM_UPI_NAME = process.env.PLATFORM_UPI_NAME || "Arnav Prabhakar";
const IMGBB_API_KEY = process.env.IMGBB_API_KEY;




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

function buildUpiLink(amount, transactionNote, upiId, upiName) {
  const pa = encodeURIComponent(upiId);
  const pn = encodeURIComponent(upiName);
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

function detectInterruption(text = "") {
  const t = text.toLowerCase().trim();

  return (
    t.includes("?") ||
    /do you|is there|have you|can i|what|where|when|how|which|price|wifi|parking|toiletries|couple|pet|local id|cancel/i.test(t)
  );
}

function getStepQuestion(step) {
   if (step === "ask_checkout")
      return "What is your check-out date? 😊";

   if (step === "ask_guests")
      return "How many guests? 😊";

   if (step === "ask_name")
      return "What's your full name? 😊";

   return "Let's continue your booking 😊";
}

module.exports = {
  buildSystemPrompt,normalizePhone,buildUpiLink,buildTransactionNote,detectLanguage,looksLikeQuestion,detectInterruption,getStepQuestion
};