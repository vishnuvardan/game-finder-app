"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const config_1 = require("./config");
const api_routes_1 = __importDefault(require("./routes/api.routes"));
const app = (0, express_1.default)();
// Configure CORS to allow access from the frontend
app.use((0, cors_1.default)());
// Parse JSON request bodies
app.use(express_1.default.json());
// Register API routes under /api
app.use('/api', api_routes_1.default);
// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});
// Start the Express server only if running locally
if (!process.env.VERCEL) {
    app.listen(config_1.config.port, () => {
        console.log(`==================================================`);
        console.log(` Game Finder BFF running at http://localhost:${config_1.config.port}`);
        console.log(`==================================================`);
    });
}
exports.default = app;
