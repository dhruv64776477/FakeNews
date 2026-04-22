import { Router } from "express";
import { detectFakeNews } from "../controllers/detectController.js";

const router = Router();

/**
 * POST /api/detect
 * Body: { articleText: string }
 */
router.post("/", detectFakeNews);

export default router;
