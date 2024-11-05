// heicConvert.js
const fs = require("fs").promises;
const path = require("path");
const heicConvert = require("heic-convert");
const sharp = require("sharp");

async function convertHeicToJpg(inputPath, outputPath) {
  try {
    const inputBuffer = await fs.readFile(inputPath);

    // Convert HEIC to JPEG buffer
    const heicBuffer = await heicConvert({
      buffer: inputBuffer,
      format: "JPEG",
      quality: 1,
    });

    // Process with sharp
    await sharp(heicBuffer).jpeg({ quality: 90 }).toFile(outputPath);

    return {
      success: true,
      outputPath,
    };
  } catch (error) {
    console.error(`Error converting ${inputPath}: ${error.message}`);
    return {
      success: false,
      error: error.message,
    };
  }
}

module.exports = { convertHeicToJpg };
