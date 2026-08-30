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
  @ViewChild('timelineTrack') timelineTrack!: ElementRef<HTMLDivElement>;

  // Wizard state: upload -> studio -> exporting -> completed
  protected step: WritableSignal<'upload' | 'studio' | 'exporting' | 'completed'> = signal('upload');

  // Input states
  protected promptTopic = signal('');
  protected voiceSelection = signal('en-US-ChristopherNeural');
  protected scriptTone = signal('controversial'); // Tone of the narration script
  protected gameVolume = signal(0.15); // Default game volume is 15%
  
  // File uploads
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

  // Handle local video selection
  protected onVideoSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      this.videoFile.set(file);
      
      // Cleanup previous object URLs
      this.cleanupObjectURLs();

      const url = URL.createObjectURL(file);
      this.uploadedVideoUrl.set(url);

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



  // Orchestrate Gemini Script + TTS synthesis
  protected async generateScriptAndNarration() {
    if (!this.uploadedVideoUrl()) {
      alert('Please upload a background video file first.');
      return;
    }
    if (!this.promptTopic().trim()) {
      alert('Please enter a topic prompt for the rage-bait narrative.');
      return;
    }

    this.isGeneratingScript.set(true);
    this.exportError.set('');

    try {
      // Call backend proxy to generate script and subtitles with chosen tone
      const result = await this.geminiClient.generateScriptProxy(this.promptTopic(), this.scriptTone()).toPromise() as ShortsScriptResponse;

      this.shortsTitle.set(result.title);
      this.shortsScript.set(result.script);

      // Fetch TTS Audio from backend proxy using chosen neural voice and inputting Gemini subtitles
      const ttsResponse = await this.geminiClient.generateTtsProxy(
        result.script, 
        result.subtitles || [], 
        this.voiceSelection()
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

      // Pause and load video preview
      setTimeout(() => {
        if (this.previewVideo) {
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



  // Audio/Video lockstep controls
  protected togglePlay() {
    if (!this.previewVideo) return;
    const video = this.previewVideo.nativeElement;
    
    if (this.isPlaying()) {
      video.pause();
      if (this.previewAudio) {
        this.previewAudio.pause();
      }
      this.isPlaying.set(false);
      this.stopSyncLoop();
    } else {
      // Seek back to start if finished, or play from current position relative to selectedStartTime
      const currentOffset = this.previewAudio ? this.previewAudio.currentTime : 0;
      video.currentTime = this.selectedStartTime() + currentOffset;
      video.muted = false; // Enable preview volume
      video.volume = this.gameVolume(); // Apply chosen game volume
      
      if (this.previewAudio) {
        this.previewAudio.play().catch(e => console.error(e));
      }
      video.play().catch(e => console.error(e));
      
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

  private startSyncLoop() {
    this.stopSyncLoop();
    
    const sync = () => {
      if (!this.isPlaying() || !this.previewVideo) return;
      const video = this.previewVideo.nativeElement;
      
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
        const expectedVideoTime = this.selectedStartTime() + audioTime;
        if (Math.abs(video.currentTime - expectedVideoTime) > 0.3) {
          video.currentTime = expectedVideoTime;
        }
      } else {
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
    if (!this.previewVideo) return;
    const video = this.previewVideo.nativeElement;
    video.pause();
    video.currentTime = this.selectedStartTime();
    
    if (this.previewAudio) {
      this.previewAudio.pause();
      this.previewAudio.currentTime = 0;
    }
    
    this.isPlaying.set(false);
    this.activeSubtitleText.set('');
    this.stopSyncLoop();
  }

  // Range Slider Dragger
  private isDragging = false;
  private startDragX = 0;
  private startStartTime = 0;

  protected onWindowMouseDown(event: MouseEvent) {
    event.stopPropagation();
    event.preventDefault();
    
    this.isDragging = true;
    this.startDragX = event.clientX;
    this.startStartTime = this.selectedStartTime();
    
    document.addEventListener('mousemove', this.onGlobalMouseMove);
    document.addEventListener('mouseup', this.onGlobalMouseUp);
  }

  private onGlobalMouseMove = (event: MouseEvent) => {
    if (!this.isDragging || !this.timelineTrack) return;
    
    const trackWidth = this.timelineTrack.nativeElement.clientWidth;
    const deltaX = event.clientX - this.startDragX;
    const deltaTime = (deltaX / trackWidth) * this.videoDuration();
    
    let newStart = this.startStartTime + deltaTime;
    const maxStart = Math.max(0, this.videoDuration() - this.ttsDuration());
    newStart = Math.min(maxStart, Math.max(0, newStart));
    
    this.selectedStartTime.set(newStart);
    
    // Scrub video preview frame
    const video = this.previewVideo.nativeElement;
    video.currentTime = newStart;
    
    if (this.previewAudio) {
      this.previewAudio.currentTime = 0;
    }
  };

  private onGlobalMouseUp = () => {
    this.isDragging = false;
    document.removeEventListener('mousemove', this.onGlobalMouseMove);
    document.removeEventListener('mouseup', this.onGlobalMouseUp);
  };

  protected onTimelineClick(event: MouseEvent) {
    if (!this.timelineTrack || !this.previewVideo) return;
    
    const target = event.target as HTMLElement;
    if (target.classList.contains('timeline-window')) {
      return;
    }
    
    const trackRect = this.timelineTrack.nativeElement.getBoundingClientRect();
    const clickX = event.clientX - trackRect.left;
    const clickRatio = clickX / trackRect.width;
    const clickTime = clickRatio * this.videoDuration();
    
    let newStart = clickTime - (this.ttsDuration() / 2);
    const maxStart = Math.max(0, this.videoDuration() - this.ttsDuration());
    newStart = Math.min(maxStart, Math.max(0, newStart));
    
    this.selectedStartTime.set(newStart);
    this.previewVideo.nativeElement.currentTime = newStart;
    
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

    try {
      const video = this.previewVideo.nativeElement;
      const audioBlob = this.ttsAudioBlob();
      
      if (!audioBlob) {
        throw new Error('Narration audio is missing');
      }

      // Execute in-browser recording pipeline
      const finalVideoBlob = await this.canvasRecorder.exportReel(
        video,
        audioBlob,
        this.shortsTitle(),
        this.subtitles(),
        this.selectedStartTime(),
        this.ttsDuration(),
        this.gameVolume(),
        (progress) => {
          this.exportProgress.set(Math.round(progress));
        }
      );

      const videoUrl = URL.createObjectURL(finalVideoBlob);
      this.generatedVideoUrl.set(videoUrl);
      this.step.set('completed');

      // Auto trigger browser download
      const extension = finalVideoBlob.type.includes('mp4') ? 'mp4' : 'webm';
      const a = document.createElement('a');
      a.href = videoUrl;
      a.download = `viral_short_${Date.now()}.${extension}`;
      a.click();

    } catch (err: any) {
      console.error(err);
      this.exportError.set(err.message || 'Export rendering failed. Try refreshing the video file.');
      this.step.set('studio');
    } finally {
      this.isExporting.set(false);
    }
  }

  // Reset wizard to upload
  protected resetCreator() {
    this.cleanupObjectURLs();
    this.videoFile.set(null);
    this.uploadedVideoUrl.set(null);
    this.videoDuration.set(0);
    this.ttsAudioBlob.set(null);
    this.ttsAudioUrl.set(null);
    this.ttsDuration.set(0);
    this.generatedVideoUrl.set(null);
    this.previewAudio = null;
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
