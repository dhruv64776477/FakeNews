import mongoose from "mongoose";

const connectDB = async (ConnectString) => {
  if (!ConnectString) {
    throw new Error("MongoDB connection string is undefined. Check your .env file.");
  }

  await mongoose.connect(ConnectString, {
    writeConcern: { w: "majority" },
  });
  console.log("Successfully connected to MongoDB!");
};

export default connectDB;