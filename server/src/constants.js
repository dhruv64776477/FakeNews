import dotenv from "dotenv";
dotenv.config();

export const PORT = process.env.PORT || 5000;
export const CORS_ORIGEN = process.env.CORS_ORIGEN;
export const MONGO_URI = process.env.MONGO_URI;
export const JWT_SECRET = process.env.JWT_SECRET;
export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
export const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
export const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL;
export const JWT_ALGORITHM = process.env.JWT_ALGORITHM;
export const JWT_EXPIRATION = process.env.JWT_EXPIRATION;

// Fake News Detection
export const SERPAPI_KEY = process.env.SERPAPI_KEY || "your_serpapi_key_here";
export const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:8000";
