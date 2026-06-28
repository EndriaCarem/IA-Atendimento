import pino from "pino";
import { env } from "../config/env.js";

const isDev = env.NODE_ENV === "development";

export const logger = pino({
  level: isDev ? "debug" : "info", 
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(isDev && {
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "HH:MM:ss",
        ignore: "pid,hostname",
        messageFormat: "{msg}",
        singleLine: false
      }
    }
  })
});
