export const envConfig = () => ({
  environment: process.env.NODE_ENV || 'development',
  mongodb: process.env.MONGODB,
  port: +process.env.PORT! || 3002,
});
