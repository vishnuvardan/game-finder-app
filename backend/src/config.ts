import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env file
dotenv.config({ path: path.resolve(__dirname, '../.env') });

export const config = {
  port: process.env.PORT || 3000,
  igdb: {
    clientId: process.env.IGDB_CLIENT_ID || '',
    clientSecret: process.env.IGDB_CLIENT_SECRET || '',
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
  },
  steam: {
    apiKey: process.env.STEAM_API_KEY || '',
  },
  serper: {
    apiKey: process.env.SERPER_API_KEY || '',
  },
  unsplash: {
    accessKey: process.env.UNSPLASH_ACCESS_KEY || '',
    secretKey: process.env.UNSPLASH_SECRET_KEY || '',
  },
  instagram: {
    userId: process.env.IG_USER_ID || '',
    accessToken: process.env.META_ACCESS_TOKEN || '',
    adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
  },
  vercelBlob: {
    readWriteToken: process.env.BLOB_READ_WRITE_TOKEN || '',
  },
};

// Validate that required variables are defined
const missingVars: string[] = [];
if (!config.igdb.clientId) missingVars.push('IGDB_CLIENT_ID');
if (!config.igdb.clientSecret) missingVars.push('IGDB_CLIENT_SECRET');
if (!config.gemini.apiKey) missingVars.push('GEMINI_API_KEY');
if (!config.steam.apiKey) missingVars.push('STEAM_API_KEY');
if (!config.serper.apiKey) missingVars.push('SERPER_API_KEY');

if (missingVars.length > 0) {
  console.warn(`WARNING: Missing environment variables: ${missingVars.join(', ')}`);
}
