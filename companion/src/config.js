export function loadConfig() {
  const REGION = process.env.REGION || 'eu'
  const REALM_SLUGS = (process.env.REALM_SLUGS || 'twilightshammer').split(',').map(s => s.trim())
  const PORT = parseInt(process.env.PORT || '4317', 10)

  return {
    REGION,
    REALM_SLUGS,
    PORT,
    BLIZZARD_CLIENT_ID: process.env.BLIZZARD_CLIENT_ID || '',
    BLIZZARD_CLIENT_SECRET: process.env.BLIZZARD_CLIENT_SECRET || '',
    TSM_API_KEY: process.env.TSM_API_KEY || '',
    TSM_ACCESS_TOKEN: process.env.TSM_ACCESS_TOKEN || '',
    // Optional external price source endpoints
    TSM_API_URL: process.env.TSM_API_URL || '',
    TSM_BASE_URL: process.env.TSM_BASE_URL || '',
    TUJ_API_URL: process.env.TUJ_API_URL || '',
    NEXUSHUB_API_URL: process.env.NEXUSHUB_API_URL || '',
    DISABLE_NEXUSHUB: String(process.env.DISABLE_NEXUSHUB || '').toLowerCase() === '1' || String(process.env.DISABLE_NEXUSHUB || '').toLowerCase() === 'true',
    NEXUSHUB_REGION_SALES_URL: process.env.NEXUSHUB_REGION_SALES_URL || '',
    // TTLs (seconds)
    INTEGRATIONS_TTL: parseInt(process.env.INTEGRATIONS_TTL || '900', 10),
    DISCORD_WEBHOOK_URL: process.env.DISCORD_WEBHOOK_URL || '',
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '',
    SLACK_WEBHOOK_URL: process.env.SLACK_WEBHOOK_URL || '',
  }
}
