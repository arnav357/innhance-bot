const axios = require("axios");

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
          body: {
            text: bodyText,
          },
          action: {
            button: "View Options",
            sections,
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
    console.error("❌ sendList error:", err.response?.data || err.message);
  }
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


module.exports = {
  sendList,
  sendText,
  sendImage,
  sendVideo,
  sendButtons,
};