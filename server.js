require("dotenv").config({
  path: process.env.NODE_ENV === "production" ? ".env.production" : ".env",
});
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs").promises;
const { convertHeicToJpg } = require("./heicconvert");

const app = express();
const port = process.env.PORT || 3001;

console.log("Starting server with configuration:", {
  NODE_ENV: process.env.NODE_ENV,
  PORT: port,
  FRONTEND_URL: process.env.FRONTEND_URL,
  RENDER_MOUNT_DIR: process.env.RENDER_MOUNT_DIR,
});

const allowedOrigins = [
  "http://localhost:5173", // Development
  "https://dropheic-woad.vercel.app", // Production
  "https://dropheic-woad.vercel.app/", // Production with trailing slash
];

// Helper function for persistent paths
const getPersistentPath = (relativePath) => {
  const basePath = process.env.RENDER_MOUNT_DIR || __dirname;
  return path.join(basePath, relativePath);
};

// Updated directory paths for Render
const uploadDir = getPersistentPath("uploads");
const convertedDir = getPersistentPath("converted");

// Updated CORS for production
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);

      if (
        allowedOrigins.indexOf(origin) !== -1 ||
        process.env.NODE_ENV === "development"
      ) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
const getConfig = () => ({
  isDevelopment: process.env.NODE_ENV === "development",
  isProduction: process.env.NODE_ENV === "production",
  frontendUrl: process.env.FRONTEND_URL,
  port: process.env.PORT || 3001,
  maxFileSize: process.env.MAX_FILE_SIZE || 10 * 1024 * 1024, // 10MB default
});

// Ensure directories exist
async function initializeDirectories() {
  try {
    await fs.mkdir(uploadDir, { recursive: true });
    await fs.mkdir(convertedDir, { recursive: true });
    console.log("Directories initialized successfully:", {
      uploadDir,
      convertedDir,
    });
  } catch (error) {
    console.error("Error creating directories:", error);
    process.exit(1);
  }
}

// Add cleanup routine for temporary files
async function cleanupOldFiles() {
  try {
    const ONE_HOUR = 60 * 60 * 1000;

    // Cleanup uploads directory
    const uploadFiles = await fs.readdir(uploadDir);
    for (const file of uploadFiles) {
      const filePath = path.join(uploadDir, file);
      const stats = await fs.stat(filePath);
      if (Date.now() - stats.mtime.getTime() > ONE_HOUR) {
        await fs.unlink(filePath);
      }
    }

    // Cleanup converted directory
    const convertedFiles = await fs.readdir(convertedDir);
    for (const file of convertedFiles) {
      const filePath = path.join(convertedDir, file);
      const stats = await fs.stat(filePath);
      if (Date.now() - stats.mtime.getTime() > ONE_HOUR) {
        await fs.unlink(filePath);
      }
    }
  } catch (error) {
    console.error("Cleanup error:", error);
  }
}

// Run cleanup every hour
setInterval(cleanupOldFiles, 60 * 60 * 1000);

// Multer configuration
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.]/g, "-");
    const fileName = `${Date.now()}-${sanitizedName}`;
    cb(null, fileName);
  },
});

const upload = multer({
  storage: storage,
  fileFilter: function (req, file, cb) {
    console.log("Received file:", file.originalname);
    if (/\.(heic|heif)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error("Only HEIC/HEIF files are allowed"));
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
}).array("files", 10);

// Serve static files
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

// Convert endpoint
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

      // Process files sequentially
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

          // Clean up failed file
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

// File check endpoint
app.get("/check-files", async (req, res) => {
  try {
    const [uploadFiles, convertedFiles] = await Promise.all([
      fs.readdir(uploadDir),
      fs.readdir(convertedDir),
    ]);

    res.json({
      status: "healthy",
      uploadFiles,
      convertedFiles,
      directories: {
        uploadDir,
        convertedDir,
      },
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      error: error.message,
    });
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  const config = getConfig();
  res.json({
    status: "healthy",
    environment: process.env.NODE_ENV,
    frontendUrl: config.frontendUrl,
    timestamp: new Date().toISOString(),
  });
});

// Error handling middleware
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

    app.listen(port, "0.0.0.0", () => {
      console.log(`Server started successfully`);
      console.log(`Environment: ${process.env.NODE_ENV}`);
      console.log(`Listening on port: ${port}`);
      console.log(`Frontend URL: ${process.env.FRONTEND_URL}`);
      console.log(`Upload directory: ${uploadDir}`);
      console.log(`Converted directory: ${convertedDir}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();
