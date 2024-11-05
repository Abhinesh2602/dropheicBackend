const express = require("express");
const cors = require("cors");
const app = express();
app.use(cors());
const multer = require("multer");

const port = 3001;

// Configure multer storage with custom filename
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "./uploads"); // Use the uploads directory
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  },
});

const upload = multer({ storage });

app.get("/", (req, res) => {
  res.send("Hello world");
});

// Upload endpoint
app.post("/upload", upload.single("files"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      error: "No file uploaded",
    });
  }

  console.log("Uploaded Succesfully:", req.file);
  res.json({
    success: true,
    file: req.file,
  });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    error: "Something broke!",
    details: err.message,
  });
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
