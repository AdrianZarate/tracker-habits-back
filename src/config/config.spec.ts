import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { envConfig } from './env.config';
import { joiValidationSchema } from './joi.validation';

const fixture = {
  MONGODB: 'mongodb://fixture.invalid/habits',
  GOOGLE_CLIENT_ID: 'fixture-client',
  JWT_SECRET: 'fixture-secret',
};

function validate(values: Record<string, unknown>) {
  return joiValidationSchema.validate(values, { allowUnknown: true });
}

describe('startup configuration (synthetic environment only)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...fixture };
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  it('maps canonical keys with the existing bootstrap default', () => {
    expect(envConfig()).toEqual({
      ...fixture,
      NODE_ENV: 'development',
      PORT: 3000,
    });
    expect(validate(fixture).value).toMatchObject({ PORT: 3000 });
  });

  it('preserves explicit environment values, including secret whitespace', () => {
    process.env.PORT = '4200';
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = ' fixture-secret ';
    expect(envConfig()).toEqual({
      ...fixture,
      PORT: 4200,
      NODE_ENV: 'production',
      JWT_SECRET: ' fixture-secret ',
    });
    expect(validate(process.env).value).toMatchObject({
      PORT: 4200,
      JWT_SECRET: ' fixture-secret ',
    });
  });

  it.each(['1', '65535', '4200'])('accepts port %s', (PORT) => {
    expect(validate({ ...fixture, PORT }).error).toBeUndefined();
  });

  it.each(['0', '-1', '65536', '3000.5', '', 'not-a-port'])(
    'rejects port %s',
    (PORT) => {
      expect(validate({ ...fixture, PORT }).error).toBeDefined();
    },
  );

  it.each(['MONGODB', 'GOOGLE_CLIENT_ID', 'JWT_SECRET'])(
    'requires %s',
    (key) => {
      const values: Record<string, string> = { ...fixture };
      delete values[key];
      expect(validate(values).error).toBeDefined();
      expect(validate({ ...fixture, [key]: '' }).error).toBeDefined();
    },
  );

  it('rejects a whitespace-only signing secret', () => {
    expect(validate({ ...fixture, JWT_SECRET: '  ' }).error).toBeDefined();
  });

  it.each([undefined, '', '  '])(
    'rejects startup with invalid signing secret %s before any database connection',
    async (secret) => {
      if (secret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = secret;
      await expect(
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          validationSchema: joiValidationSchema,
        }),
      ).rejects.toThrow('JWT_SECRET');
    },
  );

  it.each([undefined, '4200'])(
    'exposes validated values via ConfigService for port %s',
    async (port) => {
      if (port !== undefined) process.env.PORT = port;
      const module = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            ignoreEnvFile: true,
            skipProcessEnv: true,
            load: [envConfig],
            validationSchema: joiValidationSchema,
          }),
        ],
      }).compile();
      try {
        const config = module.get(ConfigService);
        expect(config.getOrThrow<number>('PORT')).toBe(
          port === undefined ? 3000 : 4200,
        );
        for (const [key, value] of Object.entries(fixture)) {
          expect(config.getOrThrow<string>(key)).toBe(value);
        }
      } finally {
        await module.close();
      }
    },
  );
});
