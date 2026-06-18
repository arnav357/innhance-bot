const FALLBACK_IMAGES = {
  standard:
    "https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=800",
  deluxe: "https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=800",
  suite: "https://images.unsplash.com/photo-1631049552057-403cdb8f0658?w=800",
};

const {
  sendText,
  sendImage,
  sendButtons,
  sendList,
  sendVideo,
} = require("./whatsappService");


async function sendHelloMenu(to, phoneNumberId, token, hotel) {
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
  if (hotel.banquetHalls?.length) {
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

  rows.push({
    id: "ask_question",
    title: "🙋 Ask a Question",
    description: "I will try to answer based on hotel information",
  });

  await sendList(
    to,
    `I'm Inna, your personal assistant. How can I help you again? 😊`,
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
  if (hotel.banquetHalls?.length) {
    rows.push({
      id: "menu_banquet",
      title: "🎉 Banquet Facilities",
      description: "Birthday & anniversary events",
    });
  }

  // Existing human support option
  // rows.push({
  //   id: "talk_human",
  //   title: "👤 Talk to Human",
  //   description: "Chat with our team directly",
  // });

  rows.push({
    id: "ask_question",
    title: "🙋 Ask a Question",
    description: "I will try to answer based on hotel information",
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
    ? "🏨 *Choose your room type:*\n\n✅ Please ask about amenities for each room!\n"
    : "🏨 *Choose your room type:*\n\n✅ All rooms include FREE breakfast & WiFi!\n";

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
        ? room.images.slice(0, 7) // limit to 2 images
        : [FALLBACK_IMAGES.deluxe];

      const amenityText = room.amenities?.length
        ? room.amenities.slice(0, 3).join(" • ")
        : "Contact hotel for amenities";

      const pricingText = room.plans?.length
        ? room.plans.map((p) => `${p.name}: ₹${p.price}`).join(" | ")
        : `₹${room.price}/night`;

      for (const mediaUrl of room.images || []) {
        const isVideo = /\.(mp4|mov|webm|ogg)$/i.test(mediaUrl);

        if (isVideo) {
          await sendVideo(to, mediaUrl, room.name, phoneNumberId, token);
          await new Promise((resolve) => setTimeout(resolve, 700));
        } else {
          await sendImage(to, mediaUrl, room.name, phoneNumberId, token);
          await new Promise((resolve) => setTimeout(resolve, 700));
        }
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

module.exports = {
  sendHelloMenu,
  sendMainMenu,
  sendRoomMenu,
  sendRoomPhotos,
};