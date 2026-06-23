const axios = require("axios");

// Your existing V1 classifier
const classifyIntentV1 = require("./intentClassifier");

const PYTHON_AI_URL =
  process.env.PYTHON_AI_URL || "http://localhost:8000";

async function classifyIntent({
  venueId,
  message,
  history = [],
  language = "en",
  currentMissing = null,
}) {
  try {
    const { data } = await axios.post(
      `${PYTHON_AI_URL}/classify`,
      {
        venue_id: venueId,
        message,
        history,
        language,
      },
      {
        timeout: 10000,
      }
    );

    return {
      type: data.intent,
      confidence: data.confidence,
      fields: data.slots || {},
      provider: data.provider,
      rawMessage: data.raw_message,
    };
  } catch (error) {
    console.error(
      "[AI SERVICE] Python service unavailable. Falling back to V1 classifier."
    );
    console.error(error.response?.data);
    console.error(error.message);

    return await classifyIntentV1(
      message,
      currentMissing
    );
  }
}

module.exports = {
  classifyIntent,
};