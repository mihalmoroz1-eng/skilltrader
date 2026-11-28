// Platform values are read at use time. See the Webdev service/authentication skills.
export const ENV = {
  get appId() { return process.env.MANUS_PROJECT_ID ?? "skilltrader"; },
  get cookieSecret() { return process.env.AUTH_SESSION_SECRET ?? process.env.MANUS_JWT_SECRET ?? ""; },
  get adminEmail() { return process.env.SKILL_TRADER_ADMIN_EMAIL ?? ""; },
  get adminPasswordHash() { return process.env.SKILL_TRADER_ADMIN_PASSWORD_HASH ?? ""; },
  get databaseUrl() { return process.env.DATABASE_URL ?? ""; },
  get oAuthServerUrl() { return process.env.MANUS_OAUTH_API_URL ?? ""; },
  // Preserve the legacy hint when supplied; otherwise roles remain application data.
  get ownerOpenId() { return process.env.OWNER_OPEN_ID ?? ""; },
  get isProduction() { return process.env.NODE_ENV === "production"; },
  get forgeApiUrl() { return process.env.MANUS_API_URL ?? ""; },
  get forgeApiKey() { return process.env.MANUS_API_KEY ?? ""; },
};
