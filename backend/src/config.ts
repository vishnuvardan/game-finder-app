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
};

// Validate that required variables are defined
const missingVars: string[] = [];
if (!config.igdb.clientId) missingVars.push('IGDB_CLIENT_ID');
if (!config.igdb.clientSecret) missingVars.push('IGDB_CLIENT_SECRET');
if (!config.gemini.apiKey) missingVars.push('GEMINI_API_KEY');

if (missingVars.length > 0) {
  console.warn(`WARNING: Missing environment variables: ${missingVars.join(', ')}`);
}
