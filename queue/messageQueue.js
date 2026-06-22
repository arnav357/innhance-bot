const { Queue } = require("bullmq");
const Redis = require("ioredis");

const connection = new Redis(process.env.UPSTASH_REDIS_URL);

const messageQueue = new Queue(
  "whatsapp-messages",
  { connection }
);

module.exports = messageQueue;