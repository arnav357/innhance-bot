const axios = require("axios");
const OpenAI = require("openai");
const QRCode = require("qrcode");
const FormData = require("form-data");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const Payment = require("../models/Payment");
const {
    sendText,
    sendImage,
} = require("./whatsappService");
const {
  buildUpiLink,
  buildTransactionNote,
} = require("../components/webhookFunctions");
const { saveMessage } = require("./chatService");

const PLATFORM_UPI_ID = process.env.PLATFORM_UPI_ID || "arnav@okicici";
const PLATFORM_UPI_NAME = process.env.PLATFORM_UPI_NAME || "Arnav Prabhakar";
const IMGBB_API_KEY = process.env.IMGBB_API_KEY;


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
    await saveMessage(
      to,
      hotel._id,
      booking.customerId,
      "assistant",
      "[Sent: Payment QR]",
      hotel.timezone,
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

module.exports = {
  sendPaymentQR,
  fetchWhatsAppMedia,
  verifyPaymentScreenshot,
  parseIndianTxnDateTime,
};