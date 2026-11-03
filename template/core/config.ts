// @ts-nocheck
import { OnSpaceConfig } from './types';
import Constants from 'expo-constants';

function getPublicSupabaseConfig() {
  const runtimeConfig = (Constants.expoConfig?.extra as any)?.supabase;
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL || runtimeConfig?.url;
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || runtimeConfig?.anonKey;
  return url && anonKey ? { url, anonKey } : null;
}

class ConfigManager {
  private static instance: ConfigManager;
  private config: OnSpaceConfig | null = null;

  private constructor() {}

  public static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  public initialize(config: OnSpaceConfig) {
    if (this.config) {
      console.warn('[Template:Config] Configuration already set, updating...');
    }
    
    this.config = { ...config };
  }

  public getConfig(): OnSpaceConfig {
    if (!this.config) {
      this.config = this.createDefaultConfig();
    }
    return { ...this.config };
  }

  private createDefaultConfig(): OnSpaceConfig {
    const supabaseConfig = getPublicSupabaseConfig();
    const authConfig = supabaseConfig
      ? { enabled: true, profileTableName: 'user_profiles' }
      : false;
    if (!supabaseConfig) {
      console.error('[Template:Config] Missing public Supabase runtime configuration. Check EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in the app build environment.');
    }

    return {
      ...(supabaseConfig && { supabase: supabaseConfig }),
      auth: authConfig,
      payments: false,
      storage: false,
    };
  }

  public getModuleConfig<T = any>(moduleName: string): T | null {
    const config = this.getConfig();
    return (config as any)[moduleName] || null;
  }

  public isModuleEnabled(moduleName: string): boolean {
    const moduleConfig = this.getModuleConfig(moduleName);
    return moduleConfig !== false && moduleConfig !== null;
  }

  public getSupabaseConfig() {
    return this.getConfig().supabase;
  }

  public updateConfig(updates: Partial<OnSpaceConfig>) {
    const config = this.getConfig();
    this.config = { ...config, ...updates };
  }
}

export const configManager = ConfigManager.getInstance();

interface CreateConfigOptions {
  auth?: {
    enabled?: boolean;
    profileTableName?: string;
  } | false;
  supabase?: {
    url?: string;
    anonKey?: string;
  };
}

export const createConfig = (options: CreateConfigOptions = {}): OnSpaceConfig => {
  let authConfig;
  if (options.auth === false) {
    authConfig = false;
  } else if (options.auth === undefined) {
    authConfig = {
      enabled: true,
      profileTableName: 'user_profiles',
    };
  } else if (typeof options.auth === 'object') {
    authConfig = {
      enabled: true,
      profileTableName: 'user_profiles',
      ...options.auth,
    };
  }

  let supabaseConfig;
  if (authConfig !== false) {
    supabaseConfig = getPublicSupabaseConfig();
    if (!supabaseConfig) {
      console.error('[Template:Config] Auth requested but public Supabase runtime configuration is missing.');
      authConfig = false;
    }
  }

  return {
    ...(supabaseConfig && { supabase: supabaseConfig }),
    auth: authConfig,
    payments: false,
    storage: false,
  };
};