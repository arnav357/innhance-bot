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


async function answerHotelQuestion(
  question,
  hotel,
  customerPhone,
  customerId = null,
  bookingFlow = null
) {
  const q = question.toLowerCase().trim();

  // ---------------------------------------------------
  // 1. QUICK DIRECT ANSWERS (fast + no GPT cost)
  // ---------------------------------------------------

//   if (
//     q.includes("parking") ||
//     q.includes("car parking") ||
//     q.includes("parking available")
//   ) {
//     return hotel.parking
//       ? "Yes 😊 Parking is available at the hotel."
//       : "Sorry 😊 I can't confirm parking right now.";
//   }

//   if (
//     q.includes("check in") ||
//     q.includes("checkin") ||
//     q.includes("check-in")
//   ) {
//     return "Check-in is after 2 PM 😊";
//   }

//   if (
//     q.includes("check out") ||
//     q.includes("checkout") ||
//     q.includes("check-out")
//   ) {
//     return "Check-out is before 11 AM 😊";
//   }

//   if (
//     q.includes("wifi") ||
//     q.includes("wi-fi") ||
//     q.includes("internet")
//   ) {
//     return "Yes 😊 WiFi is available for guests.";
//   }

  // ---------------------------------------------------
  // 2. SMART GPT ANSWERS FOR EVERYTHING ELSE
  // ---------------------------------------------------

  try {
    const flowStep = bookingFlow?.step || "booking_active";
    const flowData = bookingFlow?.data || {};

    const extraPrompt = `

Instructions:
- Answer the customer's question warmly and naturally.
- Keep reply concise.
- Use emojis naturally.
- If answer is not clearly available from hotel data, say:
  "I'm not able to confirm that right now 😊"
- After answering, politely ask if customer would like to continue booking.
`;

    const reply = await getSmartReply(
      customerPhone,
      hotel._id,
      customerId,
      question,
      extraPrompt,
      hotel
    );

    return reply;
  } catch (error) {
    console.error("answerHotelQuestion error:", error);

    return "I'm not able to confirm that right now 😊 Would you like to continue your booking?";
  }
}

module.exports = answerHotelQuestion;