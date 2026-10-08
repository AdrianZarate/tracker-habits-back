import * as Joi from 'joi';
import { DEFAULT_PORT } from './env.config';

export const joiValidationSchema = Joi.object({
  MONGODB: Joi.string().required(),
  PORT: Joi.number().integer().min(1).max(65535).default(DEFAULT_PORT),
  GOOGLE_CLIENT_ID: Joi.string().required(),
  JWT_SECRET: Joi.string().pattern(/\S/).required(),
});
