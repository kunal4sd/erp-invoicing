import winston from 'winston';

const { combine, timestamp, errors, json, colorize, simple } = winston.format;

const isDev = process.env.NODE_ENV !== 'production';

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: combine(
    timestamp(),
    errors({ stack: true }),
    isDev ? combine(colorize(), simple()) : json()
  ),
  transports: [new winston.transports.Console()],
});
