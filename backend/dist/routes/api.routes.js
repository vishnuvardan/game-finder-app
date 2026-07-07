"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const igdb_service_1 = require("../services/igdb.service");
const gemini_service_1 = require("../services/gemini.service");
const router = (0, express_1.Router)();
/**
 * GET /api/games/search?q=...
 * Query IGDB for games by search text
 */
router.get('/games/search', async (req, res) => {
    const query = req.query.q;
    if (!query || query.trim() === '') {
        return res.status(400).json({ error: 'Search query parameter "q" is required' });
    }
    try {
        const results = await igdb_service_1.igdbService.searchGames(query);
        return res.json(results);
    }
    catch (error) {
        console.error('Search router error:', error.message);
        return res.status(500).json({ error: error.message });
    }
});
/**
 * GET /api/games/by-title?title=...
 * Retrieve precise game details from IGDB using game title
 */
router.get('/games/by-title', async (req, res) => {
    const title = req.query.title;
    if (!title || title.trim() === '') {
        return res.status(400).json({ error: 'Query parameter "title" is required' });
    }
    try {
        const result = await igdb_service_1.igdbService.getGameByTitle(title);
        if (!result) {
            return res.status(404).json({ error: `Game not found with title: ${title}` });
        }
        return res.json(result);
    }
    catch (error) {
        console.error('By-title router error:', error.message);
        return res.status(500).json({ error: error.message });
    }
});
/**
 * POST /api/quiz/generate
 * Payload: { favoriteGames: Array<{ name: string, genres: string[] }> }
 * Generates exactly 5 quiz questions.
 */
router.post('/quiz/generate', async (req, res) => {
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
        const quiz = await gemini_service_1.geminiService.generateQuiz(favoriteGames);
        return res.json(quiz);
    }
    catch (error) {
        console.error('Quiz generation router error:', error.message);
        return res.status(500).json({ error: error.message });
    }
});
/**
 * POST /api/quiz/recommend
 * Payload: { favoriteGames: Array, quizAnswers: Array<{ questionId: string, answer: string }> }
 * Returns a recommended game and custom reasoning.
 */
router.post('/quiz/recommend', async (req, res) => {
    const { favoriteGames, quizAnswers } = req.body;
    if (!favoriteGames || !Array.isArray(favoriteGames)) {
        return res.status(400).json({ error: 'favoriteGames must be an array' });
    }
    if (!quizAnswers || !Array.isArray(quizAnswers)) {
        return res.status(400).json({ error: 'quizAnswers must be an array of question responses' });
    }
    try {
        const recommendation = await gemini_service_1.geminiService.recommendGame(favoriteGames, quizAnswers);
        return res.json(recommendation);
    }
    catch (error) {
        console.error('Recommendation router error:', error.message);
        return res.status(500).json({ error: error.message });
    }
});
exports.default = router;
