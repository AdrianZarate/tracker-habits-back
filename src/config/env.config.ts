export const DEFAULT_PORT = 3000;

export const envConfig = () => ({
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  MONGODB: process.env.MONGODB,
  PORT:
    process.env.PORT === undefined ? DEFAULT_PORT : Number(process.env.PORT),
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  JWT_SECRET: process.env.JWT_SECRET,
});
