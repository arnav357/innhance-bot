const multer = require("multer");

const storage = multer.memoryStorage(); // store in RAM temporarily

const upload = multer({ storage });

module.exports = upload;