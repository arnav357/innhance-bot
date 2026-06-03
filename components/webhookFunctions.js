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
  return String(phone).replace(/\D/g, "");
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
  if (hinglishWords.filter((w) => lower.includes(w)).length >= 1)
    return "Hinglish";
  return "English";
}


// GET LANGUAGE INSTRUCTION

function getLanguageInstruction(detectedLanguage) {
  const instructions = {
  Hindi:     "DETECTED LANGUAGE: Hindi. Reply entirely in Hindi (Devanagari script). Do NOT use English except for proper nouns.",
  Hinglish:  "DETECTED LANGUAGE: Hinglish. Reply in Hinglish — Hindi+English mix in Roman script. Match casual tone exactly.",
  English:   "DETECTED LANGUAGE: English. Reply in clear, friendly English.",
  Tamil:     "DETECTED LANGUAGE: Tamil. Reply entirely in Tamil script.",
  Tanglish:  "DETECTED LANGUAGE: Tanglish. Reply in Tamil words using Roman script.",
  Kannada:   "DETECTED LANGUAGE: Kannada. Reply entirely in Kannada script.",
  Kanglish:  "DETECTED LANGUAGE: Kanglish. Reply in Kannada words using Roman script.",
  Telugu:    "DETECTED LANGUAGE: Telugu. Reply entirely in Telugu script.",
  Tenglish:  "DETECTED LANGUAGE: Tenglish. Reply in Telugu words using Roman script.",
  Gujarati:  "DETECTED LANGUAGE: Gujarati. Reply entirely in Gujarati script.",
  Gujlish:   "DETECTED LANGUAGE: Gujlish. Reply in Gujarati words using Roman script.",
  Marathi:   "DETECTED LANGUAGE: Marathi. Reply entirely in Marathi (Devanagari script).",
  Manglish:  "DETECTED LANGUAGE: Manglish. Reply in Marathi words using Roman script.",
  Bengali:   "DETECTED LANGUAGE: Bengali. Reply entirely in Bengali script.",
  Banglish:  "DETECTED LANGUAGE: Banglish. Reply in Bengali words using Roman script.",
  Malayalam: "DETECTED LANGUAGE: Malayalam. Reply entirely in Malayalam script.",
  Malglish:  "DETECTED LANGUAGE: Malglish. Reply in Malayalam words using Roman script.",
  Punjabi:   "DETECTED LANGUAGE: Punjabi. Reply entirely in Punjabi (Gurmukhi script).",
  Punglish:  "DETECTED LANGUAGE: Punglish. Reply in Punjabi words using Roman script.",
  Arabic:    "DETECTED LANGUAGE: Arabic. Reply entirely in Arabic script.",
  Odia: "DETECTED LANGUAGE: Odia. Reply entirely in Odia.",
  Odialish: "DETECTED LANGUAGE: Odialish. Reply in Odia written using English letters.",

  Assamese: "DETECTED LANGUAGE: Assamese. Reply entirely in Assamese.",
  Assamilish: "DETECTED LANGUAGE: Assamilish. Reply in Assamese written using English letters.",

  Nepali: "DETECTED LANGUAGE: Nepali. Reply entirely in Nepali.",
  Neplish: "DETECTED LANGUAGE: Neplish. Reply in Nepali written using English letters.",

  Konkani: "DETECTED LANGUAGE: Konkani. Reply entirely in Konkani.",
  Konglish: "DETECTED LANGUAGE: Konglish. Reply in Konkani written using English letters.",

  Kashmiri: "DETECTED LANGUAGE: Kashmiri. Reply entirely in Kashmiri.",
  Kashlish: "DETECTED LANGUAGE: Kashlish. Reply in Kashmiri written using English letters.",

  Sindhi: "DETECTED LANGUAGE: Sindhi. Reply entirely in Sindhi.",
  Sindlish: "DETECTED LANGUAGE: Sindlish. Reply in Sindhi written using English letters.",

  Maithili: "DETECTED LANGUAGE: Maithili. Reply entirely in Maithili.",
  Maithlish: "DETECTED LANGUAGE: Maithlish. Reply in Maithili written using English letters.",

  Dogri: "DETECTED LANGUAGE: Dogri. Reply entirely in Dogri.",
  Dogrish: "DETECTED LANGUAGE: Dogrish. Reply in Dogri written using English letters.",

  Bodo: "DETECTED LANGUAGE: Bodo. Reply entirely in Bodo.",
  Bodolish: "DETECTED LANGUAGE: Bodolish. Reply in Bodo written using English letters.",

  Manipuri: "DETECTED LANGUAGE: Manipuri. Reply entirely in Manipuri.",
  Manipurlish: "DETECTED LANGUAGE: Manipurlish. Reply in Manipuri written using English letters.",

  Santali: "DETECTED LANGUAGE: Santali. Reply entirely in Santali.",
  Santalish: "DETECTED LANGUAGE: Santalish. Reply in Santali written using English letters.",

  Urdu: "DETECTED LANGUAGE: Urdu. Reply entirely in Urdu.",
  Urdlish: "DETECTED LANGUAGE: Urdlish. Reply in Urdu written using English letters.",

  Tulu: "DETECTED LANGUAGE: Tulu. Reply entirely in Tulu.",
  Tululish: "DETECTED LANGUAGE: Tululish. Reply in Tulu written using English letters.",

  Bhojpuri: "DETECTED LANGUAGE: Bhojpuri. Reply entirely in Bhojpuri.",
  Bhojpurilish: "DETECTED LANGUAGE: Bhojpurilish. Reply in Bhojpuri written using English letters.",

  Rajasthani: "DETECTED LANGUAGE: Rajasthani. Reply entirely in Rajasthani.",
  Rajasthanlish: "DETECTED LANGUAGE: Rajasthanlish. Reply in Rajasthani written using English letters.",

  Chhattisgarhi: "DETECTED LANGUAGE: Chhattisgarhi. Reply entirely in Chhattisgarhi.",
  Chhattisgarhlish: "DETECTED LANGUAGE: Chhattisgarhlish. Reply in Chhattisgarhi written using English letters.",

  Haryanvi: "DETECTED LANGUAGE: Haryanvi. Reply entirely in Haryanvi.",
  Haryanvlish: "DETECTED LANGUAGE: Haryanvlish. Reply in Haryanvi written using English letters.",

  Garhwali: "DETECTED LANGUAGE: Garhwali. Reply entirely in Garhwali.",
  Garhwalish: "DETECTED LANGUAGE: Garhwalish. Reply in Garhwali written using English letters.",

  Kumaoni: "DETECTED LANGUAGE: Kumaoni. Reply entirely in Kumaoni.",
  Kumaonlish: "DETECTED LANGUAGE: Kumaonlish. Reply in Kumaoni written using English letters.",

  // French
  French: "DETECTED LANGUAGE: French. Reply entirely in French script.",
  Frenglish: "DETECTED LANGUAGE: Frenglish. Reply in French using English keyboard romanization. Example: 'Bonjour, je voudrais reserver une chambre'.",

  // German
  German: "DETECTED LANGUAGE: German. Reply entirely in German.",
  Germlish: "DETECTED LANGUAGE: Germlish. Reply in German using English keyboard. Example: 'Hallo, ich mochte ein Zimmer buchen'.",

  // Spanish
  Spanish: "DETECTED LANGUAGE: Spanish. Reply entirely in Spanish.",
  Spanglish: "DETECTED LANGUAGE: Spanglish. Reply in Spanish using English keyboard without special characters. Example: 'Hola, quiero reservar una habitacion'.",

  // Italian
  Italian: "DETECTED LANGUAGE: Italian. Reply entirely in Italian.",
  Italish: "DETECTED LANGUAGE: Italish. Reply in Italian using English keyboard. Example: 'Ciao, vorrei prenotare una camera'.",

  // Portuguese
  Portuguese: "DETECTED LANGUAGE: Portuguese. Reply entirely in Portuguese.",
  Portlish: "DETECTED LANGUAGE: Portlish. Reply in Portuguese using English keyboard without accents. Example: 'Ola, gostaria de reservar um quarto'.",

  // Dutch
  Dutch: "DETECTED LANGUAGE: Dutch. Reply entirely in Dutch.",
  Dutchlish: "DETECTED LANGUAGE: Dutchlish. Reply in Dutch using English keyboard. Example: 'Hallo, ik wil een kamer boeken'.",

  // Swedish
  Swedish: "DETECTED LANGUAGE: Swedish. Reply entirely in Swedish.",
  Swenglish: "DETECTED LANGUAGE: Swenglish. Reply in Swedish using English keyboard without special characters. Example: 'Hej, jag vill boka ett rum'.",

  // Russian
  Russian: "DETECTED LANGUAGE: Russian. Reply entirely in Cyrillic Russian script.",
  Ruslish: "DETECTED LANGUAGE: Ruslish. Reply in Russian using English keyboard romanization (Translit). Example: 'Privet, ya khochu zabronirovat nomer'.",

  // Polish
  Polish: "DETECTED LANGUAGE: Polish. Reply entirely in Polish.",
  Polglish: "DETECTED LANGUAGE: Polglish. Reply in Polish using English keyboard without special characters. Example: 'Czesc, chcialbym zarezerwowac pokoj'.",

  // Danish
  Danish: "DETECTED LANGUAGE: Danish. Reply entirely in Danish.",
  Danglish: "DETECTED LANGUAGE: Danglish. Reply in Danish using English keyboard. Example: 'Hej, jeg vil gerne booke et varelse'.",

  // Norwegian
  Norwegian: "DETECTED LANGUAGE: Norwegian. Reply entirely in Norwegian.",
  Norglish: "DETECTED LANGUAGE: Norglish. Reply in Norwegian using English keyboard. Example: 'Hei, jeg vil gjerne bestille et rom'.",

  // Hebrew
  Hebrew: "DETECTED LANGUAGE: Hebrew. Reply entirely in Hebrew script.",
  Heblish: "DETECTED LANGUAGE: Heblish. Reply in Hebrew using English keyboard romanization. Example: 'Shalom, ani rotze lehazmin cheder'.",

  // Thai
  Thai: "DETECTED LANGUAGE: Thai. Reply entirely in Thai script.",
  Thaiglish: "DETECTED LANGUAGE: Thaiglish. Reply in Thai using English keyboard romanization. Example: 'Sawadee, phom yak ja jong hong'.",

  // Malay
  Malay: "DETECTED LANGUAGE: Malay. Reply entirely in Malay.",
  Maylish: "DETECTED LANGUAGE: Maylish. Reply in Malay using English keyboard. Example: 'Helo, saya ingin menempah bilik'.",

  // Indonesian
  Indonesian: "DETECTED LANGUAGE: Indonesian. Reply entirely in Indonesian.",
  Indoglish: "DETECTED LANGUAGE: Indoglish. Reply in Indonesian using English keyboard. Example: 'Halo, saya ingin memesan kamar'.",

  // Chinese
  Chinese: "DETECTED LANGUAGE: Chinese. Reply entirely in Simplified Chinese characters (汉字).",
  Chinglish: "DETECTED LANGUAGE: Chinglish. Reply in Chinese using Pinyin romanization. Example: 'Ni hao, wo yao ding fangjian'.",

  // Japanese
  Japanese: "DETECTED LANGUAGE: Japanese. Reply entirely in Japanese Hiragana/Katakana/Kanji.",
  Japlish: "DETECTED LANGUAGE: Japlish. Reply in Japanese using Romaji. Example: 'Konnichiwa, heya wo yoyaku shitai desu'.",

  // Korean
  Korean: "DETECTED LANGUAGE: Korean. Reply entirely in Korean Hangul script.",
  Konglish: "DETECTED LANGUAGE: Konglish. Reply in Korean using Romanization. Example: 'Annyeong, bang yeyak hago sipeoyo'.",
};
};

  return instructions[detectedLanguage] || instructions["English"];




async function detectLanguageWithGPT(text) {
  const res = await openai.chat.completions.create({
    model: "gpt-4o",
    temperature: 0,
    max_tokens: 10,
    messages: [
      {
        role: "system",
        content: `Detect the language of this message. Reply with ONLY one word:
             Hindi, Hinglish, English,

              Tamil, Tanglish,

              Kannada, Kanglish,

              Telugu, Tenglish,

              Gujarati, Gujlish,

              Marathi, Manglish,

              Bengali, Banglish,

              Malayalam, Malglish,

              Punjabi, Punglish,

              Arabic,

              Odia, Odialish,

              Assamese, Assamilish,

              Nepali, Neplish,

              Konkani, Konglish,

              Kashmiri, Kashlish,

              Sindhi, Sindlish,

              Maithili, Maithlish,

              Dogri, Dogrish,

              Bodo, Bodolish,

              Manipuri, Manipurlish,

              Santali, Santalish,

              Urdu, Urdlish,

              Tulu, Tululish,

              Bhojpuri, Bhojpurilish,

              Rajasthani, Rajasthanlish,

              Chhattisgarhi, Chhattisgarhlish,

              Haryanvi, Haryanvlish,

              Garhwali, Garhwalish,

              Kumaoni, Kumaonlish,

              French, Frenglish,
              German, Germlish,
              Spanish, Spanglish,
              Italian, Italish,
              Portuguese, Portlish,
              Dutch, Dutchlish,
              Swedish, Swenglish,
              Russian, Ruslish,
              Polish, Polglish,
              Danish, Danglish,
              Norwegian, Norglish,
              Hebrew, Heblish,
              Thai, Thaiglish,
              Malay, Maylish,
              Indonesian, Indoglish,
              Chinese, Chinglish,
              Japanese, Japlish,
              Korean, Konglish.

             Rules:
              - Native script → use language name (Tamil, Gujarati, Chinese, Japanese etc.)
              - Same language in Roman/English letters → use *lish variant (Tanglish, Chinglish etc.)
              - Hindi+English Roman mix → Hinglish
              - French without accents (e instead of é) → Frenglish
              - Russian in Cyrillic → Russian, romanized (privet) → Ruslish
              - Arabic in Arabic script → Arabic, romanized (marhaba) → Arablish
              - Chinese in characters (你好) → Chinese, in Pinyin (ni hao) → Chinglish
              - Japanese in Hiragana/Kanji → Japanese, in Romaji (konnichiwa) → Japlish
              - Korean in Hangul (안녕) → Korean, romanized (annyeong) → Konglish
              - Thai in Thai script → Thai, romanized (sawadee) → Thaiglish
              - Hebrew in Hebrew script → Hebrew, romanized (shalom) → Heblish`
      },
      { role: "user", content: text }
    ]
  });
  return res.choices[0].message.content.trim();
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

  // direct question mark
  if (t.includes("?")) return true;

  // common asks
  const patterns = [
    /show|see|send|share|dikhao|dikhaiye|bhejo/,
    /image|images|photo|photos|pic|pics|video/,
    /price|rate|cost|charges/,
    /wifi|parking|pool|gym|spa|toiletries|breakfast/,
    /pet|couple|local id|cancel|refund/,
    /where|location|address|near|distance/,
    /what|how|when|which|can i|do you|is there|have you/,
    /room details|room info|amenities/,
    /available hai|hai kya|mil jayega/
  ];

  return patterns.some((p) => p.test(t));
}


async function classifyMessage(userMessage, bookingStep = null) {
  try {
    const prompt = `
You are an intent classifier for a hotel booking WhatsApp bot.

Return ONLY valid JSON:

{
  "type": "",
  "intent": "",
  "containsQuestion": true,
  "containsBookingData": false
}

Allowed type values:
interruption_question
show_rooms
pricing_query
policy_query
human_request

Examples:
"room ki images dekhao" => show_rooms
"parking free hai?" => interruption_question
"human se baat karni hai" => human_request
"hotel manager se baat karni hai" => human_request
"what is price of standard room per night" => pricing_query
"what is cancellation policy" => policy_query
`;

    const res = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0,
      max_tokens: 120,
      messages: [
        { role: "system", content: prompt },
        {
          role: "user",
          content: `bookingStep: ${bookingStep}\nmessage: ${userMessage}`
        }
      ]
    });

    const raw = res.choices[0].message.content
      .trim()
      .replace(/```json|```/g, "");

    return JSON.parse(raw);

  } catch (err) {
    console.log("Classifier error:", err.message);

    return {
      type: "interruption_question",
      intent: "",
      containsQuestion: false,
      containsBookingData: false
    };
  }
}


// async functions:

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


async function askPendingStep(step, customerPhone, phoneNumberId, token) {
  if (step === "ask_name") {
    await sendText(customerPhone, "What's your full name? 😊", phoneNumberId, token);
    return;
  }

  if (step === "ask_checkin") {
    await sendText(customerPhone, "What is your check-in date? 😊", phoneNumberId, token);
    return;
  }

  if (step === "ask_checkout") {
    await sendText(customerPhone, "What is your check-out date? 😊", phoneNumberId, token);
    return;
  }

  if (step === "ask_guests") {
    await sendText(customerPhone, "How many guests? 😊", phoneNumberId, token);
    return;
  }
}


module.exports = {
  buildSystemPrompt,normalizePhone,buildUpiLink,buildTransactionNote,detectLanguage,looksLikeQuestion,detectInterruption,askPendingStep,classifyMessage, getLanguageInstruction, detectLanguageWithGPT
};


