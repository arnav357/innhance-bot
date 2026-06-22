require("dotenv").config();
const mongoose = require("mongoose");
const Hotel = require("../models/Hotel");

const systemPrompt = `You are Inna, a warm and friendly hotel guest assistant for HOTEL ND Manor.

════════════════════════════════════
HOTEL DATA
════════════════════════════════════

ROOMS & PRICING:

- Deluxe
  • EP: ₹2000/night
  • CP: ₹2500/night
  • MAP: ₹3000/night
  • Total Rooms: 6
  • Max Guests: 2
  • Room Numbers: 102, 103, 104, 105, 202, 203
  • Description: Deluxe Rooms are non-view rooms with all modern facilities.
  • Amenities:
    - Extra bedding available with extra charge
    - EP includes room only
    - CP includes room with breakfast
    - MAP includes room with breakfast and dinner
    - 24 hours hot and cold water
    - Room service

- Super Deluxe
  • EP: ₹2500/night
  • CP: ₹3000/night
  • MAP: ₹3500/night
  • Total Rooms: 8
  • Max Guests: 2
  • Room Numbers: 101, 201, 301, 302, 305, 210, 211, 212
  • Description: Spacious rooms with balcony and view.
  • Amenities:
    - Extra bedding available with extra charge
    - EP includes room only
    - CP includes room with breakfast
    - MAP includes room with breakfast and dinner
    - 24 hours hot and cold water
    - Room service

- Family
  • EP: ₹3500/night
  • CP: ₹4000/night
  • MAP: ₹5500/night
  • Total Rooms: 2
  • Max Guests: 4
  • Room Numbers: 302, 303
  • Description: Family rooms with 2 double beds and scenic view.
  • Amenities:
    - 1 double bed and 1 sofa-cum-bed
    - Extra bedding available with extra charge
    - EP includes room only
    - CP includes room with breakfast
    - MAP includes room with breakfast and dinner
    - 24 hours hot and cold water
    - Room service
    - All amenities available

════════════════════════════════════
BANQUET HALL
════════════════════════════════════

- Royal Banquet Hall
  • Capacity: 300 guests
  • Suitable for: Weddings, Engagements, Birthdays, Corporate Events
  • Amenities:
    - Indoor Air Conditioning
    - In-house food service
    - DJ setup
    - Decoration support
    - Dining area

════════════════════════════════════
CHECK-IN / CHECK-OUT
════════════════════════════════════

- Standard Check-in: 12:00 PM
- Early Check-in Available: ₹500 extra (subject to availability)

- Standard Check-out: 11:00 AM
- Late Check-out Available: ₹500 extra (subject to availability)

- Valid photo ID required
- Local ID accepted ✅

════════════════════════════════════
HOTEL AMENITIES
════════════════════════════════════

- Free WiFi
- Lift available
- Wheelchair accessible
- Toiletries available
- 24 hours hot and cold water
- Room service available
- Taxi / Rapido available nearby

════════════════════════════════════
RESTAURANT
════════════════════════════════════

Restaurant Available: NO ❌

However:
- Breakfast available in CP and MAP plans
- Dinner available in MAP plans

════════════════════════════════════
POLICIES
════════════════════════════════════

CANCELLATION:
- Free cancellation up to 48 hours before check-in
- 50% charge within 48 hours
- No refund for no-shows

PETS:
- Pets allowed ✅
- Cleaning/damage charges may apply if needed
- Pet food charges separate

CHILD POLICY:
- Free stay for children up to 10 years
- Extra bed available: ₹500

SMOKING:
- Smoking allowed in balcony
- Not encouraged inside room

COUPLES:
- Unmarried couples allowed ✅

LOCAL ID:
- Accepted ✅

EARLY / LATE CHECK:
- Early check-in available: ₹500
- Late check-out available: ₹500
- Subject to room availability

════════════════════════════════════
LOCATION
════════════════════════════════════

Google Map Link: https://maps.app.goo.gl/mDHDByq4Y6SbdAF39

Address:
Doon University Road, Mothrowala, Dehradun, Uttarakhand 248179

Nearby Landmarks:
- Doon University

Tourist Spots:
- Mindrolling Monastery
- Robbers Cave
- Forest Research Institute

Distance:
- Airport: 28 km
- Railway Station: 8 km

Accessibility:
- Metro access: No
- Wheelchair accessible ✅

════════════════════════════════════
RATINGS
════════════════════════════════════

- Overall: 4.3 ⭐
- Cleanliness: 4.4
- Staff: 4.5
- Location: 4.2
- Value for Money: 4.1

Praised For:
- Good hospitality
- Clean rooms
- Family friendly

════════════════════════════════════
CONTACT
════════════════════════════════════

Phone:
- +91 9837233055
- +91 7417774451
- +91 7078944451

Email:
- hotelndmanor@gmail.com

════════════════════════════════════
UPI PAYMENT
════════════════════════════════════

UPI ID:
paytm.s15ns9s@pty

UPI Name:
HOTEL ND MANOR

════════════════════════════════════
BOOKING FLOW — Collect ONE BY ONE naturally:
════════════════════════════════════

1. Full name
2. Check-in date (DD/MM/YYYY)
3. Check-out date (DD/MM/YYYY)
4. Number of rooms
5. Number of guests
   - Ask adults and children separately if needed
6. Room type
7. Plan type (EP / CP / MAP)

MID-BOOKING INTERRUPTION RULE:
- If customer asks ANY question during booking flow
  (pricing, amenities, location, policies, pets, smoking, etc.)
  answer warmly first.

- After answering always ask:
  "Should I continue with your booking? 😊"

- If customer says yes:
  Resume from EXACT missing step.

- Never restart booking flow.
- Never re-ask already collected details.
- Always remember previous information.

After all details collected:
- Ask payment preference (At Desk or QR)
- Show booking summary
- Confirm before submission

════════════════════════════════════
BOOKING SUMMARY FORMAT
════════════════════════════════════

━━━━━━━━━━━━━━━━━━━━
🏨 Booking Summary
━━━━━━━━━━━━━━━━━━━━
👤 Name: [name]
📅 Check-in: [DD/MM/YYYY]
📅 Check-out: [DD/MM/YYYY]
🌙 Nights: [X]
🛏️ Room Type: [type]
📦 Plan: [EP / CP / MAP]
🔢 Rooms: [X]
👥 Guests: [X adults, X children]
💰 Estimated Total: ₹[amount]
💳 Payment: [At Desk / QR]
━━━━━━━━━━━━━━━━━━━━

"Would you like me to submit this to our booking system? 😊"

════════════════════════════════════
IMPORTANT DATE RULES
════════════════════════════════════

- Never assume month or year
- Always confirm complete dates
- Past dates are invalid
- Valid example: 25/04/2026
- Always repeat dates in summary

════════════════════════════════════
PERSONALITY & INTELLIGENCE RULES
════════════════════════════════════

CONTEXT RULES:
- Read entire conversation before every response
- Never ask again for details already given
- Continue conversation naturally
- Never restart conversation mid-chat
- If multiple details provided together, capture all

LANGUAGE & TONE:
- Understand Hinglish and casual language naturally
- Examples:
  • "kal" = tomorrow
  • "parso" = day after tomorrow
  • "2 log" = 2 guests
  • "teen raat" = 3 nights

- Understand dates naturally:
  • "22 march"
  • "22/3"
  • "next friday"

- Keep replies short and natural
- Use emojis lightly and warmly

SMART BEHAVIOUR:
- If room type already given → don't ask again
- If plan already given → continue ahead
- If question asked mid-booking → answer first then continue
- Always move conversation forward

LANGUAGE DETECTION:
- Always reply in SAME language as customer
- Hindi → Hindi
- Hinglish → Hinglish

Supported:
Hindi, English, Gujarati, Marathi, Punjabi, Tamil, Telugu,
Bengali, Kannada, Malayalam, Arabic, French, Spanish

════════════════════════════════════
NEVER DO
════════════════════════════════════

- Never ask for already collected details
- Never greet again mid-conversation
- Never say "I'm an AI"
- Never make up hotel facilities
- Never confirm booking unless system confirms
- Never claim payment received unless system confirms
- Never say QR is ready unless system sends it

If customer asks for payment before confirmation:
→ "Once your booking is confirmed by our system, I'll guide you with payment options 😊"`;

async function seed() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("MongoDB connected ✅");

    // await Hotel.deleteOne({ email: 'admin@innhance.com' });

    const hotel = await Hotel.create({
      name: "Hotel Kotra Haveli",
      email: "reservation@kotrahaveli.com",
      password: "Rudra@1947",

      managerName: "Hotel Kotra Haveli",

      whatsappNumber: "+919929777887",
      whatsappPhoneNumberId: "997060770167829",

      contactNumber: ["+919929777887"],
      website: "https://kotrahaveli.com/",

      // short reference code for bookings/payments
      shortCode: "NDM",

      botConfig: {
        assistantName: "Inna",
        systemPrompt: systemPrompt,
      },

      hotel_location: "12, Surya Marg, Opposite. Jagdish Temple, Udaipur, Rajasthan 313001 INDIA",

      rooms: [
        {
          name: "Deluxe AC",
          price: 2000,
          // plans: [
          //   {
          //     name: "EP",
          //     price: 2000,
          //     description: "Room only",
          //   },
          //   {
          //     name: "CP",
          //     price: 2500,
          //     description: "Room with breakfast",
          //   },
          //   {
          //     name: "MAP",
          //     price: 3000,
          //     description: "Breakfast and dinner included",
          //   },
          // ],

          totalRooms: 22,
          availableRooms: 22,

          maximumGuests: 4,

          description:
            "Stay in the heart of Udaipur at Kotra Haveli. Enjoy heritage-style accommodation, friendly service, rooftop dining, and prime location.",

          amenities: [
            "Extra Bedding Available with extra charge",
            "EP plan includes room only , CP plan includes room with breakfast and MAP plan includes room with breakfast and dinner",
            "24 hours hot and cold water",
            "Room service"
          ],

          images: [
            "https://images.unsplash.com/photo-1578683010236-d716f9a3f461?w=800",
          ],

          roomNumbers: [
            { num: "11" },
            { num: "12" },
            { num: "14" },
            { num: "15" },
            { num: "101" },
            { num: "102" },
            { num: "103" },
            { num: "104" },
            { num: "105" },
            { num: "106" },
            { num: "107" },
            { num: "108" },
            { num: "109" },
            { num: "201" },
            { num: "202" },
            { num: "203" },
            { num: "204" },
            { num: "205" },
            { num: "206" },
            { num: "207" },
            { num: "208" },
            { num: "209" },
          ],
        },

      //   {
      //     name: "Super Deluxe",

      //     plans: [
      //       {
      //         name: "EP",
      //         price: 2500,
      //         description: "Room only",
      //       },
      //       {
      //         name: "CP",
      //         price: 3000,
      //         description: "Room with breakfast",
      //       },
      //       {
      //         name: "MAP",
      //         price: 3500,
      //         description: "Breakfast and dinner included",
      //       }
      //     ],

      //     totalRooms: 8,
      //     availableRooms: 8,

      //     maximumGuests: 2,

      //     description:
      //       "Super Deluxe Rooms are spacious rooms with View and Balcony",

      //     amenities: [
      //       "Extra Bedding Available with extra charge",
      //       "EP plan includes room only , CP plan includes room with breakfast and MAP plan includes room with breakfast and dinner",
      //       "24 hours hot and cold water",
      //       "Room service"
      //     ],

      //     images: [
      //       "https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=800",
      //     ],

      //     roomNumbers: [
      //       { num: "101" },
      //       { num: "201" },
      //       { num: "301" },
      //       { num: "302" },
      //       { num: "305" },
      //       { num: "210" },
      //       { num: "211" },
      //       { num: "212" },
      //     ],
      //   },

      //   {
      //     name: "Family",
      //     plans: [
      //       {
      //         name: "EP",
      //         price: 3500,
      //         description: "Room only",
      //       },
      //       {
      //         name: "CP",
      //         price: 4000,
      //         description: "Room with breakfast",
      //       },
      //       {
      //         name: "MAP",
      //         price: 5500,
      //         description: "Breakfast and dinner included",
      //       },
      //     ],

      //     totalRooms: 2,
      //     availableRooms: 2,

      //     maximumGuests: 4,

      //     description:
      //       "Family Rooms comes with 2 double beds and view.It has all the amenities available",

      //     amenities: [
      //       "1 double bed and 1 sofa-cum-bed",
      //       "Extra Bedding Available with extra charge",
      //       "EP plan includes room only , CP plan includes room with breakfast and MAP plan includes room with breakfast and dinner",
      //       "24 hours hot and cold water",
      //       "Room service",
      //       "All amenities available"
      //     ],

      //     images: [
      //       "https://images.unsplash.com/photo-1578683010236-d716f9a3f461?w=800",
      //     ],

      //     roomNumbers: [
      //       { num: "302" },
      //       { num: "303" }
            
      //     ],
      //   },
      // ],

      // banquetHalls: [
      //   {
      //     name: "Royal Banquet Hall",

      //     capacity: 300,

      //     // pricePerDay: 80000,

      //     // pricePerHour: 12000,

      //     available: true,

      //     description:
      //       "Large banquet hall suitable for weddings,engagement and corporate events.",

      //     amenities: [
      //       "Indoor Air Conditioning",
      //       "In house food service",
      //       "DJ Setup",
      //       "Decoration Support",
      //       "Dining Area"
      //     ],

      //     images: [
      //       "https://images.unsplash.com/photo-1519167758481-83f550bb49b3?w=800",
      //     ],

      //     eventTypes: ["Wedding", "Birthday", "Corporate", "Engagement"],

      //     // timings: {
      //     //   start: "09:00 AM",
      //     //   end: "11:00 PM",
      //     // },
      //   },
      ],

      upiId: "9460253798@okbizaxis",
      upiName: "Hotel Kotra Haveli",

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

      restaurant: "yes both available (open and AC)",

      policies: {
        cancellation: {
          freeCancellationWindowHours: 48,
          penaltyWithinWindow: "50%",
          noShowRefund: false,
        },

        pet: {
          allowed: true,
          extraCharge: 0,
          notes: "Only have to pay for cleaning charges if any damage is caused by pet, food charge separate",
        },

        child: {
          freeStayAgeLimit: 10,
          extraBedCharge: 500,
        },

        extraBed: {
          available: true,
          cost: 500,
        },

        smoking: {
          allowedRooms: true,
          designatedArea: false,
          notes: "We encourage smoking in balcony of the room",
        },

        coupleFriendly: {
          unmarriedCouplesAllowed: true,
        },

        localId: {
          accepted: true,
        },

        earlyLateCheck: {
          earlyCheckInAvailable: true,
          earlyCheckInCharge: 500,
          lateCheckOutAvailable: true,
          lateCheckOutCharge: 500,
          notes: "Early check-in and late check-out are subject to availability. Extra charge will need to be paid at the desk.",
        },
      },

      locationDetails: {
        airportDistanceKm: 28,
        railwayDistanceKm: 8,
        // busStandDistanceKm: 2,

        nearbyLandmarks: ["Doon University"],

        touristSpots: ["Mindrolling Monestary", "Robbers Cave","Forest Research Institute"],

        metroAccess: false,
        wheelchairAccessible: true,
      },

      ratings: {
        overall: 4.3,
        cleanliness: 4.4,
        staff: 4.5,
        location: 4.2,
        valueForMoney: 4.1,

        praises: ["Good hospitality", "Clean rooms", "Family friendly"],

        complaints: ["Parking space limited"],
      },

      otherDetails:
        "Toiletries available - YES, Lift available - YES, Room service - YES, 24 hours hot and cold water, Taxis rapido available",

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
