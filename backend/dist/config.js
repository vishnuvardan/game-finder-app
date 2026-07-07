"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
// Load environment variables from .env file
dotenv_1.default.config({ path: path_1.default.resolve(__dirname, '../.env') });
exports.config = {
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
const missingVars = [];
if (!exports.config.igdb.clientId)
    missingVars.push('IGDB_CLIENT_ID');
if (!exports.config.igdb.clientSecret)
    missingVars.push('IGDB_CLIENT_SECRET');
if (!exports.config.gemini.apiKey)
    missingVars.push('GEMINI_API_KEY');
if (missingVars.length > 0) {
    console.warn(`WARNING: Missing environment variables: ${missingVars.join(', ')}`);
}
