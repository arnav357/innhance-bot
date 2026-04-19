
const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendHumanAlertEmail(hotel, phone) {
  try {
    const response = await resend.emails.send({
      from: process.env.EMAIL_USER,
      to: hotel.email,
      subject: "Guest requested human support",
      html: `
        <h2>New Human Support Request</h2>

        <p><b>Hotel:</b> ${hotel.name}</p>
        <p><b>Guest Phone:</b> ${phone}</p>
        <p><b>Time:</b> ${new Date().toLocaleString()}</p>

        <p>The guest requested to talk with a human.</p>
        <p>Please login to dashboard and reply.</p>
      `
    });

    console.log("✅ Email sent:", response);
  } catch (err) {
    console.error("❌ Resend error:", err);
  }
}

module.exports = sendHumanAlertEmail;