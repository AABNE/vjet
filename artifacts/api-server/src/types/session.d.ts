import "express-session";
import "express";

declare module "express-session" {
  interface SessionData {
    userId: number;
  }
}

declare global {
  namespace Express {
    interface Request {
      // Raw request body captured by express.json({ verify }).
      // Needed to verify Discord's Ed25519 interaction signatures.
      rawBody?: Buffer;
    }
  }
}
