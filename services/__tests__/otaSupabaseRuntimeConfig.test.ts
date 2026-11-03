jest.mock('expo/virtual/env', () => ({ env: process.env }), { virtual: true });

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ auth: {} })),
}));

jest.mock('expo-constants', () => ({
  expoConfig: {
    extra: {
      supabase: {
        url: 'https://runtime-config.example.supabase.co',
        anonKey: 'runtime-anon-key',
      },
    },
  },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

describe('Supabase client OTA runtime configuration', () => {
  const originalUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const originalAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

  beforeEach(() => {
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    jest.resetModules();
    jest.clearAllMocks();
  });

  afterAll(() => {
    if (originalUrl === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    else process.env.EXPO_PUBLIC_SUPABASE_URL = originalUrl;
    if (originalAnonKey === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = originalAnonKey;
  });

  test('creates the shared client from Expo manifest config when OTA env values are absent', () => {
    const { getSharedSupabaseClient } = require('../../template/core/client');
    const { createClient } = require('@supabase/supabase-js');

    const client = getSharedSupabaseClient();

    expect(client).toBeTruthy();
    expect(createClient).toHaveBeenCalledWith(
      'https://runtime-config.example.supabase.co',
      'runtime-anon-key',
      expect.objectContaining({
        auth: expect.objectContaining({
          autoRefreshToken: true,
          persistSession: true,
          flowType: 'pkce',
        }),
      }),
    );
  });
});
