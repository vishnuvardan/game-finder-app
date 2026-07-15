import { Router, Request, Response } from 'express';
import { igdbService } from '../services/igdb.service';
import { geminiService } from '../services/gemini.service';
import { steamService } from '../services/steam.service';
import { cacheService } from '../services/cache.service';

const router = Router();

/**
 * GET /api/games/search?q=...
 * Query IGDB for games by search text
 */
router.get('/games/search', async (req: Request, res: Response) => {
  const query = req.query.q as string;
  const source = req.query.source as string;

  if (!query || query.trim() === '') {
    return res.status(400).json({ error: 'Search query parameter "q" is required' });
  }

  try {
    if (source === 'igdb') {
      const results = await igdbService.searchGames(query);
      return res.json(results);
    } else {
      const results = await steamService.searchGames(query);
      return res.json(results);
    }
  } catch (error: any) {
    console.error('Search router error:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/games/by-title?title=...
 * Retrieve precise game details from IGDB using game title
 */
router.get('/games/by-title', async (req: Request, res: Response) => {
  const title = req.query.title as string;

  if (!title || title.trim() === '') {
    return res.status(400).json({ error: 'Query parameter "title" is required' });
  }

  try {
    const result = await igdbService.getGameByTitle(title);
    if (!result) {
      return res.status(404).json({ error: `Game not found with title: ${title}` });
    }
    return res.json(result);
  } catch (error: any) {
    console.error('By-title router error:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/quiz/generate
 * Payload: { favoriteGames: Array<{ name: string, genres: string[] }> }
 * Generates exactly 5 quiz questions.
 */
router.post('/quiz/generate', async (req: Request, res: Response) => {
  const { favoriteGames } = req.body;

  if (!favoriteGames || !Array.isArray(favoriteGames)) {
    return res.status(400).json({ error: 'favoriteGames must be an array of games' });
  }

  if (favoriteGames.length !== 3) {
    return res.status(400).json({ error: 'Must provide exactly 3 favorite games' });
  }

  // Validate item structure
  for (const game of favoriteGames) {
    if (!game.name || typeof game.name !== 'string') {
      return res.status(400).json({ error: 'Each game must have a string name' });
    }
    if (!game.genres || !Array.isArray(game.genres)) {
      return res.status(400).json({ error: 'Each game must have a genres array of strings' });
    }
  }

  try {
    const quiz = await geminiService.generateQuiz(favoriteGames);
    return res.json(quiz);
  } catch (error: any) {
    console.error('Quiz generation router error:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/quiz/recommend
 * Payload: { favoriteGames: Array, quizAnswers: Array<{ questionId: string, answer: string }> }
 * Returns a recommended game and custom reasoning.
 */
router.post('/quiz/recommend', async (req: Request, res: Response) => {
  const { favoriteGames, quizAnswers } = req.body;

  if (!favoriteGames || !Array.isArray(favoriteGames)) {
    return res.status(400).json({ error: 'favoriteGames must be an array' });
  }

  if (!quizAnswers || !Array.isArray(quizAnswers)) {
    return res.status(400).json({ error: 'quizAnswers must be an array of question responses' });
  }

  try {
    const recommendation = await geminiService.recommendGame(favoriteGames, quizAnswers);
    return res.json(recommendation);
  } catch (error: any) {
    console.error('Recommendation router error:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/retrospective/departments
 * Payload: { gameName: string, genres: string[] }
 * Returns dynamic departments (metrics) for the specified game.
 */
router.post('/retrospective/departments', async (req: Request, res: Response) => {
  const { gameName, genres } = req.body;

  if (!gameName || typeof gameName !== 'string') {
    return res.status(400).json({ error: 'gameName must be a string' });
  }

  if (!genres || !Array.isArray(genres)) {
    return res.status(400).json({ error: 'genres must be an array of strings' });
  }

  try {
    const result = await geminiService.generateRetrospectiveDepartments(gameName, genres);
    return res.json(result);
  } catch (error: any) {
    console.error('Retrospective departments generation router error:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/retrospective/finalize
 * Payload: { reviewerName: string, gameName: string, ratings: Array<{ department: string, stars: number, label: string }> }
 * Returns a witty, first-person social media review draft based on the ratings.
 */
router.post('/retrospective/finalize', async (req: Request, res: Response) => {
  const { reviewerName, gameName, ratings } = req.body;

  if (!reviewerName || typeof reviewerName !== 'string') {
    return res.status(400).json({ error: 'reviewerName must be a string' });
  }

  if (!gameName || typeof gameName !== 'string') {
    return res.status(400).json({ error: 'gameName must be a string' });
  }

  if (!ratings || !Array.isArray(ratings)) {
    return res.status(400).json({ error: 'ratings must be an array' });
  }

  try {
    const reviewDraft = await geminiService.generateReviewDraft(reviewerName, gameName, ratings);
    return res.json({ reviewDraft });
  } catch (error: any) {
    console.error('Retrospective review draft generation router error:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/games/:appid
 * Retrieve game details (name, background image) from Steam
 */
router.get('/games/:appid', async (req: Request, res: Response) => {
  const { appid } = req.params;

  try {
    // Check achievements cache first, which also stores the gameName
    let cached = cacheService.getAchievements(appid);
    if (!cached) {
      // If cache miss, fetch schema from Steam and cache it
      const schema = await steamService.getGameSchema(appid);
      cacheService.setAchievements(appid, schema);
      cached = schema;
    }

    return res.json({
      name: cached.gameName || 'Unknown Game',
      background_image: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`
    });
  } catch (error: any) {
    console.error('Game details fetch router error:', error.message);
    return res.json({
      name: 'Steam Game ' + appid,
      background_image: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`
    });
  }
});

/**
 * GET /api/games/:appid/achievements
 * Retrieve achievements from Steam API
 */
router.get('/games/:appid/achievements', async (req: Request, res: Response) => {
  const { appid } = req.params;

  try {
    // Check cache first
    let cached = cacheService.getAchievements(appid);
    if (!cached) {
      // Cache miss, fetch and cache
      const schema = await steamService.getGameSchema(appid);
      cacheService.setAchievements(appid, schema);
      cached = schema;
    }

    if (!cached.achievements) {
      // "availableGameStats" is undefined -> return 404 with specific message
      return res.status(404).json({ error: 'This game does not feature Steam achievements' });
    }

    return res.json(cached.achievements);
  } catch (error: any) {
    console.error('Achievements fetch router error:', error.message);
    if (error.message.includes('No game data returned') || error.message.includes('404')) {
      return res.status(404).json({ error: 'This game does not feature Steam achievements' });
    }
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/trophies/guide
 * Generate structured Gemini walkthrough for the given trophy, utilizing a local file-based cache.
 */
router.post('/trophies/guide', async (req: Request, res: Response) => {
  const { gameName, trophyName, trophyDescription } = req.body;

  if (!gameName || typeof gameName !== 'string') {
    return res.status(400).json({ error: 'gameName must be a string' });
  }
  if (!trophyName || typeof trophyName !== 'string') {
    return res.status(400).json({ error: 'trophyName must be a string' });
  }

  try {
    // 1. Check local cache first
    const cached = cacheService.get(gameName, trophyName);
    if (cached) {
      return res.json(cached);
    }

    // 2. Generate new guide
    const guide = await geminiService.generateTrophyGuide(gameName, trophyName, trophyDescription || '');

    // 3. Save to cache
    cacheService.set(gameName, trophyName, guide);

    return res.json(guide);
  } catch (error: any) {
    console.error('Trophy guide generation router error:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

export default router;
