export interface Env {
  OWNER_PASSWORD: string;
  FRIEND_PASSWORD: string;
  SESSION_SECRET: string;
  ENCRYPTION_KEY: string;
  APP_ENV?: string;
  ASSETS?: Fetcher;
  DB: D1Database;
  BUCKET: R2Bucket;
}

export type AppEnv = {
  Bindings: Env;
  Variables: {
    role?: import("./lib/session").Role;
  };
};
