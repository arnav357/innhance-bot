require("dotenv").config();
const mongoose = require("mongoose");
const Hotel = require("../models/Hotel");

const systemPrompt = `You are Inna, a warm and friendly hotel booking assistant for Innhance Hotels.
You speak in a natural, human, conversational way — like a real receptionist, not a robot.
You use emojis naturally in your responses to make them feel warm and friendly.
Keep responses concise and clear — not too long.

Here is everything you know about The 14 Gables Hotels:

ROOMS & PRICING:
- Standard Room: ₹2,500/night (perfect for solo travelers or couples)
- Deluxe Room: ₹4,000/night (spacious with beautiful view)
- Suite: ₹7,500/night (ultimate luxury experience)
- All rooms include FREE breakfast and FREE WiFi

CHECK-IN / CHECK-OUT:
- Check-in: 12:00 PM (early check-in available on request)
- Check-out: 11:00 AM (late check-out until 2 PM for ₹500 extra)
- Valid photo ID required at check-in

AMENITIES (all free for guests):
- Smart TV
- Balcony
- Mountain View
- Free high-speed WiFi everywhere
- Free parking (valet at ₹200/day)

RESTAURANT:
- Breakfast: 7 AM - 10 AM (FREE for guests)
- Lunch: 12 PM - 3 PM
- Dinner: 7 PM - 11 PM
- Cuisines: Indian, Continental, Chinese

CANCELLATION POLICY:
- Free cancellation up to 48 hours before check-in
- 50% charge within 48 hours
- No refund for no-shows

SPECIAL OFFERS:
- Weekend Special: 15% off Deluxe rooms
- Family Package: Kids under 12 stay FREE
- Long Stay Deal: 7 nights = 1 night FREE
- Honeymoon Package: includes dinner + decoration

LOCATION:
- Address: 123 Hotel Street, City Centre
- 15 minutes from airport
- 5 minutes from railway station
- Free pickup available

CONTACT:
- Phone: +917017164266
- Email: arkventuresmanali@gmail.com
- Front desk: 24/7

BOOKING FLOW:
When a guest wants to book a room, collect these details one by one in a conversational way:
1. Full name
2. Check-in date — ALWAYS ask for complete date in format DD/MM/YYYY.
   If guest gives incomplete date like "25th" or just a number, ask:
   "Could you please share the complete date with month and year? For example, 25/04/2026 😊"
3. Check-out date — same as above, always full date DD/MM/YYYY
4. Number of guests
5. Room type preference

IMPORTANT DATE RULES:
- Never assume the month or year
- Always confirm the full date before moving on
- If date is in the past, politely point it out and ask again
- Valid format examples: 25/04/2026 or 25 April 2026
- Always repeat back the full dates in the booking summary

Then summarize and confirm the booking with all details including full dates.

IMPORTANT RULES:
- Always be warm, friendly and use emojis naturally
- Keep responses short and conversational
- If someone says hi/hello/hey, greet them warmly
- If asked something not related to the hotel, politely redirect
- Never make up information not provided above`;

async function seed() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("MongoDB connected ✅");

    // await Hotel.deleteOne({ email: 'admin@innhance.com' });

    const hotel = await Hotel.create({
      name: "Bindram Palace",
      email: "hotelbindrampalace@gmail.com",
      password: "Bindram@3192",
      // whatsappNumber: '+1 555 174 2481',
      // whatsappNumber: '+1 555 646 1664',
      whatsappNumber: "+919837233055",
      // whatsappPhoneNumberId: '1030286350168358',
      // whatsappPhoneNumberId: '1107267635800971',
      whatsappPhoneNumberId: "997060770167829",
      botConfig: {
        assistantName: "Inna",
        systemPrompt: systemPrompt,
      },
      rooms: [
        {
          name: "Family Suite",
          price: 2500,
          totalRooms: 11,
          roomNumbers: [
            { num: "102" },
            { num: "103" },
            { num: "104" },
            { num: "105" },
            { num: "202" },
            { num: "203" },
            { num: "204" },
            { num: "205" },
            { num: "303" },
            { num: "304" },
            { num: "306" },
          ],
          amenities: [
            "Air Conditioning",
            "Attached Bathroom",
            "Hot & Cold Water",
            "Television",
            "Extra Bedding Available",
            "Wifi Access",
            "Sofa come bed",
            "2 chairs and table",
            "Cooking cabinet for light cooking",
            "Electric kettle",
          ],
        },
        {
          name: "Deluxe",
          price: 4000,
          totalRooms: 6,
          roomNumbers: [{ num: "101" }, { num: "201" }, { num: "301" }, { num: "302" }, { num: "305" }, { num: "210" }],
          amenities: [
            "Air Conditioning",
            "Attached Bathroom",
            "Hot & Cold Water",
            "Television",
            "Wifi Access",
            "2 chairs and table",
            "Electric kettle",
          ],
        },
        // {
        //   name: "Super Deluxe",
        //   price: 7500,
        //   totalRooms: 5,
        //   roomNumbers: [
        //     { num: "301" },
        //     { num: "302" },
        //     { num: "304" },
        //     { num: "305" },
        //     { num: "306" },
        //   ],
        // },
        // {
        //   name: "Superior Corner",
        //   price: 10000,
        //   totalRooms: 1,
        //   roomNumbers: [{ num: "303" }],
        // },
      ],
      images: {
        lobby:
          "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800",
        standardRoom:
          "https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=800",
        deluxeRoom:
          "https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=800",
        suite:
          "https://images.unsplash.com/photo-1578683010236-d716f9a3f461?w=800",
      },
      plan: "trial",
      isActive: true,
    });

    console.log("Hotel seeded ✅", hotel._id);
    console.log("Hotel name:", hotel.name);
    console.log("WhatsApp number:", hotel.whatsappNumber);
    process.exit();
  } catch (error) {
    console.error("Seed error:", error.message);
    process.exit(1);
  }
}

seed();
