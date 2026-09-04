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
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(url);
    hostname = parsedUrl.hostname.toLowerCase();
    
    // Normalize target URL to use https for security if possible
    if (parsedUrl.protocol === 'http:') {
      targetUrl = 'https://' + url.slice(7);
    }
  } catch (err) {
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  // Validate protocol
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return res.status(400).json({ error: 'Only HTTP/HTTPS URLs are supported' });
  }

  // Prevent SSRF against private/local networks
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname.startsWith('192.168.') ||
    hostname.startsWith('10.') ||
    hostname.startsWith('172.16.') ||
    hostname.endsWith('.local')
  ) {
    return res.status(403).json({ error: 'Local network access is restricted' });
  }

  const requestHeaders: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    'Referer': parsedUrl.origin,
    'Sec-Fetch-Dest': 'image',
    'Sec-Fetch-Mode': 'no-cors',
    'Sec-Fetch-Site': 'cross-site'
  };

  try {
    const response = await axios.get(targetUrl, {
      responseType: 'arraybuffer',
      timeout: 8000,
      headers: requestHeaders,
      maxRedirects: 5
    });

    const contentTypeHeader = response.headers['content-type'];
    const contentType = typeof contentTypeHeader === 'string' && contentTypeHeader.includes('image')
      ? contentTypeHeader
      : 'image/jpeg';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(response.data);
  } catch (error: any) {
    console.error('Image proxy error fetching:', targetUrl, error.message);
    // If targetUrl failed, retry once with raw url if different
    if (targetUrl !== url) {
      try {
        const response = await axios.get(url, {
          responseType: 'arraybuffer',
          timeout: 8000,
          headers: requestHeaders,
          maxRedirects: 5
        });
        const contentTypeHeader = response.headers['content-type'];
        const contentType = typeof contentTypeHeader === 'string' && contentTypeHeader.includes('image')
          ? contentTypeHeader
          : 'image/jpeg';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.send(response.data);
      } catch (retryError: any) {
        console.error('Image proxy retry error fetching:', url, retryError.message);
        return res.status(500).json({ error: 'Failed to proxy image' });
      }
    }
    return res.status(500).json({ error: 'Failed to proxy image' });
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
  const { promptTopic, tone, language } = req.body;

  if (!promptTopic || typeof promptTopic !== 'string' || promptTopic.trim() === '') {
    return res.status(400).json({ error: 'promptTopic must be a non-empty string' });
  }

  try {
    const result = await geminiService.generateShortsScript(promptTopic, tone, language);
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
    // 1. Parallel upload all base64 slides to Vercel Blob to get public URLs
    console.log(`[Instagram Carousel] Uploading ${images.length} slide images to Vercel Blob in parallel...`);
    const uploadPromises = images.map(async (dataUrl, i) => {
      const mimeMatch = dataUrl.match(/^data:(image\/\w+);base64,/);
      if (!mimeMatch) {
        throw new Error(`Slide ${i + 1} has invalid image format`);
      }
      const mimeType = mimeMatch[1];
      const extension = (mimeType === 'image/jpeg' || mimeType === 'image/jpg') ? 'jpg' : 'png';
      
      const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, 'base64');
      
      const blob = await put(`slide_${Date.now()}_${i}.${extension}`, buffer, {
        access: 'public',
        token: vercelBlobToken,
        contentType: mimeType
      });
      return { index: i, url: blob.url };
    });

    const uploadResults = await Promise.all(uploadPromises);
    // Sort to guarantee correct slide ordering
    uploadResults.sort((a, b) => a.index - b.index);
    for (const res of uploadResults) {
      uploadedUrls.push(res.url);
    }
    console.log(`[Instagram Carousel] Successfully uploaded ${uploadedUrls.length} slides to Vercel Blob.`);

    // 2. Create Instagram container for each carousel item
    console.log(`[Instagram Carousel] Creating ${uploadedUrls.length} child item containers on Instagram...`);
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
    console.log(`[Instagram Carousel] Created child containers: ${childrenIds.join(', ')}`);

    // 3. Poll Instagram to ensure all slide child containers have finished processing
    console.log(`[Instagram Carousel] Polling child containers for FINISHED status...`);
    for (let i = 0; i < childrenIds.length; i++) {
      const childId = childrenIds[i];
      let attempts = 0;
      let finished = false;
      
      while (!finished && attempts < 20) { // max 40 seconds wait per slide
        attempts++;
        try {
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
          }
        } catch (pollErr: any) {
          if (pollErr.message && pollErr.message.includes('Instagram image processing failed')) {
            throw pollErr;
          }
          console.warn(`[Instagram Carousel] Child ${childId} polling attempt ${attempts} warning:`, pollErr.message);
        }

        if (!finished) {
          await new Promise(resolve => setTimeout(resolve, 2000)); // wait 2s
        }
      }
      
      if (!finished) {
        throw new Error(`Instagram container processing timed out for item slide ${i + 1} (${childId})`);
      }
    }
    console.log(`[Instagram Carousel] All ${childrenIds.length} child containers are FINISHED.`);

    // 4. Create the Carousel container linking all slide items
    console.log(`[Instagram Carousel] Creating parent CAROUSEL container...`);
    const carouselRes = await axios.post(`https://graph.facebook.com/v20.0/${igUserId}/media`, {
      media_type: 'CAROUSEL',
      children: childrenIds,
      caption: caption || '',
      access_token: metaToken
    });
    const carouselCreationId = carouselRes.data.id;
    console.log(`[Instagram Carousel] Created parent Carousel container ID: ${carouselCreationId}. Polling for readiness...`);

    // 5. Poll parent Carousel container until FINISHED before attempting to publish
    let carouselAttempts = 0;
    let carouselFinished = false;

    while (!carouselFinished && carouselAttempts < 25) { // max 50 seconds wait
      carouselAttempts++;
      await new Promise(resolve => setTimeout(resolve, 2000)); // wait 2s between polls
      
      try {
        const carouselStatusRes = await axios.get(`https://graph.facebook.com/v20.0/${carouselCreationId}`, {
          params: {
            fields: 'status_code',
            access_token: metaToken
          }
        });

        const statusCode = carouselStatusRes.data?.status_code;
        console.log(`[Instagram Carousel] Parent container polling attempt ${carouselAttempts}: status_code = ${statusCode}`);

        if (statusCode === 'FINISHED') {
          carouselFinished = true;
        } else if (statusCode === 'ERROR') {
          throw new Error(`Instagram Carousel container processing failed on Meta servers for ID ${carouselCreationId}`);
        }
      } catch (pollErr: any) {
        if (pollErr.message && pollErr.message.includes('processing failed')) {
          throw pollErr;
        }
        console.warn(`[Instagram Carousel] Parent container polling warning on attempt ${carouselAttempts}:`, pollErr.message);
      }
    }

    if (!carouselFinished) {
      throw new Error(`Instagram Carousel container processing timed out for container ${carouselCreationId}`);
    }

    console.log(`[Instagram Carousel] Parent container is FINISHED. Publishing Carousel to Instagram...`);

    // 6. Publish the Carousel post
    const publishRes = await axios.post(`https://graph.facebook.com/v20.0/${igUserId}/media_publish`, {
      creation_id: carouselCreationId,
      access_token: metaToken
    });

    const postId = publishRes.data.id;
    console.log(`[Instagram Carousel] Published successfully! Post ID: ${postId}`);

    // 7. Clean up Vercel Blob storage asynchronously after publishing
    try {
      await del(uploadedUrls, { token: vercelBlobToken });
      console.log(`[Instagram Carousel] Cleaned up ${uploadedUrls.length} temporary images from Vercel Blob.`);
    } catch (cleanupErr) {
      console.warn('[Instagram Carousel] Vercel Blob storage cleanup failed:', cleanupErr);
    }

    return res.json({ success: true, postId });
  } catch (error: any) {
    console.error('Instagram Carousel Publishing Error:', error.response?.data || error.message);
    
    // Attempt cleanup on error
    if (uploadedUrls.length > 0) {
      try {
        await del(uploadedUrls, { token: vercelBlobToken });
        console.log(`[Instagram Carousel] Cleaned up temporary blob files after error.`);
      } catch (e) {}
    }

    const apiErr = error.response?.data?.error?.message 
      || (typeof error.response?.data?.error === 'string' ? error.response?.data?.error : '') 
      || error.message 
      || 'Unknown error';
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

    const apiErr = error.response?.data?.error?.message 
      || (typeof error.response?.data?.error === 'string' ? error.response?.data?.error : '') 
      || error.message 
      || 'Unknown error';
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

/**
 * Accurately parses the total duration in milliseconds from raw MPEG Layer III audio frames.
 * Prevents subtitle drift when concatenating chunked TTS audio streams.
 */
function getMp3DurationMs(buffer: Buffer): number {
  let offset = 0;
  let totalDurationMs = 0;

  // Skip ID3v2 tag if present at start
  if (buffer.length > 10 && buffer.toString('utf8', 0, 3) === 'ID3') {
    const size =
      ((buffer[6] & 0x7f) << 21) |
      ((buffer[7] & 0x7f) << 14) |
      ((buffer[8] & 0x7f) << 7) |
      (buffer[9] & 0x7f);
    offset = 10 + size;
  }

  const sampleRates: { [key: number]: number[] } = {
    0: [11025, 12000, 8000],  // MPEG 2.5
    2: [22050, 24000, 16000], // MPEG 2
    3: [44100, 48000, 32000]  // MPEG 1
  };

  const bitrates: { [key: number]: number[] } = {
    // MPEG 1, Layer III (kbps)
    1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
    // MPEG 2 & 2.5, Layer III (kbps)
    2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
  };

  while (offset < buffer.length - 4) {
    if (buffer[offset] === 0xff && (buffer[offset + 1] & 0xe0) === 0xe0) {
      const b1 = buffer[offset + 1];
      const b2 = buffer[offset + 2];
      const mpegVer = (b1 >> 3) & 3; // 0=2.5, 2=2, 3=1
      const layer = (b1 >> 1) & 3;   // 1=Layer III
      const bitrateIdx = (b2 >> 4) & 15;
      const sampleRateIdx = (b2 >> 2) & 3;
      const padding = (b2 >> 1) & 1;

      if (layer === 1 && bitrateIdx > 0 && bitrateIdx < 15 && sampleRateIdx < 3 && sampleRates[mpegVer]) {
        const sr = sampleRates[mpegVer][sampleRateIdx];
        const brTable = mpegVer === 3 ? bitrates[1] : bitrates[2];
        const brKbps = brTable ? brTable[bitrateIdx] : 0;
        const br = brKbps * 1000;

        if (sr && br) {
          const samplesPerFrame = mpegVer === 3 ? 1152 : 576;
          const frameLen = Math.floor((samplesPerFrame * (br / 8)) / sr) + padding;
          totalDurationMs += (samplesPerFrame / sr) * 1000;
          offset += frameLen;
          continue;
        }
      }
    }
    offset++;
  }

  // Fallback if parsing failed: EdgeTTS uses 48kbps mono (6000 bytes/sec)
  if (totalDurationMs <= 0 && buffer.length > 0) {
    totalDurationMs = (buffer.length / 6000) * 1000;
  }

  return totalDurationMs;
}

/**
 * Builds frame-perfect, synchronized subtitle cards directly from EdgeTTS physical word timestamps.
 * Works seamlessly for all voices and languages (English, Tamil, British, etc.) with zero drift.
 */
function buildPreciseSubtitlesFromWords(words: WordSegment[], totalAudioDurationSec?: number): SubtitlePhrase[] {
  if (!words || words.length === 0) return [];

  const chunks: SubtitlePhrase[] = [];
  let currentChunk: WordSegment[] = [];
  let currentChars = 0;

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const cleanWord = w.part.trim();
    if (!cleanWord) continue;

    currentChunk.push(w);
    currentChars += cleanWord.length;

    const isPunctuation = /[.?!,;:]$/.test(cleanWord);
    const nextWord = words[i + 1];
    const hasLongPauseNext = nextWord ? ((nextWord.start - w.end) > 300) : true;
    
    // Chunk criteria: 3-4 words max, punctuation mark, character length >= 20, or audio pause
    const shouldBreak = currentChunk.length >= 4 || 
                        (currentChunk.length >= 2 && (isPunctuation || currentChars >= 20 || hasLongPauseNext)) || 
                        i === words.length - 1;

    if (shouldBreak) {
      const text = currentChunk.map(x => x.part.trim()).join(' ');
      const start = Math.max(0, currentChunk[0].start / 1000);
      const end = Math.max(start + 0.1, currentChunk[currentChunk.length - 1].end / 1000);
      chunks.push({ text, start, end });
      currentChunk = [];
      currentChars = 0;
    }
  }

  // Seamless Shorts pacing: bridge pauses (up to 0.85s) between subtitle cards so text displays continuously
  // without jarring flickers between words, perfectly matching modern Reels/Shorts caption style.
  for (let i = 0; i < chunks.length - 1; i++) {
    const curr = chunks[i];
    const next = chunks[i + 1];
    const gap = next.start - curr.end;
    if (gap > 0 && gap <= 0.85) {
      curr.end = next.start;
    } else if (gap > 0.85) {
      curr.end = Math.min(next.start, curr.end + 0.4);
    }
  }

  // Extend the last chunk slightly to end of audio if provided
  if (chunks.length > 0 && totalAudioDurationSec && totalAudioDurationSec > chunks[chunks.length - 1].end) {
    const last = chunks[chunks.length - 1];
    if (totalAudioDurationSec - last.end <= 1.0) {
      last.end = totalAudioDurationSec;
    }
  }

  return chunks;
}

/**
 * POST /api/shorts/proxy-tts
 * Payload: { text: string, subtitles?: Array, voiceSelection?: string, rate?: string, pitch?: string }
 * Proxy endpoint to generate TTS audio and aligned word-level subtitles, returning a JSON response.
 */
router.post('/shorts/proxy-tts', async (req: Request, res: Response) => {
  const { text, subtitles, voiceSelection, rate: requestedRate, pitch: requestedPitch } = req.body;

  if (!text || typeof text !== 'string' || text.trim() === '') {
    return res.status(400).json({ error: 'text must be a non-empty string' });
  }

  const voice = voiceSelection || (text.match(/[\u0B80-\u0BFF]/) ? 'ta-IN-ValluvarNeural' : 'en-US-ChristopherNeural');
  const isTamilVoice = voice.startsWith('ta-');
  const isBassMaleVoice = (voice === 'en-US-ChristopherNeural' || voice === 'ta-IN-ValluvarNeural');

  // Rate: +30% default rate for punchy, high-retention shorts pacing
  let rate = requestedRate || '+30%';
  if (rate && !rate.startsWith('+') && !rate.startsWith('-') && rate.endsWith('%')) {
    rate = `+${rate}`;
  }

  // Pitch: -20Hz for deep bass male (Christopher / Valluvar), default for female / others
  const pitch = requestedPitch !== undefined && requestedPitch !== '' ? requestedPitch : (isBassMaleVoice ? '-20Hz' : 'default');

  // Dynamically determine exact regional language code from voice prefix (e.g. 'en-US', 'en-GB', 'ta-IN', 'ta-LK')
  const langParts = voice.split('-');
  const lang = (langParts.length >= 2) ? `${langParts[0]}-${langParts[1]}` : (isTamilVoice ? 'ta-IN' : 'en-US');

  const tempDir = os.tmpdir();
  const tempFile = path.join(tempDir, `tts_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.mp3`);

  try {
    console.log(`[Shorts TTS] Synthesizing audio: voice="${voice}", rate="${rate}", pitch="${pitch}"...`);
    const tts = new EdgeTTS({ 
      voice,
      lang,
      rate,
      pitch,
      saveSubtitles: true,
      timeout: 60000 // 60 seconds timeout for long text synthesis in serverless environments
    });
    await tts.ttsPromise(text, tempFile);

    if (!fs.existsSync(tempFile)) {
      throw new Error('TTS audio file was not successfully generated by the synthesizer');
    }

    const fileBuffer = fs.readFileSync(tempFile);
    const audioBase64 = fileBuffer.toString('base64');
    const audioDurationMs = getMp3DurationMs(fileBuffer);
    const audioDurationSec = audioDurationMs / 1000;

    // Extract exact physical word timestamps from synthesizer and build synchronized subtitles
    let alignedSubs: SubtitlePhrase[] = [];
    const subFile = tempFile + '.json';
    if (fs.existsSync(subFile)) {
      try {
        const subContent = fs.readFileSync(subFile, 'utf8');
        const words = JSON.parse(subContent);
        if (Array.isArray(words) && words.length > 0) {
          alignedSubs = buildPreciseSubtitlesFromWords(words, audioDurationSec);
          console.log(`[Shorts TTS] Extracted ${words.length} physical words -> ${alignedSubs.length} aligned subtitle cards (audio duration: ${audioDurationSec.toFixed(2)}s)`);
        }
      } catch (err) {
        console.error('Error parsing subtitle file:', err);
      } finally {
        fs.unlink(subFile, (err) => {
          if (err) console.error('Error deleting temp subtitle file:', err);
        });
      }
    }

    // Robust fallback: if physical words could not be extracted, align Gemini subtitles by scaling to audio duration
    if (alignedSubs.length === 0 && Array.isArray(subtitles) && subtitles.length > 0) {
      console.log(`[Shorts TTS] Subtitle fallback: Scaling ${subtitles.length} Gemini subtitle segments to match actual audio duration (${audioDurationSec.toFixed(2)}s)`);
      const originalMaxEnd = Math.max(...subtitles.map((s: any) => s.end || 0), 1);
      const scale = audioDurationSec / originalMaxEnd;
      alignedSubs = subtitles.map((s: any) => ({
        text: s.text,
        start: Math.round(s.start * scale * 1000) / 1000,
        end: Math.round(s.end * scale * 1000) / 1000,
      }));
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
    const errorDetail = error?.message || (typeof error === 'string' ? error : JSON.stringify(error)) || 'TTS synthesis failed';
    console.error('TTS proxy generation error:', errorDetail);
    try {
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      const subFile = tempFile + '.json';
      if (fs.existsSync(subFile)) fs.unlinkSync(subFile);
    } catch (_) {}
    return res.status(500).json({ error: errorDetail });
  }
});

/**
 * POST /api/narrator/generate
 * Generates a full YouTube video script, SEO metadata, thumbnail headline, and sections.
 */
router.post('/narrator/generate', async (req: Request, res: Response) => {
  try {
    const { topic, gameTitle, domain, tone, language, targetMinutes } = req.body;

    if (!topic || typeof topic !== 'string' || topic.trim() === '') {
      return res.status(400).json({ error: 'topic must be a non-empty string' });
    }

    const script = await geminiService.generateYoutubeScript({
      topic,
      gameTitle,
      domain,
      tone,
      language,
      targetMinutes: Number(targetMinutes) || 8
    });

    return res.json(script);
  } catch (error: any) {
    console.error('YouTube script generation error:', error);
    return res.status(500).json({ error: error.message || 'Failed to generate YouTube script' });
  }
});

/**
 * POST /api/narrator/regenerate-section
 * Rewrites or expands a specific section of the script based on user hint.
 */
router.post('/narrator/regenerate-section', async (req: Request, res: Response) => {
  try {
    const { topic, sectionTitle, currentContent, hint, tone, language } = req.body;

    if (!topic || !sectionTitle) {
      return res.status(400).json({ error: 'topic and sectionTitle are required' });
    }

    const section = await geminiService.regenerateScriptSection({
      topic,
      sectionTitle,
      currentContent,
      hint,
      tone,
      language
    });

    return res.json(section);
  } catch (error: any) {
    console.error('Section regeneration error:', error);
    return res.status(500).json({ error: error.message || 'Failed to regenerate section' });
  }
});

/**
 * Helper to chunk text into sentence-aware blocks of max ~700 characters
 * to avoid WebSocket timeouts on long-form scripts.
 */
function splitTextIntoChunks(text: string, maxChunkLen: number = 700): string[] {
  // Clean up any brackets like [INTRO], [POINT 1] that might confuse TTS
  const cleanText = text.replace(/\[[^\]]+\]/g, '').trim();
  const sentences = cleanText.match(/[^.!?\n]+[.!?\n]+/g) || [cleanText];
  const chunks: string[] = [];
  let currentChunk = '';

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;
    if ((currentChunk + ' ' + trimmed).length > maxChunkLen && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      currentChunk = trimmed;
    } else {
      currentChunk = currentChunk ? `${currentChunk} ${trimmed}` : trimmed;
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }

  return chunks.length > 0 ? chunks : [cleanText];
}

/**
 * POST /api/narrator/tts
 * Synthesizes long-form narration audio into an MP3 file with chunked processing for English & Tamil,
 * and extracts frame-accurate aligned subtitles.
 */
router.post('/narrator/tts', async (req: Request, res: Response) => {
  const { text, voice, rate, pitch } = req.body;

  if (!text || typeof text !== 'string' || text.trim() === '') {
    return res.status(400).json({ error: 'text must be a non-empty string' });
  }

  // Detect language or use chosen voice
  const chosenVoice = voice || (text.match(/[\u0B80-\u0BFF]/) ? 'ta-IN-ValluvarNeural' : 'en-US-ChristopherNeural');
  const isBassMaleVoice = (chosenVoice === 'en-US-ChristopherNeural' || chosenVoice === 'ta-IN-ValluvarNeural');
  
  // Rate defaults: -10% for deep bass male, +0% otherwise
  const chosenRate = rate || (isBassMaleVoice ? '-10%' : '+0%');

  // Pitch defaults: -15Hz for deep bass male, default (+0Hz) otherwise
  const chosenPitch = pitch !== undefined && pitch !== '' ? pitch : (isBassMaleVoice ? '-15Hz' : 'default');

  const isTamilVoice = chosenVoice.startsWith('ta-');
  const langParts = chosenVoice.split('-');
  const lang = (langParts.length >= 2) ? `${langParts[0]}-${langParts[1]}` : (isTamilVoice ? 'ta-IN' : 'en-US');

  const tempDir = os.tmpdir();

  try {
    const chunks = splitTextIntoChunks(text, 1000);
    console.log(`[Narrator TTS] Synthesizing ${chunks.length} chunks for voice "${chosenVoice}" (rate: "${chosenRate}", pitch: "${chosenPitch}")...`);
    const audioBuffers: Buffer[] = [];
    const allWords: WordSegment[] = [];
    let cumulativeTimeOffsetMs = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkFile = path.join(tempDir, `tts_${Date.now()}_${i}_${Math.random().toString(36).substr(2, 6)}.mp3`);
      
      const tts = new EdgeTTS({
        voice: chosenVoice,
        lang,
        rate: chosenRate,
        pitch: chosenPitch,
        saveSubtitles: true,
        timeout: 60000
      });

      await tts.ttsPromise(chunk, chunkFile);

      if (fs.existsSync(chunkFile)) {
        const buf = fs.readFileSync(chunkFile);
        audioBuffers.push(buf);

        // Compute frame-accurate duration of this MP3 chunk to avoid any subtitle drift
        const chunkAudioDurationMs = getMp3DurationMs(buf);

        // Parse word subtitles for this chunk
        const subFile = chunkFile + '.json';
        if (fs.existsSync(subFile)) {
          try {
            const subContent = fs.readFileSync(subFile, 'utf8');
            const words: WordSegment[] = JSON.parse(subContent);
            if (Array.isArray(words) && words.length > 0) {
              for (const w of words) {
                allWords.push({
                  part: w.part,
                  start: w.start + cumulativeTimeOffsetMs,
                  end: w.end + cumulativeTimeOffsetMs
                });
              }
            }
          } catch (subErr) {
            console.warn(`[Narrator TTS] Warning parsing subfile ${subFile}:`, subErr);
          } finally {
            try { fs.unlinkSync(subFile); } catch (e) {}
          }
        }

        // Advance timeline offset by the exact physical duration of the audio buffer
        cumulativeTimeOffsetMs += chunkAudioDurationMs;

        try { fs.unlinkSync(chunkFile); } catch (e) {}
      }
    }

    if (audioBuffers.length === 0) {
      throw new Error('Failed to generate audio chunks from synthesizer');
    }

    const finalBuffer = Buffer.concat(audioBuffers);
    const audioBase64 = finalBuffer.toString('base64');
    const alignedSubs = buildPreciseSubtitlesFromWords(allWords);

    return res.json({
      audio: audioBase64,
      subtitles: alignedSubs,
      voice: chosenVoice,
      rate: chosenRate,
      pitch: chosenPitch
    });
  } catch (error: any) {
    console.error('Narrator TTS generation error:', error);
    return res.status(500).json({ error: error.message || 'Failed to synthesize narration audio' });
  }
});

/**
 * POST /api/narrator/fetch-scene-images
 * Fetches Google Images via Serper for a specific scene or chapter search query
 */
router.post('/narrator/fetch-scene-images', async (req: Request, res: Response) => {
  const { query, count = 10 } = req.body;

  if (!query || typeof query !== 'string' || query.trim() === '') {
    return res.status(400).json({ error: 'query parameter is required' });
  }

  try {
    const images = await geminiService.fetchGoogleImages(query.trim(), Number(count) || 10);
    return res.json({ images });
  } catch (error: any) {
    console.error('Fetch scene images error:', error);
    return res.status(500).json({ error: error.message || 'Failed to fetch scene images' });
  }
});

export default router;

