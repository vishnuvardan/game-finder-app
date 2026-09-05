import { Injectable } from '@angular/core';

export interface SubtitleSegment {
  text: string;
  start: number;
  end: number;
}

@Injectable({
  providedIn: 'root'
})
export class CanvasRecorderService {
  private sharedAudioCtx: AudioContext | null = null;

  constructor() {}

  private getAudioContext(): AudioContext {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!this.sharedAudioCtx || this.sharedAudioCtx.state === 'closed') {
      this.sharedAudioCtx = new AudioContextClass();
    }
    return this.sharedAudioCtx;
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
    lineHeight: number
  ) {
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

    // Center lines vertically around the y anchor
    const totalHeight = lines.length * lineHeight;
    let currentY = y - (totalHeight / 2) + (lineHeight / 2);

    for (let i = 0; i < lines.length; i++) {
      ctx.strokeText(lines[i], x, currentY);
      ctx.fillText(lines[i], x, currentY);
      currentY += lineHeight;
    }
  }


  /**
   * Render offscreen and capture stream using MediaRecorder.
   */
  async exportReel(
    videoEl: HTMLVideoElement,
    ttsAudioBlob: Blob,
    title: string,
    subtitles: SubtitleSegment[],
    startTime: number,
    duration: number,
    gameVolume: number,
    videoZoom: number = 0,
    quality: 'standard' | 'high' = 'standard',
    onProgress: (progress: number) => void
  ): Promise<Blob> {
    return new Promise(async (resolve, reject) => {
      try {
        const isHighQuality = quality === 'high';
        const targetFps = isHighQuality ? 60 : 30;

        // 1. Create offscreen canvas
        const canvas = document.createElement('canvas');
        canvas.width = 1080;
        canvas.height = 1920;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('Could not get 2D context for export canvas');
        }
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = isHighQuality ? 'high' : 'medium';

        // 2. Initialize AudioContext for mixing
        const audioCtx = this.getAudioContext();
        if (audioCtx.state === 'suspended') {
          await audioCtx.resume();
        }
        const dest = audioCtx.createMediaStreamDestination();

        // 3. Connect video audio
        let videoSource: MediaElementAudioSourceNode | null = (videoEl as any)._audioSourceNode || null;
        if (!videoSource || (videoEl as any)._audioCtx !== audioCtx) {
          try {
            videoSource = audioCtx.createMediaElementSource(videoEl);
            (videoEl as any)._audioSourceNode = videoSource;
            (videoEl as any)._audioCtx = audioCtx;
          } catch (e) {
            console.warn('[CanvasRecorder] createMediaElementSource notice:', e);
          }
        }
        
        const videoGain = audioCtx.createGain();
        videoGain.gain.value = gameVolume; // Duck background audio to user selected level
        if (videoSource) {
          try {
            videoSource.connect(videoGain);
            videoGain.connect(dest);
          } catch (e) {
            console.warn('[CanvasRecorder] videoSource connect error:', e);
          }
        }

        // 4. Decode TTS audio blob
        const ttsArrayBuffer = await ttsAudioBlob.arrayBuffer();
        const ttsBuffer = await audioCtx.decodeAudioData(ttsArrayBuffer).catch(err => {
          throw new Error('Failed to decode TTS audio: ' + err.message);
        });

        const ttsSource = audioCtx.createBufferSource();
        ttsSource.buffer = ttsBuffer;
        
        const ttsGain = audioCtx.createGain();
        ttsGain.gain.value = 1.0; // Keep voiceover at 100%
        ttsSource.connect(ttsGain);
        ttsGain.connect(dest);

        // 5. Combine Canvas Video Track (configured FPS) and Audio Destination Track
        const canvasStream = canvas.captureStream(targetFps);
        const audioTracks = dest.stream.getAudioTracks();
        const combinedStream = new MediaStream([
          ...canvasStream.getVideoTracks(),
          ...audioTracks
        ]);

        // 6. Set up MediaRecorder
        let mimeType = 'video/webm; codecs=vp9,opus';
        if (MediaRecorder.isTypeSupported('video/mp4; codecs="avc1.42E01E, mp4a.40.2"')) {
          mimeType = 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"';
        } else if (MediaRecorder.isTypeSupported('video/mp4')) {
          mimeType = 'video/mp4';
        } else if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = 'video/webm';
        }

        // Standard Quality: 4.0 Mbps @ 30 FPS (rock-solid on mobile browsers without OOM/buffer crash)
        // High Quality: 14.0 Mbps @ 60 FPS (ultra-smooth for desktop GPUs)
        const videoBitrate = isHighQuality ? 14000000 : 4000000;
        console.log(`Starting export [${quality.toUpperCase()} QUALITY] at ${targetFps} FPS using MIME type: ${mimeType} with bitrate: ${videoBitrate / 1000000} Mbps`);
        const mediaRecorder = new MediaRecorder(combinedStream, {
          mimeType,
          videoBitsPerSecond: videoBitrate,
          audioBitsPerSecond: 128000
        });
        const chunks: Blob[] = [];

        mediaRecorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            chunks.push(event.data);
          }
        };

        let isRecording = true;
        let animationFrameId: number;
        let audioStartTime = 0;

        mediaRecorder.onstop = () => {
          isRecording = false;
          cancelAnimationFrame(animationFrameId);
          
          combinedStream.getTracks().forEach(track => track.stop());
          canvasStream.getTracks().forEach(track => track.stop());
          
          try {
            ttsSource.disconnect();
            ttsGain.disconnect();
            if (videoSource) {
              try { videoSource.disconnect(videoGain); } catch (e) {}
            }
            videoGain.disconnect();
          } catch (e) {
            console.error('Clean up error:', e);
          }

          // Restore video element settings for preview
          videoEl.volume = gameVolume;
          videoEl.muted = (gameVolume === 0);

          if (!videoEl.paused) {
            try { videoEl.pause(); } catch (e) {}
          }

          const finalBlob = new Blob(chunks, { type: mimeType });
          resolve(finalBlob);
        };

        // 7. Single-frame renderer
        const renderSingleFrame = (elapsed: number) => {
          // Render Black Background
          ctx.fillStyle = '#000000';
          ctx.fillRect(0, 0, 1080, 1920);

          // Calculate centered contain video dimensions inside 1080x1920 canvas
          let baseWidth = 1080;
          let baseHeight = 607.5;
          if (videoEl.videoWidth > 0) {
            const aspect = videoEl.videoHeight / videoEl.videoWidth;
            baseHeight = aspect * 1080;
          }
          if (baseHeight > 1920) {
            baseHeight = 1920;
          }

          // Calculate scale factor: zoom 0 = default contain, zoom 100 = full 9:16 vertical fill
          const maxScale = (videoEl.videoWidth > 0 && videoEl.videoHeight > 0)
            ? Math.max(1, (1920 * videoEl.videoWidth) / (1080 * videoEl.videoHeight))
            : (1920 / 607.5);
          const clampedZoom = Math.max(0, Math.min(100, videoZoom));
          const currentScale = 1 + (clampedZoom / 100) * (maxScale - 1);

          const vWidth = baseWidth * currentScale;
          const vHeight = baseHeight * currentScale;
          const vX = (1080 - vWidth) / 2;
          const vY = (1920 - vHeight) / 2;

          // Render Video (centered with zoom applied)
          if (videoEl.videoWidth > 0) {
            ctx.drawImage(videoEl, vX, vY, vWidth, vHeight);
          }

          // Render Top Title (Impact / Tamil bold style - fixed top safe zone at y=380)
          ctx.font = '900 72px Impact, "Noto Sans Tamil", "Baloo Thambi 2", "Nirmala UI", "Arial Black", sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = '#FFFFFF';
          ctx.strokeStyle = '#000000';
          ctx.lineWidth = 12;
          
          const titleCenterY = 380;
          this.wrapAndDrawText(ctx, title.toUpperCase(), 540, titleCenterY, 980, 88);

          // Find active subtitle and render at fixed bottom safe zone (y=1480)
          const activeSub = subtitles.find(sub => elapsed >= sub.start && elapsed <= sub.end);
          if (activeSub) {
            ctx.font = '800 64px Impact, "Noto Sans Tamil", "Baloo Thambi 2", "Nirmala UI", "Arial Black", sans-serif';
            ctx.fillStyle = '#FFE600'; // Meme yellow for subtitle highlight
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 10;
            
            const subCenterY = 1480;
            this.wrapAndDrawText(ctx, activeSub.text.toUpperCase(), 540, subCenterY, 980, 78);
          }
        };

        // 8. Start Playback and Recording in lockstep
        videoEl.loop = true; // Ensure video looping is enabled during export
        // Keep video unmuted so createMediaElementSource receives audio signal
        videoEl.muted = (gameVolume === 0);
        videoEl.volume = 1.0;

        // Ensure video is at startTime and has loaded frame data before starting recording
        await new Promise<void>((res) => {
          if (Math.abs(videoEl.currentTime - startTime) < 0.05 && videoEl.readyState >= 2) {
            res();
            return;
          }
          let resolved = false;
          const done = () => {
            if (resolved) return;
            resolved = true;
            videoEl.removeEventListener('seeked', done);
            res();
          };
          videoEl.addEventListener('seeked', done);
          videoEl.currentTime = startTime;
          setTimeout(done, 1500); // Safety fallback in case seeked already completed
        });

        // Pre-paint initial frame to canvas so MediaRecorder has a valid frame from millisecond 0
        renderSingleFrame(0);

        // Start video playback and confirm decoder is running
        try {
          await videoEl.play();
        } catch (e: any) {
          throw new Error('Failed to start video playback during export: ' + e.message);
        }

        // Brief warm-up (60ms) to allow GPU video decoder to begin frame delivery smoothly
        await new Promise((r) => setTimeout(r, 60));

        // Start synchronized recording and audio
        audioStartTime = audioCtx.currentTime;
        mediaRecorder.start();
        ttsSource.start(0);

        const drawFrame = () => {
          if (!isRecording) return;

          const elapsed = audioCtx.currentTime - audioStartTime;
          const progress = Math.min(100, Math.max(0, (elapsed / duration) * 100));
          onProgress(progress);

          // If video element somehow paused during export, keep it playing
          if (videoEl.paused) {
            videoEl.play().catch(() => {});
          }

          renderSingleFrame(elapsed);

          // Check if finished
          if (elapsed >= duration) {
            mediaRecorder.stop();
            return;
          }

          animationFrameId = requestAnimationFrame(drawFrame);
        };

        drawFrame();

      } catch (error: any) {
        reject(error);
      }
    });
  }
}
