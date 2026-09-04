import { Injectable } from '@angular/core';
import { VideoScene, SubtitleSegment } from './game.service';

@Injectable({
  providedIn: 'root'
})
export class YoutubeVideoRecorderService {

  constructor() {}

  /**
   * Preloads all scene images as HTMLImageElement to avoid CORS issues and lag during render.
   */
  async preloadSceneImages(
    scenes: VideoScene[],
    proxyUrlFn: (url: string) => string
  ): Promise<Map<string, HTMLImageElement>> {
    const imageMap = new Map<string, HTMLImageElement>();
    const uniqueUrls = Array.from(new Set(scenes.map(s => s.imageUrl).filter(Boolean)));

    const promises = uniqueUrls.map(async (url) => {
      try {
        const proxied = proxyUrlFn(url);
        const img = new Image();
        img.crossOrigin = 'anonymous';
        
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => {
            console.warn(`[VideoRecorder] Failed to load image: ${url}`);
            resolve(); // Don't crash entire sequence
          };
          img.src = proxied;
        });

        imageMap.set(url, img);
      } catch (err) {
        console.warn(`[VideoRecorder] Preload error for ${url}:`, err);
      }
    });

    await Promise.all(promises);
    return imageMap;
  }

  /**
   * Helper to draw text with word wrap.
   */
  private wrapAndDrawText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    lineHeight: number,
    maxLines: number = 4
  ): number {
    if (!text) return y;
    const words = text.split(' ');
    let line = '';
    const lines: string[] = [];

    for (let n = 0; n < words.length; n++) {
      const testLine = line + words[n] + ' ';
      const metrics = ctx.measureText(testLine);
      const testWidth = metrics.width;
      if (testWidth > maxWidth && n > 0) {
        lines.push(line.trim());
        line = words[n] + ' ';
      } else {
        line = testLine;
      }
    }
    lines.push(line.trim());

    const renderedLines = lines.slice(0, maxLines);
    let currentY = y;

    for (let i = 0; i < renderedLines.length; i++) {
      ctx.fillText(renderedLines[i], x, currentY);
      currentY += lineHeight;
    }

    return currentY;
  }

  /**
   * Helper to draw a rounded rectangle.
   */
  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number
  ) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  /**
   * Format seconds to MM:SS string
   */
  private formatTime(seconds: number): string {
    const mins = Math.floor(Math.max(0, seconds) / 60);
    const secs = Math.floor(Math.max(0, seconds) % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Helper to draw an image covering the full canvas with aspect-fill and Ken Burns zoom/pan.
   */
  private drawImageAspectFill(
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    cw: number,
    ch: number,
    scaleFactor: number,
    panX: number,
    panY: number
  ) {
    if (!img.complete || img.naturalWidth === 0) return;
    const imgRatio = img.naturalWidth / img.naturalHeight;
    const canvasRatio = cw / ch;
    let renderW = cw;
    let renderH = ch;

    if (imgRatio > canvasRatio) {
      renderH = ch;
      renderW = ch * imgRatio;
    } else {
      renderW = cw;
      renderH = cw / imgRatio;
    }

    const scaledW = renderW * scaleFactor;
    const scaledH = renderH * scaleFactor;
    const dx = (cw - scaledW) / 2 + panX;
    const dy = (ch - scaledH) / 2 + panY;

    ctx.drawImage(img, dx, dy, scaledW, scaledH);
  }

  /**
   * Core 1920x1080 Frame Renderer.
   * Full-bleed background image with cinematic Ken Burns motion, elegant dark side fade,
   * info bullet text overlay, and yellow subtitles.
   */
  public renderFrame(
    ctx: CanvasRenderingContext2D,
    currentTime: number,
    totalDuration: number,
    scenes: VideoScene[],
    subtitles: SubtitleSegment[],
    videoTitle: string,
    preloadedImages: Map<string, HTMLImageElement>,
    analyserFrequencies?: Uint8Array
  ) {
    const width = 1920;
    const height = 1080;

    // 1. Find Current Active Scene
    const currentSceneIndex = scenes.findIndex(s => currentTime >= s.startTime && currentTime <= s.endTime);
    const currentScene = currentSceneIndex >= 0 ? scenes[currentSceneIndex] : (scenes[0] || null);
    const prevScene = currentSceneIndex > 0 ? scenes[currentSceneIndex - 1] : null;

    // 2. Base Pitch Black Background
    ctx.fillStyle = '#05070d';
    ctx.fillRect(0, 0, width, height);

    // 3. Draw Full Canvas Background Image with Ken Burns (with auto-fallback to any valid loaded image)
    let img: HTMLImageElement | null = null;
    if (currentScene && currentScene.imageUrl && preloadedImages.has(currentScene.imageUrl)) {
      const candidate = preloadedImages.get(currentScene.imageUrl)!;
      if (candidate.complete && candidate.naturalWidth > 0) {
        img = candidate;
      }
    }

    // If current scene's image failed or was empty, fall back to any other valid loaded image
    if (!img) {
      for (const [_, validCandidate] of preloadedImages.entries()) {
        if (validCandidate && validCandidate.complete && validCandidate.naturalWidth > 0) {
          img = validCandidate;
          break;
        }
      }
    }

    if (img) {
      const sceneDuration = Math.max(1, currentScene?.duration || 10);
      const sceneProgress = Math.min(1, Math.max(0, (currentTime - (currentScene?.startTime || 0)) / sceneDuration));

      // Ken Burns: scale 1.02 -> 1.15 smoothly with slight horizontal drift
      const scale = 1.02 + sceneProgress * 0.13;
      const panX = (sceneProgress - 0.5) * 50;
      const panY = (sceneProgress - 0.5) * 30;

      this.drawImageAspectFill(ctx, img, width, height, scale, panX, panY);

      // 0.5s Smooth Crossfade Transition from previous scene
      if (prevScene && prevScene.imageUrl && preloadedImages.has(prevScene.imageUrl) && currentScene && (currentTime - currentScene.startTime) < 0.5) {
        const fadeProgress = (currentTime - currentScene.startTime) / 0.5;
        const prevImg = preloadedImages.get(prevScene.imageUrl)!;
        if (prevImg.complete && prevImg.naturalWidth > 0) {
          ctx.save();
          ctx.globalAlpha = 1 - fadeProgress;
          this.drawImageAspectFill(ctx, prevImg, width, height, 1.15, 25, 15);
          ctx.restore();
        }
      }
    }

    // 4. Dark Side Fade Gradient Overlay (Left to Right)
    // Dark/Opaque on the left for crisp text readability, fading to transparent on the right so artwork shines
    const darkSideGrad = ctx.createLinearGradient(0, 0, width, 0);
    darkSideGrad.addColorStop(0, 'rgba(5, 8, 17, 0.94)');
    darkSideGrad.addColorStop(0.35, 'rgba(5, 8, 17, 0.88)');
    darkSideGrad.addColorStop(0.55, 'rgba(5, 8, 17, 0.60)');
    darkSideGrad.addColorStop(0.75, 'rgba(5, 8, 17, 0.25)');
    darkSideGrad.addColorStop(1, 'rgba(5, 8, 17, 0.08)');
    ctx.fillStyle = darkSideGrad;
    ctx.fillRect(0, 0, width, height);

    // Subtle Top/Bottom cinematic vignette
    const topBottomVignette = ctx.createLinearGradient(0, 0, 0, height);
    topBottomVignette.addColorStop(0, 'rgba(0, 0, 0, 0.45)');
    topBottomVignette.addColorStop(0.2, 'rgba(0, 0, 0, 0.0)');
    topBottomVignette.addColorStop(0.75, 'rgba(0, 0, 0, 0.1)');
    topBottomVignette.addColorStop(1, 'rgba(0, 0, 0, 0.75)');
    ctx.fillStyle = topBottomVignette;
    ctx.fillRect(0, 0, width, height);

    // 5. Left Info Overlay Content (Chapter Title & Bullets)
    const textStartX = 120;
    let textStartY = 200;
    const maxTextWidth = 840;

    // Chapter Title
    const chapterTitle = currentScene?.chapterTitle || videoTitle || 'Key Breakdown';
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 4;

    ctx.font = '800 48px "Inter", "Noto Sans Tamil", "Segoe UI", sans-serif';
    ctx.fillStyle = '#ffffff';
    textStartY = this.wrapAndDrawText(ctx, chapterTitle, textStartX, textStartY, maxTextWidth, 58, 3);

    // Accent Line Divider (YouTube Red Accent)
    textStartY += 20;
    ctx.fillStyle = '#ff0033';
    ctx.fillRect(textStartX, textStartY, 80, 5);
    textStartY += 38;

    // Bullet Points / Key Takeaways
    const bullets = currentScene?.bulletPoints || [
      'Comprehensive in-depth breakdown',
      'Detailed community analysis',
      'Key findings and evidence'
    ];

    for (let i = 0; i < bullets.length; i++) {
      const bulletText = bullets[i];

      // Bullet Accent Marker (Red dot / diamond)
      ctx.fillStyle = '#ff4d6d';
      ctx.font = '800 24px "Inter", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('•', textStartX, textStartY);

      // Bullet Text
      ctx.font = '600 28px "Inter", "Noto Sans Tamil", "Segoe UI", sans-serif';
      ctx.fillStyle = '#f1f5f9';
      textStartY = this.wrapAndDrawText(ctx, bulletText, textStartX + 30, textStartY, maxTextWidth - 30, 40, 2) + 26;
    }
    ctx.restore();

    // 6. Yellow Subtitles at Bottom Center (High Contrast & Glowing)
    const activeSub = subtitles.find(s => currentTime >= s.start && currentTime <= s.end);
    if (activeSub && activeSub.text) {
      ctx.save();
      const subBoxW = Math.min(1560, Math.max(650, activeSub.text.length * 30 + 90));
      const subBoxX = (width - subBoxW) / 2;
      const subBoxY = 900;
      const subBoxH = 84;

      // Dark semi-transparent glowing pill
      ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
      ctx.shadowBlur = 24;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.88)';
      this.roundRect(ctx, subBoxX, subBoxY, subBoxW, subBoxH, 18);
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.strokeStyle = 'rgba(255, 230, 0, 0.35)';
      ctx.lineWidth = 2;
      this.roundRect(ctx, subBoxX, subBoxY, subBoxW, subBoxH, 18);
      ctx.stroke();

      // Yellow Subtitle Text (Meme Yellow)
      ctx.font = '800 36px "Inter", "Noto Sans Tamil", "Baloo Thambi 2", "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#FFE600';
      ctx.fillText(activeSub.text.toUpperCase(), width / 2, subBoxY + 54);
      ctx.restore();
    }
  }

  /**
   * Export the complete 1080p landscape video using MediaRecorder and Web Audio API.
   */
  public async exportVideo(
    audioBlob: Blob,
    scenes: VideoScene[],
    subtitles: SubtitleSegment[],
    videoTitle: string,
    preloadedImages: Map<string, HTMLImageElement>,
    fps: number = 60,
    onProgress: (percent: number) => void
  ): Promise<Blob> {
    return new Promise(async (resolve, reject) => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 1920;
        canvas.height = 1080;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('Could not get 2D context for 1080p video canvas');
        }
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // Initialize Web Audio Context
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        const audioCtx = new AudioContextClass();
        if (audioCtx.state === 'suspended') {
          await audioCtx.resume();
        }

        const dest = audioCtx.createMediaStreamDestination();
        const ttsArrayBuffer = await audioBlob.arrayBuffer();
        const ttsBuffer = await audioCtx.decodeAudioData(ttsArrayBuffer);
        const duration = ttsBuffer.duration;

        const ttsSource = audioCtx.createBufferSource();
        ttsSource.buffer = ttsBuffer;

        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 64;
        const freqData = new Uint8Array(analyser.frequencyBinCount);

        ttsSource.connect(analyser);
        analyser.connect(dest);

        // Combine Canvas Video Stream & Audio Stream
        const targetFps = fps > 0 ? fps : 60;
        const canvasStream = canvas.captureStream(targetFps);
        const combinedStream = new MediaStream([
          ...canvasStream.getVideoTracks(),
          ...dest.stream.getAudioTracks()
        ]);

        // Supported Mime Types
        let mimeType = 'video/webm; codecs=vp9,opus';
        if (MediaRecorder.isTypeSupported('video/mp4; codecs="avc1.42E01E, mp4a.40.2"')) {
          mimeType = 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"';
        } else if (MediaRecorder.isTypeSupported('video/mp4')) {
          mimeType = 'video/mp4';
        } else if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = 'video/webm';
        }

        const bitrate = targetFps >= 60 ? 14000000 : 9000000;
        console.log(`[YouTube Video Exporter] Starting 1080p export @ ${targetFps} FPS (${mimeType})`);

        const mediaRecorder = new MediaRecorder(combinedStream, {
          mimeType,
          videoBitsPerSecond: bitrate,
          audioBitsPerSecond: 192000
        });

        const chunks: Blob[] = [];
        mediaRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunks.push(e.data);
        };

        let isRecording = true;
        let animationFrameId: number;
        let startTimestamp = 0;

        mediaRecorder.onstop = () => {
          isRecording = false;
          cancelAnimationFrame(animationFrameId);

          combinedStream.getTracks().forEach(t => t.stop());
          canvasStream.getTracks().forEach(t => t.stop());

          try {
            ttsSource.disconnect();
            analyser.disconnect();
            audioCtx.close();
          } catch (e) {}

          const finalBlob = new Blob(chunks, { type: mimeType });
          resolve(finalBlob);
        };

        const drawLoop = () => {
          if (!isRecording) return;
          const elapsed = audioCtx.currentTime - startTimestamp;
          const percent = Math.min(100, Math.max(0, (elapsed / duration) * 100));
          onProgress(percent);

          analyser.getByteFrequencyData(freqData);

          this.renderFrame(
            ctx,
            elapsed,
            duration,
            scenes,
            subtitles,
            videoTitle,
            preloadedImages,
            freqData
          );

          if (elapsed >= duration) {
            mediaRecorder.stop();
            return;
          }

          animationFrameId = requestAnimationFrame(drawLoop);
        };

        mediaRecorder.start();
        startTimestamp = audioCtx.currentTime;
        ttsSource.start(0);
        drawLoop();

      } catch (err) {
        reject(err);
      }
    });
  }
}
