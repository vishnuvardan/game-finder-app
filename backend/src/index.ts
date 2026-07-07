import express from 'express';
import cors from 'cors';
import { config } from './config';
import apiRouter from './routes/api.routes';

const app = express();

// Configure CORS to allow access from the frontend
app.use(cors());

// Parse JSON request bodies
app.use(express.json());

// Register API routes under /api
app.use('/api', apiRouter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Start the Express server only if running locally
if (!process.env.VERCEL) {
  app.listen(config.port, () => {
    console.log(`==================================================`);
    console.log(` Game Finder BFF running at http://localhost:${config.port}`);
    console.log(`==================================================`);
  });
}

export default app;
