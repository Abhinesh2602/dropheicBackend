const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs").promises;
const { convertHeicToJpg } = require("./heicconvert");

const app = express();
const port = 3001;

// Middlewares
app.use(cors());

// Create directories if they don't exist
const uploadDir = path.join(__dirname, "uploads");
const convertedDir = path.join(__dirname, "converted");
const personalPicsDir = path.join(__dirname, "personalPics"); // Add this line

// Ensure directories exist
async function initializeDirectories() {
  try {
    await fs.mkdir(uploadDir, { recursive: true });
    await fs.mkdir(convertedDir, { recursive: true });
    await fs.mkdir(personalPicsDir, { recursive: true }); // Add this line

    console.log("Directories initialized successfully");
  } catch (error) {
    console.error("Error creating directories:", error);
    process.exit(1);
  }
}

// Configure multer with error handling
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir); // Use the uploadDir constant
  },
  filename: function (req, file, cb) {
    // Sanitize filename - remove spaces and special characters
    const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.]/g, "-");
    const fileName = `${Date.now()}-${sanitizedName}`;
    cb(null, fileName);
  },
});

const upload = multer({
  storage: storage,
  fileFilter: function (req, file, cb) {
    console.log("Received file:", file.originalname);
    // Case-insensitive check for HEIC files
    if (/\.(heic|heif)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error("Only HEIC/HEIF files are allowed"));
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
}).array("files", 10); // Allow up to 10 files

// Serve static files with proper error handling
app.use(
  "/uploads",
  express.static(uploadDir, {
    fallthrough: true,
    maxAge: "1h",
  })
);

app.use(
  "/converted",
  express.static(convertedDir, {
    fallthrough: true,
    maxAge: "1h",
  })
);

app.use(
  "/personalPics",
  express.static(personalPicsDir, {
    fallthrough: true,
    maxAge: "1h",
  })
);

// Convert endpoint with comprehensive error handling
app.post("/convert", (req, res) => {
  console.log("Received conversion request");

  upload(req, res, async function (err) {
    if (err instanceof multer.MulterError) {
      console.error("Multer error:", err);
      return res.status(400).json({
        success: false,
        error: "File upload error",
        details: err.message,
      });
    } else if (err) {
      console.error("Upload error:", err);
      return res.status(400).json({
        success: false,
        error: err.message,
      });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No files uploaded",
      });
    }

    try {
      const convertedFiles = [];
      const errors = [];

      // Process files sequentially to avoid overwhelming the system
      for (const file of req.files) {
        try {
          console.log(`Processing file: ${file.filename}`);

          const outputFilename = `${path.basename(
            file.filename,
            path.extname(file.filename)
          )}.jpg`;
          const outputPath = path.join(convertedDir, outputFilename);

          await convertHeicToJpg(file.path, outputPath);

          convertedFiles.push({
            originalName: file.originalname,
            convertedName: outputFilename,
            downloadUrl: `/converted/${outputFilename}`,
            size: (await fs.stat(outputPath)).size,
          });

          // Clean up original file
          await fs.unlink(file.path);
          console.log(`Successfully converted: ${file.filename}`);
        } catch (error) {
          console.error(`Error processing ${file.filename}:`, error);
          errors.push({
            file: file.originalname,
            error: error.message,
          });

          // Attempt to clean up failed file
          try {
            await fs.unlink(file.path);
          } catch (cleanupError) {
            console.error("Cleanup error:", cleanupError);
          }
        }
      }

      res.json({
        success: convertedFiles.length > 0,
        convertedCount: convertedFiles.length,
        totalFiles: req.files.length,
        files: convertedFiles,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (error) {
      console.error("Conversion process error:", error);
      res.status(500).json({
        success: false,
        error: "Conversion process failed",
        details: error.message,
      });
    }
  });
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "healthy" });
});

// Generic error handling middleware
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({
    success: false,
    error: "Internal server error",
    details: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
});

// Initialize server
async function startServer() {
  try {
    await initializeDirectories();

    app.listen(port, () => {
      console.log(`Server running on http://localhost:${port}`);
      console.log(`Upload directory: ${uploadDir}`);
      console.log(`Converted directory: ${convertedDir}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();
