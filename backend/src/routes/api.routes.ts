import { Router, Request, Response } from 'express';
import { igdbService } from '../services/igdb.service';
import { geminiService } from '../services/gemini.service';
import { steamService } from '../services/steam.service';
import { cacheService } from '../services/cache.service';
import { config } from '../config';
import axios from 'axios';
import { EdgeTTS } from 'node-edge-tts';
import fs from 'fs';
import path from 'path';
import os from 'os';

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
 * GET /api/proxy-image
 * Proxies external images to bypass CORS restriction in browser canvas screenshots
 */
router.get('/proxy-image', async (req: Request, res: Response) => {
  const { url } = req.query;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url query parameter is required' });
  }

  let hostname = '';
  let targetUrl = url;

  try {
    const parsedUrl = new URL(url);
    hostname = parsedUrl.hostname.toLowerCase();
    
    // Normalize target URL to use https for security if possible
    if (parsedUrl.protocol === 'http:') {
      targetUrl = 'https://' + url.slice(7);
    }
  } catch (err) {
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  // Allow trusted steam image domains
  const isAllowedHost = 
    hostname === 'steamcdn-a.akamaihd.net' ||
    hostname === 'steamcommunity-a.akamaihd.net' ||
    hostname === 'media.steampowered.com' ||
    hostname === 'cdn.steamstatic.com' ||
    hostname.endsWith('.steamstatic.com') ||
    hostname === 'steamcommunity.com' ||
    hostname.endsWith('.steamcommunity.com') ||
    hostname === 'images.unsplash.com' ||
    hostname === 'placehold.co';

  if (!isAllowedHost) {
    return res.status(403).json({ error: 'Untrusted image domain' });
  }

  const requestHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  };

  try {
    const response = await axios.get(targetUrl, {
      responseType: 'arraybuffer',
      timeout: 5000,
      headers: requestHeaders
    });

    const contentTypeHeader = response.headers['content-type'];
    const contentType = typeof contentTypeHeader === 'string' ? contentTypeHeader : 'image/png';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(response.data);
  } catch (error: any) {
    console.error('Image proxy error fetching:', targetUrl, error.message);
    // If fetching targetUrl failed, retry with original url
    try {
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 5000,
        headers: requestHeaders
      });
      const contentTypeHeader = response.headers['content-type'];
      const contentType = typeof contentTypeHeader === 'string' ? contentTypeHeader : 'image/png';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.send(response.data);
    } catch (retryError: any) {
      console.error('Image proxy retry error fetching:', url, retryError.message);
      return res.status(500).json({ error: 'Failed to proxy image' });
    }
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

/**
 * POST /api/slides/generate
 * Payload: { gameName: string, gameSummary: string, genres: string[], topic: string }
 * Returns an array of dynamic slides for Instagram Carousel posts.
 */
router.post('/slides/generate', async (req: Request, res: Response) => {
  const { gameName, gameSummary, genres, topic } = req.body;

  if (gameName && typeof gameName !== 'string') {
    return res.status(400).json({ error: 'gameName must be a string' });
  }
  if (gameSummary && typeof gameSummary !== 'string') {
    return res.status(400).json({ error: 'gameSummary must be a string' });
  }
  if (genres && !Array.isArray(genres)) {
    return res.status(400).json({ error: 'genres must be an array of strings' });
  }
  if (!topic || typeof topic !== 'string') {
    return res.status(400).json({ error: 'topic must be a string' });
  }

  try {
    const result = await geminiService.generateSlides(gameName, gameSummary, genres, topic);
    return res.json(result);
  } catch (error: any) {
    console.error('Slides generation router error:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/slides/steam-deals
 * Payload: { gameNames?: string[] }
 * Returns an array of dynamic slides showcasing Steam deals in INR.
 */
router.post('/slides/steam-deals', async (req: Request, res: Response) => {
  const { gameNames, category } = req.body;

  if (gameNames && !Array.isArray(gameNames)) {
    return res.status(400).json({ error: 'gameNames must be an array of strings' });
  }

  try {
    let resolvedDeals: any[] = [];
    if (gameNames && gameNames.length > 0) {
      resolvedDeals = await steamService.resolveGamesFromNames(gameNames);
    } else {
      // Fetch 5 deals on Steam in INR with category filter
      resolvedDeals = await steamService.getFeaturedSpecials(5, category || 'main');
    }

    if (resolvedDeals.length === 0) {
      return res.status(404).json({ error: 'Could not retrieve or resolve any Steam deals. Please check the game names.' });
    }

    const result = await geminiService.generateSteamDealsSlides(resolvedDeals, category);
    return res.json(result);
  } catch (error: any) {
    console.error('Steam deals slides generation router error:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/shorts/proxy-gemini
 * Payload: { promptTopic: string }
 * Proxy endpoint to call Gemini API with Node server's key, returning script/subtitles.
 */
router.post('/shorts/proxy-gemini', async (req: Request, res: Response) => {
  const { promptTopic, tone } = req.body;

  if (!promptTopic || typeof promptTopic !== 'string' || promptTopic.trim() === '') {
    return res.status(400).json({ error: 'promptTopic must be a non-empty string' });
  }

  try {
    const result = await geminiService.generateShortsScript(promptTopic, tone);
    return res.json(result);
  } catch (error: any) {
    console.error('Shorts script generation proxy error:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/social/publish-instagram
 * Payload: { images: string[], caption: string, password?: string }
 * Uploads slide base64 images to Vercel Blob and publishes them to Instagram as a carousel.
 */
router.post('/social/publish-instagram', async (req: Request, res: Response) => {
  const { images, caption, password } = req.body;

  if (!images || !Array.isArray(images) || images.length === 0) {
    return res.status(400).json({ error: 'images array is required and must not be empty' });
  }
  if (!password || password !== config.instagram.adminPassword) {
    return res.status(401).json({ error: 'Invalid admin password' });
  }

  const vercelBlobToken = config.vercelBlob.readWriteToken;
  const igUserId = config.instagram.userId;
  const metaToken = config.instagram.accessToken;

  if (!vercelBlobToken || !igUserId || !metaToken) {
    return res.status(500).json({ error: 'Instagram publishing credentials are not configured on the server.' });
  }

  // Import put and del dynamically from @vercel/blob
  let put: any, del: any;
  try {
    const blobModule = require('@vercel/blob');
    put = blobModule.put;
    del = blobModule.del;
  } catch (e) {
    return res.status(500).json({ error: 'Vercel Blob module is not loaded correctly' });
  }

  const uploadedUrls: string[] = [];

  try {
    // 1. Upload all base64 slides to Vercel Blob to get public URLs
    for (let i = 0; i < images.length; i++) {
      const dataUrl = images[i];
      const mimeMatch = dataUrl.match(/^data:(image\/\w+);base64,/);
      if (!mimeMatch) {
        throw new Error(`Slide ${i + 1} has invalid image format`);
      }
      const mimeType = mimeMatch[1];
      const extension = (mimeType === 'image/jpeg' || mimeType === 'image/jpg') ? 'jpg' : 'png';
      
      const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, 'base64');
      
      // Upload using Vercel Blob with proper mime type and extension
      const blob = await put(`slide_${Date.now()}_${i}.${extension}`, buffer, {
        access: 'public',
        token: vercelBlobToken,
        contentType: mimeType
      });
      
      uploadedUrls.push(blob.url);
    }

    // 2. Create Instagram container for each carousel item
    const childrenIds: string[] = [];
    for (let i = 0; i < uploadedUrls.length; i++) {
      const url = uploadedUrls[i];
      const itemRes = await axios.post(`https://graph.facebook.com/v20.0/${igUserId}/media`, {
        image_url: url,
        is_carousel_item: true,
        access_token: metaToken
      });
      childrenIds.push(itemRes.data.id);
    }

    // 3. Poll Instagram to ensure all slide containers have finished processing
    console.log(`[Instagram Publish] Created ${childrenIds.length} item containers. Waiting for processing...`);
    for (const childId of childrenIds) {
      let attempts = 0;
      let finished = false;
      
      while (!finished && attempts < 15) { // max 30 seconds wait per slide
        const statusRes = await axios.get(`https://graph.facebook.com/v20.0/${childId}`, {
          params: {
            fields: 'status_code',
            access_token: metaToken
          }
        });
        
        const statusCode = statusRes.data?.status_code;
        if (statusCode === 'FINISHED') {
          finished = true;
        } else if (statusCode === 'ERROR') {
          throw new Error(`Instagram image processing failed for item container ${childId}`);
        } else {
          attempts++;
          await new Promise(resolve => setTimeout(resolve, 2000)); // wait 2s
        }
      }
      
      if (!finished) {
        throw new Error(`Instagram container processing timed out for item ${childId}`);
      }
    }
    console.log(`[Instagram Publish] All slide containers are FINISHED. Linking Carousel...`);

    // 4. Create the Carousel container linking all slide items
    const carouselRes = await axios.post(`https://graph.facebook.com/v20.0/${igUserId}/media`, {
      media_type: 'CAROUSEL',
      children: childrenIds,
      caption: caption || '',
      access_token: metaToken
    });
    const carouselCreationId = carouselRes.data.id;

    // 5. Publish the Carousel post
    const publishRes = await axios.post(`https://graph.facebook.com/v20.0/${igUserId}/media_publish`, {
      creation_id: carouselCreationId,
      access_token: metaToken
    });

    const postId = publishRes.data.id;

    // 6. Clean up Vercel Blob storage asynchronously after publishing
    try {
      await del(uploadedUrls, { token: vercelBlobToken });
    } catch (cleanupErr) {
      console.warn('Vercel Blob storage cleanup failed:', cleanupErr);
    }

    return res.json({ success: true, postId });
  } catch (error: any) {
    console.error('Instagram Carousel Publishing Error:', error.response?.data || error.message);
    
    // Attempt cleanup on error
    if (uploadedUrls.length > 0) {
      try {
        await del(uploadedUrls, { token: vercelBlobToken });
      } catch (e) {}
    }

    const apiErr = error.response?.data?.error?.message || error.message;
    return res.status(500).json({ error: `Instagram publishing failed: ${apiErr}` });
  }
});

/**
 * POST /api/social/publish-instagram-reel
 * Payload: { video: string, caption: string, password?: string }
 * Uploads video base64 to Vercel Blob and publishes it to Instagram as a Reel.
 */
router.post('/social/publish-instagram-reel', async (req: Request, res: Response) => {
  const { video, caption, password } = req.body;

  if (!video || typeof video !== 'string') {
    return res.status(400).json({ error: 'video base64 data URL is required' });
  }
  if (!password || password !== config.instagram.adminPassword) {
    return res.status(401).json({ error: 'Invalid admin password' });
  }

  const vercelBlobToken = config.vercelBlob.readWriteToken;
  const igUserId = config.instagram.userId;
  const metaToken = config.instagram.accessToken;

  if (!vercelBlobToken || !igUserId || !metaToken) {
    return res.status(500).json({ error: 'Instagram publishing credentials are not configured on the server.' });
  }

  // Import put and del dynamically from @vercel/blob
  let put: any, del: any;
  try {
    const blobModule = require('@vercel/blob');
    put = blobModule.put;
    del = blobModule.del;
  } catch (e) {
    return res.status(500).json({ error: 'Vercel Blob module is not loaded correctly' });
  }

  let uploadedUrl = '';

  try {
    // 1. Upload base64 video to Vercel Blob to get a public URL
    const mimeMatch = video.match(/^data:([^;]+).*?;base64,/);
    if (!mimeMatch) {
      throw new Error(`Video has invalid format. Must be a valid video base64 Data URL.`);
    }
    const mimeType = mimeMatch[1]; // e.g. "video/webm" or "video/mp4"
    if (!mimeType.startsWith('video/')) {
      throw new Error(`Invalid MIME type: ${mimeType}. Must be a video.`);
    }
    const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
    
    const base64Data = video.substring(video.indexOf(';base64,') + 8);
    const buffer = Buffer.from(base64Data, 'base64');
    
    console.log(`[Instagram Reel] Uploading video to Vercel Blob (${buffer.length} bytes)...`);
    const blob = await put(`reel_${Date.now()}.${extension}`, buffer, {
      access: 'public',
      token: vercelBlobToken,
      contentType: mimeType
    });
    
    uploadedUrl = blob.url;
    console.log(`[Instagram Reel] Uploaded to Vercel Blob: ${uploadedUrl}`);

    // 2. Create Instagram container for Reel
    console.log(`[Instagram Reel] Creating Instagram Reel container...`);
    const containerRes = await axios.post(`https://graph.facebook.com/v20.0/${igUserId}/media`, {
      media_type: 'REELS',
      video_url: uploadedUrl,
      caption: caption || '',
      share_to_feed: true,
      access_token: metaToken
    });
    
    const creationId = containerRes.data.id;
    console.log(`[Instagram Reel] Created Reel container ID: ${creationId}. Polling for status...`);

    // 3. Poll Instagram to ensure video container has finished processing
    let attempts = 0;
    let finished = false;
    
    // Video processing takes longer than images. Max 120 seconds wait (40 attempts * 3 seconds)
    while (!finished && attempts < 40) {
      attempts++;
      await new Promise(resolve => setTimeout(resolve, 3000)); // wait 3s
      
      try {
        const statusRes = await axios.get(`https://graph.facebook.com/v20.0/${creationId}`, {
          params: {
            fields: 'status_code',
            access_token: metaToken
          }
        });
        
        const statusCode = statusRes.data?.status_code;
        console.log(`[Instagram Reel] Polling attempt ${attempts}: status_code = ${statusCode}`);
        if (statusCode === 'FINISHED') {
          finished = true;
        } else if (statusCode === 'ERROR') {
          throw new Error(`Instagram video processing failed for container ${creationId}`);
        }
      } catch (err: any) {
        console.warn(`[Instagram Reel] Polling error on attempt ${attempts}:`, err.message);
      }
    }
    
    if (!finished) {
      throw new Error(`Instagram container processing timed out for Reel container ${creationId}`);
    }
    
    console.log(`[Instagram Reel] Reel container processed successfully. Publishing...`);

    // 4. Publish the Reel post
    const publishRes = await axios.post(`https://graph.facebook.com/v20.0/${igUserId}/media_publish`, {
      creation_id: creationId,
      access_token: metaToken
    });

    const postId = publishRes.data.id;
    console.log(`[Instagram Reel] Published successfully. Post ID: ${postId}`);

    // 5. Clean up Vercel Blob storage asynchronously after publishing
    try {
      await del(uploadedUrl, { token: vercelBlobToken });
      console.log(`[Instagram Reel] Cleaned up Vercel Blob: ${uploadedUrl}`);
    } catch (cleanupErr) {
      console.warn('[Instagram Reel] Vercel Blob storage cleanup failed:', cleanupErr);
    }

    return res.json({ success: true, postId });
  } catch (error: any) {
    console.error('Instagram Reel Publishing Error:', error.response?.data || error.message);
    
    // Attempt cleanup on error
    if (uploadedUrl) {
      try {
        await del(uploadedUrl, { token: vercelBlobToken });
      } catch (e) {}
    }

    const apiErr = error.response?.data?.error?.message || error.message;
    return res.status(500).json({ error: `Instagram Reel publishing failed: ${apiErr}` });
  }
});


interface WordSegment {
  part: string;
  start: number;
  end: number;
}

interface SubtitlePhrase {
  text: string;
  start: number;
  end: number;
}

function alignSubtitles(phrases: SubtitlePhrase[], words: WordSegment[]): SubtitlePhrase[] {
  if (!words || words.length === 0) return phrases;

  const aligned: SubtitlePhrase[] = [];
  let wordIdx = 0;

  for (let i = 0; i < phrases.length; i++) {
    const phrase = phrases[i];
    const phraseWords = phrase.text.split(/\s+/).filter(w => w.trim().length > 0);
    const numWordsToConsume = phraseWords.length;

    if (numWordsToConsume === 0 || wordIdx >= words.length) {
      aligned.push({ ...phrase });
      continue;
    }

    const startWord = words[wordIdx];
    const phraseStartMs = startWord.start;

    let endWord = words[wordIdx];
    for (let j = 0; j < numWordsToConsume; j++) {
      if (wordIdx < words.length) {
        endWord = words[wordIdx];
        wordIdx++;
      }
    }

    const phraseEndMs = endWord.end;

    aligned.push({
      text: phrase.text,
      start: phraseStartMs / 1000,
      end: phraseEndMs / 1000
    });
  }

  // Adjust overlapping or gaps
  if (aligned.length > 0) {
    aligned[0].start = 0;
  }

  for (let i = 0; i < aligned.length - 1; i++) {
    const current = aligned[i];
    const next = aligned[i + 1];

    if (next.start < current.end) {
      next.start = current.end;
    } else if (current.end < next.start) {
      const gap = next.start - current.end;
      if (gap <= 1.5) {
        current.end = next.start;
      }
    }
  }

  // Force the last subtitle to extend to the very end of the last word
  if (aligned.length > 0 && words.length > 0) {
    aligned[aligned.length - 1].end = words[words.length - 1].end / 1000;
  }

  return aligned;
}

/**
 * POST /api/shorts/proxy-tts
 * Payload: { text: string, subtitles?: Array, voiceSelection?: string }
 * Proxy endpoint to generate TTS audio and aligned word-level subtitles, returning a JSON response.
 */
router.post('/shorts/proxy-tts', async (req: Request, res: Response) => {
  const { text, subtitles, voiceSelection } = req.body;

  if (!text || typeof text !== 'string' || text.trim() === '') {
    return res.status(400).json({ error: 'text must be a non-empty string' });
  }

  const voice = voiceSelection || 'en-US-ChristopherNeural';
  const tempDir = os.tmpdir();
  const tempFile = path.join(tempDir, `tts_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.mp3`);

  try {
    const tts = new EdgeTTS({ 
      voice,
      rate: '+50%',
      saveSubtitles: true
    });
    await tts.ttsPromise(text, tempFile);

    if (!fs.existsSync(tempFile)) {
      throw new Error('TTS audio file was not successfully generated by the synthesizer');
    }

    const fileBuffer = fs.readFileSync(tempFile);
    const audioBase64 = fileBuffer.toString('base64');

    // Align subtitles if possible
    let alignedSubs = subtitles || [];
    const subFile = tempFile + '.json';
    if (fs.existsSync(subFile)) {
      try {
        const subContent = fs.readFileSync(subFile, 'utf8');
        const words = JSON.parse(subContent);
        
        if (subtitles && subtitles.length > 0) {
          alignedSubs = alignSubtitles(subtitles, words);
        } else {
          // Auto-generate phrases of 3 words each
          const phraseSize = 3;
          const autoPhrases = [];
          for (let i = 0; i < words.length; i += phraseSize) {
            const chunk = words.slice(i, i + phraseSize);
            const chunkText = chunk.map((w: any) => w.part.trim()).join(' ');
            const start = chunk[0].start / 1000;
            const end = chunk[chunk.length - 1].end / 1000;
            autoPhrases.push({ text: chunkText, start, end });
          }
          alignedSubs = autoPhrases;
        }
      } catch (err) {
        console.error('Error parsing subtitle file:', err);
      } finally {
        fs.unlink(subFile, (err) => {
          if (err) console.error('Error deleting temp subtitle file:', err);
        });
      }
    }

    // Clean up temporary audio file asynchronously
    fs.unlink(tempFile, (err) => {
      if (err) console.error('Error deleting temp TTS file:', err);
    });

    return res.json({
      audio: audioBase64,
      subtitles: alignedSubs
    });
  } catch (error: any) {
    console.error('TTS proxy generation error:', error.message);
    // Cleanup on error if files exist
    if (fs.existsSync(tempFile)) {
      try {
        fs.unlinkSync(tempFile);
      } catch (e) {}
    }
    const subFile = tempFile + '.json';
    if (fs.existsSync(subFile)) {
      try {
        fs.unlinkSync(subFile);
      } catch (e) {}
    }
    return res.status(500).json({ error: error.message });
  }
});

export default router;
