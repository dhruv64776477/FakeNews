import express from "express";
import path from "path";
import "express-async-errors";
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { globalMiddleware } from "./middlewares/globalMiddelware.js";
import { notFound } from "./middlewares/notFound.js";
import { ErrorHandler } from "./middlewares/customError.js";
import { PORT, MONGO_URI } from "./constants.js";
import connectDB from "./config/connectDB.js";
import detectRouter from "./routes/detect.js";

const app = express();
const ConnectionString = MONGO_URI;

// Apply security middlewares
globalMiddleware(app);

// ── Routes ────────────────────────────────────────────────────────────────
app.use("/api/detect", detectRouter);







// 404 Not Found Middleware (MUST be after all valid routes)
app.use(notFound);

// Global Error Handler (Prevents crashes)
app.use(ErrorHandler);

const startServer = async () => {
  // Start Express regardless of DB status
  app.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}...`);
  });

  // Attempt DB connection (optional — not required for detection pipeline)
  if (ConnectionString) {
    try {
      await connectDB(ConnectionString);
    } catch (error) {
      console.warn("⚠️  MongoDB unavailable — running without DB (detection pipeline still works).");
    }
  } else {
    console.warn("⚠️  MONGO_URI not set — running without DB (detection pipeline still works).");
  }
};

startServer();
