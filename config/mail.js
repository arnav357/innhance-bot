const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

async function sendHumanAlertEmail(hotel, phone) {
  try {
    await transporter.sendMail({
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

    console.log("✅ Human alert email sent");
  } catch (err) {
    console.error("❌ Mail error:", err.message);
  }
}

module.exports = sendHumanAlertEmail;