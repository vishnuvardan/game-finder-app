import { Component, ElementRef, OnInit, OnDestroy, ViewChild, signal, WritableSignal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GeminiClientService, SubtitleSegment, ShortsScriptResponse } from '../services/gemini-client.service';
import { CanvasRecorderService } from '../services/canvas-recorder.service';

@Component({
  selector: 'app-shorts-creator',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './shorts-creator.component.html',
  styleUrl: './shorts-creator.component.css'
})
export class ShortsCreatorComponent implements OnInit, OnDestroy {
  @ViewChild('previewVideo') previewVideo!: ElementRef<HTMLVideoElement>;
  @ViewChild('previewImage') previewImage?: ElementRef<HTMLImageElement>;
  @ViewChild('timelineTrack') timelineTrack!: ElementRef<HTMLDivElement>;

  // Wizard state: upload -> studio -> exporting -> completed
  protected step: WritableSignal<'upload' | 'studio' | 'exporting' | 'completed'> = signal('upload');

  // Input states
  protected promptTopic = signal('');
  protected scriptLanguage = signal<'en' | 'ta'>('en');
  protected voiceSelection = signal('en-US-ChristopherNeural');
  protected scriptTone = signal('controversial'); // Tone of the narration script
  protected gameVolume = signal(0.15); // Default game volume is 15%
  protected videoZoom = signal(0); // 0% = default contain, 100% = full screen vertical fill
  protected exportQuality = signal<'standard' | 'high'>((typeof window !== 'undefined' && window.innerWidth > 768) ? 'high' : 'standard'); // 'standard' = 30 FPS / 4Mbps (Mobile safe), 'high' = 60 FPS / 14Mbps (Desktop)
  protected exportSuccessMessage = signal<string | null>(null);
  protected lastExportedFileName = signal<string>('');

  // Voice catalogue definition (2 voices per language: Deep Bass Male & Natural Female)
  protected englishVoices = [
    { id: 'en-US-ChristopherNeural', label: '🎙️ Christopher (US Male - Deep Bass)' },
    { id: 'en-US-JennyNeural', label: '🌸 Jenny (US Female - Natural & Clear)' }
  ];

  protected tamilVoices = [
    { id: 'ta-IN-ValluvarNeural', label: '👑 வள்ளுவர் / Valluvar (Deep Bass Male)' },
    { id: 'ta-IN-PallaviNeural', label: '🌸 பல்லவி / Pallavi (Clear Female)' }
  ];
  
  // File uploads (Video or Image)
  protected mediaType: WritableSignal<'video' | 'image'> = signal('video');
  protected videoFile: WritableSignal<File | null> = signal(null);
  protected uploadedVideoUrl: WritableSignal<string | null> = signal(null);
  protected videoDuration = signal(0);
  protected videoWidth = signal(0);
  protected videoHeight = signal(0);

  // Generated Script States
  protected shortsTitle = signal('');
  protected shortsScript = signal('');
  protected subtitles: WritableSignal<SubtitleSegment[]> = signal([]);

  // TTS Audio synthesis states
  protected ttsAudioBlob: WritableSignal<Blob | null> = signal(null);
  protected ttsAudioUrl: WritableSignal<string | null> = signal(null);
  protected ttsDuration = signal(0);

  // Studio Timeline Selection States
  protected selectedStartTime = signal(0);
  protected isPlaying = signal(false);
  protected activeSubtitleText = signal('');

  // Export / Progress states
  protected isGeneratingScript = signal(false);
  protected isExporting = signal(false);
  protected exportProgress = signal(0);
  protected generatedVideoUrl: WritableSignal<string | null> = signal(null);
  protected exportError = signal('');

  // Instagram Publish states
  protected isPublishModalOpen = signal(false);
  protected publishPassword = signal('');
  protected publishStep = signal<'idle' | 'uploading' | 'publishing' | 'success' | 'error'>('idle');
  protected publishProgressText = signal('');
  protected publishSuccess = signal<string | null>(null);
  protected errorMessage = signal<string | null>(null);
  protected exportedVideoBlob: Blob | null = null;

  // Audio preview reference
  private previewAudio: HTMLAudioElement | null = null;
  private syncTimerId: any;

  // Timeline UI Computed values
  protected windowWidthPercent = computed(() => {
    const total = this.videoDuration();
    const active = this.ttsDuration();
    if (total <= 0) return 0;
    return Math.min(100, (active / total) * 100);
  });

  protected windowLeftPercent = computed(() => {
    const total = this.videoDuration();
    const start = this.selectedStartTime();
    if (total <= 0) return 0;
    return Math.min(100 - this.windowWidthPercent(), (start / total) * 100);
  });

  protected maxStartTime = computed(() => {
    return Math.max(0, this.videoDuration() - this.ttsDuration());
  });

  // Calculate live preview CSS scale based on video/image aspect ratio and zoom percentage
  protected previewScale = computed(() => {
    const w = this.videoWidth();
    const h = this.videoHeight();
    const canvasW = 1080;
    const canvasH = 1920;
    let baseW = canvasW;
    let baseH = canvasH;

    if (w > 0 && h > 0) {
      const mediaAspect = w / h;
      const canvasAspect = canvasW / canvasH; // 0.5625 (9:16)
      if (mediaAspect > canvasAspect) {
        baseW = canvasW;
        baseH = canvasW / mediaAspect;
      } else {
        baseH = canvasH;
        baseW = canvasH * mediaAspect;
      }
    } else {
      baseW = canvasW;
      baseH = 607.5;
    }

    const fillScale = (baseW > 0 && baseH > 0)
      ? Math.max(canvasW / baseW, canvasH / baseH)
      : (1920 / 607.5);

    // Ensure all media can zoom in up to at least 2.5x even if already 9:16
    const maxScale = Math.max(fillScale, 2.5);
    const zoom = Math.max(0, Math.min(100, this.videoZoom()));
    return 1 + (zoom / 100) * (maxScale - 1);
  });

  constructor(
    private geminiClient: GeminiClientService,
    private canvasRecorder: CanvasRecorderService
  ) {}

  ngOnInit() {
  }

  ngOnDestroy() {
    this.stopSyncLoop();
    this.cleanupObjectURLs();
  }

  // Switch script language and default to the best corresponding voice
  protected onLanguageChange(lang: 'en' | 'ta') {
    this.scriptLanguage.set(lang);
    if (lang === 'ta') {
      this.voiceSelection.set('ta-IN-ValluvarNeural'); // Default to Valluvar (Deep Bass)
    } else {
      this.voiceSelection.set('en-US-ChristopherNeural'); // Default to Christopher (Deep Bass)
    }
  }

  // Handle local video or image selection
  protected onVideoSelected(event: Event) {
    this.onMediaSelected(event);
  }

  protected onImageLoaded(event: Event) {
    const img = event.target as HTMLImageElement;
    if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
      this.videoWidth.set(img.naturalWidth);
      this.videoHeight.set(img.naturalHeight);
    }
  }

  protected onMediaSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      const isImage = file.type.startsWith('image/');
      this.mediaType.set(isImage ? 'image' : 'video');
      this.videoFile.set(file);
      
      // Cleanup previous object URLs
      this.cleanupObjectURLs();

      const url = URL.createObjectURL(file);
      this.uploadedVideoUrl.set(url);

      if (isImage) {
        const img = new Image();
        img.onload = () => {
          if (img.naturalWidth > 0 && img.naturalHeight > 0) {
            this.videoWidth.set(img.naturalWidth);
            this.videoHeight.set(img.naturalHeight);
          }
          this.videoDuration.set(0);
          this.selectedStartTime.set(0);
        };
        img.src = url;
        if (img.complete && img.naturalWidth > 0) {
          this.videoWidth.set(img.naturalWidth);
          this.videoHeight.set(img.naturalHeight);
        }
      } else {
        // Create a temporary video element to read metadata
        const tempVideo = document.createElement('video');
        tempVideo.src = url;
        tempVideo.addEventListener('loadedmetadata', () => {
          this.videoDuration.set(tempVideo.duration);
          this.videoWidth.set(tempVideo.videoWidth);
          this.videoHeight.set(tempVideo.videoHeight);
          
          // Default start time is 0
          this.selectedStartTime.set(0);
        });
      }
    }
  }

  // Orchestrate Gemini Script + TTS synthesis
  protected async generateScriptAndNarration() {
    if (!this.uploadedVideoUrl()) {
      alert('Please upload a background video or image file first.');
      return;
    }
    if (!this.promptTopic().trim()) {
      alert('Please enter a topic prompt for the narrative.');
      return;
    }

    this.isGeneratingScript.set(true);
    this.exportError.set('');

    try {
      // Call backend proxy to generate script and subtitles with chosen tone and language
      const result = await this.geminiClient.generateScriptProxy(
        this.promptTopic(), 
        this.scriptTone(), 
        this.scriptLanguage()
      ).toPromise() as ShortsScriptResponse;

      this.shortsTitle.set(result.title);
      this.shortsScript.set(result.script);

      // Fixed voice parameters: -15Hz pitch for Deep Bass Male, +30% rate for energetic shorts pace
      const isBassMale = (this.voiceSelection() === 'en-US-ChristopherNeural' || this.voiceSelection() === 'ta-IN-ValluvarNeural');
      const pitch = isBassMale ? '-15Hz' : 'default';
      const rate = '+30%';

      // Fetch TTS Audio from backend proxy using chosen neural voice and inputting Gemini subtitles
      const ttsResponse = await this.geminiClient.generateTtsProxy(
        result.script, 
        result.subtitles || [], 
        this.voiceSelection(),
        rate,
        pitch
      ).toPromise();

      if (!ttsResponse || !ttsResponse.audio) {
        throw new Error('Invalid response received from TTS proxy synthesizer');
      }

      // Decode base64 audio to Blob
      const byteCharacters = atob(ttsResponse.audio);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const ttsBlob = new Blob([byteArray], { type: 'audio/mpeg' });

      this.ttsAudioBlob.set(ttsBlob);
      
      const audioUrl = URL.createObjectURL(ttsBlob);
      this.ttsAudioUrl.set(audioUrl);
      
      // Measure duration using Web Audio API
      let measuredDuration = 0;
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        const tempCtx = new AudioContextClass();
        const arrayBuffer = await ttsBlob.arrayBuffer();
        const decoded = await tempCtx.decodeAudioData(arrayBuffer);
        measuredDuration = decoded.duration;
        await tempCtx.close();
      } catch (e) {
        console.warn('Could not decode audio duration via Web Audio, fallback estimate applied', e);
        const wordCount = result.script.split(/\s+/).length;
        measuredDuration = wordCount / 2.5; // fallback
      }
      this.ttsDuration.set(measuredDuration);

      this.previewAudio = new Audio(audioUrl);

      // Directly set the aligned subtitles returned by the backend
      this.subtitles.set(ttsResponse.subtitles || []);

      // Transition to Studio view
      this.step.set('studio');

      // Pause and load video preview if video mode
      setTimeout(() => {
        if (this.mediaType() === 'video' && this.previewVideo) {
          const video = this.previewVideo.nativeElement;
          video.currentTime = 0;
        }
      }, 100);

    } catch (error: any) {
      console.error(error);
      this.exportError.set(error.message || 'Script generation failed. Please check your inputs or network connection.');
    } finally {
      this.isGeneratingScript.set(false);
    }
  }



  // Audio/Video/Image preview playback controls
  protected togglePlay() {
    const isVideo = this.mediaType() === 'video';
    const video = isVideo && this.previewVideo ? this.previewVideo.nativeElement : null;
    
    if (this.isPlaying()) {
      if (video) {
        video.pause();
      }
      if (this.previewAudio) {
        this.previewAudio.pause();
      }
      this.isPlaying.set(false);
      this.stopSyncLoop();
    } else {
      const currentOffset = this.previewAudio ? this.previewAudio.currentTime : 0;
      if (video) {
        video.currentTime = video.duration ? (this.selectedStartTime() + currentOffset) % video.duration : (this.selectedStartTime() + currentOffset);
        video.muted = false; // Enable preview volume
        video.volume = this.gameVolume(); // Apply chosen game volume
        video.play().catch(e => console.error(e));
      }
      
      if (this.previewAudio) {
        this.previewAudio.play().catch(e => console.error(e));
      }
      
      this.isPlaying.set(true);
      this.startSyncLoop();
    }
  }

  protected onVolumeChanged(volume: number) {
    this.gameVolume.set(volume);
    if (this.previewVideo) {
      const video = this.previewVideo.nativeElement;
      video.volume = volume;
      // Also sync actual video element muted state
      video.muted = volume === 0;
    }
  }

  protected getRoundedVolume(): number {
    return Math.round(this.gameVolume() * 100);
  }

  protected onZoomChanged(zoom: number | string) {
    const val = typeof zoom === 'string' ? parseFloat(zoom) : zoom;
    this.videoZoom.set(isNaN(val) ? 0 : Math.max(0, Math.min(100, Math.round(val))));
  }

  protected setZoom(zoom: number) {
    this.videoZoom.set(Math.max(0, Math.min(100, Math.round(zoom))));
  }

  protected setQuality(quality: 'standard' | 'high') {
    this.exportQuality.set(quality);
  }

  private startSyncLoop() {
    this.stopSyncLoop();
    
    const sync = () => {
      if (!this.isPlaying()) return;
      const isVideo = this.mediaType() === 'video';
      const video = isVideo && this.previewVideo ? this.previewVideo.nativeElement : null;
      
      if (this.previewAudio) {
        const audioTime = this.previewAudio.currentTime;
        
        // Auto loop check when reaching end of TTS audio
        if (audioTime >= this.ttsDuration() - 0.1) {
          this.resetPlayback();
          this.togglePlay(); // Restart playback loop
          return;
        }

        // Display current active subtitle phrase
        const activeSub = this.subtitles().find(sub => audioTime >= sub.start && audioTime <= sub.end);
        this.activeSubtitleText.set(activeSub ? activeSub.text : '');

        // Re-align video stream position if they drift apart by more than 0.3s
        if (video) {
          const expectedVideoTime = video.duration ? (this.selectedStartTime() + audioTime) % video.duration : (this.selectedStartTime() + audioTime);
          if (Math.abs(video.currentTime - expectedVideoTime) > 0.3) {
            video.currentTime = expectedVideoTime;
          }
        }
      } else if (video) {
        const elapsed = video.currentTime - this.selectedStartTime();
        if (elapsed >= this.ttsDuration() || video.currentTime >= video.duration) {
          this.resetPlayback();
          return;
        }
      }
      
      this.syncTimerId = requestAnimationFrame(sync);
    };
    
    this.syncTimerId = requestAnimationFrame(sync);
  }

  private stopSyncLoop() {
    if (this.syncTimerId) {
      cancelAnimationFrame(this.syncTimerId);
      this.syncTimerId = null;
    }
  }

  private resetPlayback() {
    if (this.mediaType() === 'video' && this.previewVideo) {
      const video = this.previewVideo.nativeElement;
      video.pause();
      video.currentTime = this.selectedStartTime();
    }
    
    if (this.previewAudio) {
      this.previewAudio.pause();
      this.previewAudio.currentTime = 0;
    }
    
    this.isPlaying.set(false);
    this.activeSubtitleText.set('');
    this.stopSyncLoop();
  }

  /**
   * Native Timeline Scrubber change handler (works smoothly on mobile touchscreens and desktop mice)
   */
  protected onTimelineSliderChange(event: Event) {
    const input = event.target as HTMLInputElement;
    const val = Math.max(0, Math.min(this.maxStartTime(), Number(input.value) || 0));
    this.selectedStartTime.set(val);

    if (this.previewVideo) {
      this.previewVideo.nativeElement.currentTime = val;
    }
    if (this.previewAudio) {
      this.previewAudio.currentTime = 0;
    }
  }

  // Handle caption edits
  protected updateCaptionText(index: number, event: Event) {
    const val = (event.target as HTMLInputElement).value;
    const subs = [...this.subtitles()];
    subs[index].text = val;
    this.subtitles.set(subs);
  }

  // Run Canvas export sequence
  protected async exportReel() {
    this.resetPlayback();
    this.step.set('exporting');
    this.isExporting.set(true);
    this.exportProgress.set(0);
    this.exportError.set('');
    this.exportSuccessMessage.set(null);

    try {
      let mediaElement: HTMLVideoElement | HTMLImageElement;
      if (this.mediaType() === 'image') {
        if (!this.previewImage) {
          throw new Error('Preview image element is missing');
        }
        mediaElement = this.previewImage.nativeElement;
      } else {
        if (!this.previewVideo) {
          throw new Error('Preview video element is missing');
        }
        mediaElement = this.previewVideo.nativeElement;
      }

      const audioBlob = this.ttsAudioBlob();
      
      if (!audioBlob) {
        throw new Error('Narration audio is missing');
      }

      // Execute in-browser recording pipeline
      const finalVideoBlob = await this.canvasRecorder.exportReel(
        mediaElement,
        audioBlob,
        this.shortsTitle(),
        this.subtitles(),
        this.selectedStartTime(),
        this.ttsDuration(),
        this.gameVolume(),
        this.videoZoom(),
        this.exportQuality(),
        (progress) => {
          this.exportProgress.set(Math.round(progress));
        }
      );

      this.exportedVideoBlob = finalVideoBlob;
      const videoUrl = URL.createObjectURL(finalVideoBlob);
      this.generatedVideoUrl.set(videoUrl);

      // Auto trigger browser download using sanitized title as filename
      const extension = finalVideoBlob.type.includes('mp4') ? 'mp4' : 'webm';
      const sanitizedTitle = this.shortsTitle().trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '').slice(0, 60);
      const defaultName = this.scriptLanguage() === 'ta' ? 'tamil_reel' : 'viral_short';
      const fileName = sanitizedTitle || defaultName;
      const a = document.createElement('a');
      a.href = videoUrl;
      a.download = `${fileName}.${extension}`;
      a.click();

      // Stay on studio page and notify user so they can preview, re-render, or edit
      this.step.set('studio');
      this.lastExportedFileName.set(`${fileName}.${extension}`);
      this.exportSuccessMessage.set(`Reel successfully exported! Downloaded as ${fileName}.${extension}`);

    } catch (err: any) {
      console.error(err);
      this.exportError.set(err.message || 'Export rendering failed. Try refreshing the video file.');
      this.step.set('studio');
    } finally {
      this.isExporting.set(false);
    }
  }

  protected dismissExportSuccess() {
    this.exportSuccessMessage.set(null);
  }

  protected openPublishModal() {
    this.publishPassword.set('');
    this.publishStep.set('idle');
    this.publishProgressText.set('');
    this.errorMessage.set(null);
    this.publishSuccess.set(null);
    this.isPublishModalOpen.set(true);
  }

  protected closePublishModal() {
    this.isPublishModalOpen.set(false);
  }

  protected async startInstagramPublish() {
    const pwd = this.publishPassword().trim();
    if (!pwd) {
      this.errorMessage.set('Password is required to publish.');
      this.publishStep.set('error');
      return;
    }

    if (!this.exportedVideoBlob) {
      this.errorMessage.set('No exported video found. Please render the video first.');
      this.publishStep.set('error');
      return;
    }

    this.publishStep.set('uploading');
    this.publishProgressText.set('Preparing video for upload...');

    try {
      const reader = new FileReader();
      reader.readAsDataURL(this.exportedVideoBlob);
      reader.onloadend = () => {
        const base64Video = reader.result as string;
        
        this.publishStep.set('publishing');
        this.publishProgressText.set('Uploading Reel to Instagram... This can take up to 2 minutes as Instagram processes the video.');

        const caption = `${this.shortsTitle()}\n\n${this.shortsScript()}\n\n#GamingReels #AIShorts #GamingContent`;

        this.geminiClient.publishInstagramReel(base64Video, caption, pwd).subscribe({
          next: (res) => {
            this.publishStep.set('success');
            this.publishProgressText.set('');
            this.publishSuccess.set(`Published successfully! Post ID: ${res.postId}`);
          },
          error: (err) => {
            this.publishStep.set('error');
            const errMsg = this.parseErrorMessage(err, 'Failed to publish Reel to Instagram. Verify your password or credentials.');
            this.errorMessage.set(errMsg);
            this.publishProgressText.set('');
          }
        });
      };
    } catch (err: any) {
      console.error(err);
      this.publishStep.set('error');
      this.errorMessage.set(err.message || 'An error occurred while preparing the video.');
      this.publishProgressText.set('');
    }
  }

  private parseErrorMessage(err: any, fallback: string): string {
    if (!err) return fallback;
    if (typeof err === 'string') return err;
    if (err.status === 413) {
      return 'Video payload is too large for the hosting server limit (Vercel max 4.5MB). Try rendering a shorter short or lower duration.';
    }
    if (err.status === 504) {
      return 'Server timeout: Instagram video processing took longer than the Vercel serverless function timeout limit (10s/15s).';
    }
    if (typeof err.error === 'string') return err.error;
    if (err.error?.error) {
      return typeof err.error.error === 'string' ? err.error.error : (err.error.error.message || JSON.stringify(err.error.error));
    }
    if (err.error?.message) {
      return typeof err.error.message === 'string' ? err.error.message : JSON.stringify(err.error.message);
    }
    if (err.message) return err.message;
    return fallback;
  }

  // Reset wizard to upload
  protected resetCreator() {
    this.cleanupObjectURLs();
    this.mediaType.set('video');
    this.videoFile.set(null);
    this.uploadedVideoUrl.set(null);
    this.videoDuration.set(0);
    this.ttsAudioBlob.set(null);
    this.ttsAudioUrl.set(null);
    this.ttsDuration.set(0);
    this.generatedVideoUrl.set(null);
    this.previewAudio = null;
    this.exportedVideoBlob = null;
    this.publishSuccess.set(null);
    this.errorMessage.set(null);
    this.videoZoom.set(0);
    this.exportSuccessMessage.set(null);
    this.lastExportedFileName.set('');
    this.exportQuality.set((typeof window !== 'undefined' && window.innerWidth > 768) ? 'high' : 'standard');
    this.step.set('upload');
  }

  // Manage object URLs memory cleanup
  private cleanupObjectURLs() {
    const prevUrl = this.uploadedVideoUrl();
    if (prevUrl) {
      URL.revokeObjectURL(prevUrl);
    }
    const ttsUrl = this.ttsAudioUrl();
    if (ttsUrl) {
      URL.revokeObjectURL(ttsUrl);
    }
    const genUrl = this.generatedVideoUrl();
    if (genUrl) {
      URL.revokeObjectURL(genUrl);
    }
  }

  // Helper UUID function
  private generateUuid(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
}
