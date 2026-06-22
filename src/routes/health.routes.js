import { Router } from "express";

const router = Router();

router.get("/", (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "iaclin-whatsapp-secretary",
    timestamp: new Date().toISOString()
  });
});

export default router;
