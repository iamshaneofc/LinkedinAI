/**
 * Centralized Configuration Management
 * 
 * This module exports all configuration values for the application.
 * It loads environment variables and provides typed access to config.
 */

// Load environment variables
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../../.env") });
import databaseConfig from './database.js';
import constants from './constants.js';

const config = {
  // Server Configuration
  server: {
    port: process.env.PORT || 3000,
    env: process.env.NODE_ENV || 'development',
    cors: {
      enabled: true,
      origin: process.env.CORS_ORIGIN || '*'
    }
  },

  // Database Configuration
  database: databaseConfig,

  // PhantomBuster Configuration
  phantombuster: {
    apiKey: process.env.PHANTOMBUSTER_API_KEY,
    apiUrl: 'https://api.phantombuster.com/api/v2',
    phantomIds: {
      connectionsExport: process.env.CONNECTIONS_EXPORT_PHANTOM_ID,
      searchExport: process.env.SEARCH_EXPORT_PHANTOM_ID || process.env.SEARCH_LEADS_PHANTOM_ID, // LinkedIn Search Export
      profileScraper: process.env.PROFILE_SCRAPER_PHANTOM_ID,
      linkedinOutreach: process.env.LINKEDIN_OUTREACH_PHANTOM_ID ||
        process.env.PHANTOM_CONNECT_ID ||
        process.env.PHANTOM_NETWORK_BOOSTER_ID ||
        process.env.AUTO_CONNECT_PHANTOM_ID,
      messageSender: process.env.PHANTOM_MESSAGE_SENDER_ID ||
        process.env.LINKEDIN_MESSAGE_PHANTOM_ID ||
        process.env.MESSAGE_SENDER_PHANTOM_ID
    },
    sessionCookie: process.env.LINKEDIN_SESSION_COOKIE
  },

  // Hunter.io Configuration
  hunter: {
    apiKey: process.env.HUNTER_API_KEY
  },

  // AI Configuration (model is read from env on each request in ai.service.js for global Settings sync)
  ai: {
    provider: process.env.AI_PROVIDER || 'openai',
    openai: {
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL || 'gpt-4o'
    },
    claude: {
      model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-5'
    }
  },

  // Email Configuration
  email: {
    provider: process.env.EMAIL_PROVIDER || 'sendgrid',
    sendgrid: {
      apiKey: process.env.SENDGRID_API_KEY
    },
    ses: {
      region: process.env.AWS_REGION || 'us-east-1',
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    },
    from: {
      email: process.env.EMAIL_FROM || 'noreply@example.com',
      name: process.env.EMAIL_FROM_NAME || 'LinkedIn Automation Engine'
    }
  },

  // Application Constants
  constants: constants,

  // Feature Flags
  features: {
    scheduler: {
      enabled: process.env.SCHEDULER_ENABLED !== 'false',
      interval: process.env.SCHEDULER_INTERVAL || '1 * * * *' // Every minute
    },
    approval: {
      enabled: process.env.APPROVAL_ENABLED !== 'false'
    }
  },

  // Branding Configuration
  branding: {
    userName: process.env.APP_USER_NAME || '',
    companyName: process.env.APP_COMPANY_NAME || 'Scottish Chemical Industries',
    logoUrl: process.env.APP_LOGO_URL || '/logo.jpg',
    profileImageUrl: process.env.APP_PROFILE_IMAGE_URL || '',
    theme: process.env.APP_THEME || 'default'
  }
};

// Validation
function validateConfig() {
  const required = [
    'database.host',
    'database.database',
    'database.user',
    'database.password'
  ];

  const missing = required.filter(key => {
    const keys = key.split('.');
    let value = config;
    for (const k of keys) {
      value = value[k];
      if (!value) return true;
    }
    return false;
  });

  if (missing.length > 0) {
    console.warn('⚠️  Missing required configuration:', missing.join(', '));
  }
}

// Validate on load
validateConfig();

export default config;
