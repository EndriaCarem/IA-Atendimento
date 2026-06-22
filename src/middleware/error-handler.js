import { logger } from "../lib/logger.js";
import { AppError } from "../utils/http-error.js";

export function notFoundHandler(req, res) {
  res.status(404).json({
    error: "Route not found"
  });
}

export function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof AppError) {
    logger.error(
      { err, statusCode: err.statusCode, details: err.details, path: req.path },
      "AppError"
    );
    res.status(err.statusCode).json({
      error: err.message,
      details: err.details
    });
    return;
  }

  logger.error(
    {
      err,
      path: req.path,
      method: req.method
    },
    "Unhandled error"
  );

  res.status(500).json({
    error: "Internal server error"
  });
}
