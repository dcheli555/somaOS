import { clerkMiddleware } from "@clerk/express";
import express from "express";
import { medicationsApiRouter } from "./routes/medications";
import { requestContextMiddleware } from "./middleware/requestContext";
import { requestLoggingMiddleware } from "./middleware/requestLogging";
import { healthRouter } from "./routes/health";

export function createApp() {
  const app = express();

  app.use(requestContextMiddleware);
  app.use(requestLoggingMiddleware);
  app.use(express.json());
  app.use(healthRouter);
  app.use(clerkMiddleware());
  app.use("/api", medicationsApiRouter);

  return app;
}
