// src/logger.ts — pino estruturado
import { pino } from 'pino';
import { config } from './config.js';

export const logger = pino({
  level: config.LOG_LEVEL,
  transport:
    config.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss.l',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
  redact: {
    paths: [
      '*.access_token',
      '*.refresh_token',
      'req.headers.authorization',
      'authorization',
      'password',
      '*.password',
    ],
    censor: '[REDACTED]',
  },
});