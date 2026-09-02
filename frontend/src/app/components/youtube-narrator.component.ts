import { Component, signal, computed, ViewChild, ElementRef, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { 
  GameService, 
  IGDBGame, 
  YoutubeScriptResponse, 
  YoutubeScriptSection,
  GenerateYoutubeScriptParams,
  RegenerateSectionParams,
  VideoScene,
  SubtitleSegment
} from '../services/game.service';
import { YoutubeVideoRecorderService } from '../services/youtube-video-recorder.service';
import { AutocompleteInput } from './autocomplete-input';
import { toPng } from 'html-to-image';

type PageState = 'intake' | 'generating' | 'editor';

interface VoiceOption {
  id: string;
  name: string;
  lang: 'en' | 'ta';
  gender: string;
}

@Component({
  selector: 'app-youtube-narrator',
  standalone: true,
  imports: [CommonModule, FormsModule, AutocompleteInput],
  templateUrl: './youtube-narrator.component.html',
  styleUrl: './youtube-narrator.component.css',
})
export class YoutubeNarratorComponent implements OnInit, OnDestroy {
  // Navigation & Page State
  protected readonly state = signal<PageState>('intake');
  protected readonly isGenerating = signal<boolean>(false);
  protected readonly isSectionGenerating = signal<string | null>(null);
  protected readonly isAudioSynthesizing = signal<boolean>(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly activeSectionRewriteId = signal<string | null>(null);
  protected readonly sectionRewriteHint = signal<string>('');

  // Intake Form Inputs
  protected readonly topic = signal<string>('');
  protected readonly selectedGame = signal<IGDBGame | null>(null);
  protected readonly domain = signal<string>('Gaming & Esports');
  protected readonly tone = signal<string>('Engaging & Storytelling');
  protected readonly language = signal<'en' | 'ta'>('en');
  protected readonly targetMinutes = signal<number>(8);

  // Domains List
  protected readonly domainsList = [
    { value: 'Gaming & Esports', label: '🎮 Gaming & Esports' },
    { value: 'Science & Technology', label: '🔬 Science & Technology' },
    { value: 'Space & Astronomy', label: '🚀 Space & Astronomy' },
    { value: 'History & Mythology', label: '🏛️ History & Mythology' },
    { value: 'Cinema, TV & Pop Culture', label: '🎬 Cinema & Pop Culture' },
    { value: 'Astrology & Zodiac', label: '🔮 Astrology & Zodiac' },
    { value: 'True Crime & Mystery', label: '🔍 True Crime & Mystery' },
    { value: 'Philosophy & Psychology', label: '🧠 Philosophy & Psychology' },
    { value: 'Anime & Manga', label: '⛩️ Anime & Manga' },
    { value: 'General Documentary', label: '🌐 General Documentary' }
  ];

  // Tones List
  protected readonly tonesList = [
    { value: 'Engaging & Storytelling', label: '🎙️ Engaging & Storytelling' },
    { value: 'Controversial & Debatable', label: '⚡ Controversial & Debatable' },
    { value: 'Educational & Informative', label: '🎓 Educational & Informative' },
    { value: 'Funny & Humorous', label: '😂 Funny & Humorous' },
    { value: 'Mind-Blowing Facts & Secrets', label: '🤯 Mind-Blowing Facts' },
    { value: 'Dramatic & Epic', label: '⚔️ Dramatic & Epic' },
    { value: 'Casual & Conversational', label: '☕ Casual & Conversational' }
  ];

  // Duration Options
  protected readonly durationsList = [
    { value: 5, label: '⏱️ 5 Mins (~700 words)' },
    { value: 8, label: '⏱️ 8 Mins (~1,100 words)' },
    { value: 10, label: '⏱️ 10 Mins (~1,400 words)' }
  ];

  // Generic Preset Idea Prompts
  protected readonly presetIdeas = [
    'Why this is a masterpiece: 5 core reasons that prove it',
    'The most terrifying creature designs and their hidden lore',
    '5 mind-blowing plot twists that changed everything',
    'Why sequels often fail to beat the original experience',
    'The dark untold backstory and hidden secrets explained',
    'Top 7 beginner mistakes and how to avoid them'
  ];

  // Tamil Generic Preset Idea Prompts
  protected readonly tamilPresetIdeas = [
    'இது ஏன் ஒரு தலைசிறந்த படைப்பு? 5 முக்கியமான காரணங்கள்',
    'மறைக்கப்பட்ட ரகசியங்கள் மற்றும் அதிர்ச்சியூட்டும் உண்மைகள்',
    'மிகவும் மர்மமான நிகழ்வுகள் மற்றும் அதன் பின்னணி விளக்கம்',
    'ஆரம்பநிலை நபர்கள் செய்யும் 5 பொதுவான தவறுகள் மற்றும் தீர்வுகள்',
    'அடுத்த தலைமுறை தொழில்நுட்பம் மற்றும் எதிர்கால மாற்றங்கள்'
  ];

  // Generated Result Signals
  protected readonly youtubeTitle = signal<string>('');
  protected readonly youtubeDescription = signal<string>('');
  protected readonly thumbnailHeadline = signal<string>('');
  protected readonly thumbnailDescription = signal<string>('');
  protected readonly sections = signal<YoutubeScriptSection[]>([]);
  protected readonly callToAction = signal<string>('');
  protected readonly tags = signal<string[]>([]);
  protected readonly imagePool = signal<string[]>([]);
  protected readonly activeImageIndex = signal<number>(0);

  // New Section Append Form
  protected readonly newSectionTitle = signal<string>('');
  protected readonly newSectionHint = signal<string>('');
  protected readonly isAddingSection = signal<boolean>(false);

  // Audio Narration Signals
  protected readonly selectedVoice = signal<string>('en-US-ChristopherNeural');
  protected readonly selectedRate = signal<string>('+0%');
  protected readonly audioBase64 = signal<string | null>(null);
  protected readonly audioUrl = signal<string | null>(null);
  protected readonly audioBlob = signal<Blob | null>(null);
  protected readonly isPlaying = signal<boolean>(false);
  protected readonly subtitles = signal<SubtitleSegment[]>([]);

  // 1080p Video Studio Signals
  protected readonly videoScenes = signal<VideoScene[]>([]);
  protected readonly videoFps = signal<30 | 60>(60);
  protected readonly isExportingVideo = signal<boolean>(false);
  protected readonly exportProgress = signal<number>(0);
  protected readonly generatedVideoBlob = signal<Blob | null>(null);
  protected readonly generatedVideoUrl = signal<string | null>(null);
  protected readonly activeSceneIndex = signal<number>(0);

  // Video Canvas Preview States
  protected readonly isPreviewPlaying = signal<boolean>(false);
  protected readonly previewCurrentTime = signal<number>(0);
  protected readonly previewTotalDuration = signal<number>(0);

  // Scene Image Customizer Modal
  protected readonly isSceneImageModalOpen = signal<boolean>(false);
  protected readonly activeEditingSceneIndex = signal<number | null>(null);
  protected readonly sceneImageSearchQuery = signal<string>('');
  protected readonly sceneImageResults = signal<string[]>([]);
  protected readonly isSearchingSceneImages = signal<boolean>(false);

  // Copy Feedback Signals
  protected readonly isCopiedTitle = signal<boolean>(false);
  protected readonly isCopiedDesc = signal<boolean>(false);
  protected readonly isCopiedScript = signal<boolean>(false);
  protected readonly isCopiedTags = signal<boolean>(false);

  @ViewChild('audioPlayer') audioPlayerRef?: ElementRef<HTMLAudioElement>;
  @ViewChild('previewCanvas') previewCanvasRef?: ElementRef<HTMLCanvasElement>;

  private previewAudioEl: HTMLAudioElement | null = null;
  private animFrameId: number | null = null;
  private preloadedImageMap = new Map<string, HTMLImageElement>();

  // Voice Catalogue
  protected readonly voicesList: VoiceOption[] = [
    { id: 'en-US-ChristopherNeural', name: 'Christopher (Male - Authoritative / Documentary)', lang: 'en', gender: 'Male' },
    { id: 'en-US-GuyNeural', name: 'Guy (Male - Conversational)', lang: 'en', gender: 'Male' },
    { id: 'en-US-EricNeural', name: 'Eric (Male - Energetic / YouTube)', lang: 'en', gender: 'Male' },
    { id: 'en-US-JennyNeural', name: 'Jenny (Female - Natural / Warm)', lang: 'en', gender: 'Female' },
    { id: 'en-US-AriaNeural', name: 'Aria (Female - Dynamic Storyteller)', lang: 'en', gender: 'Female' },
    { id: 'en-GB-RyanNeural', name: 'Ryan (Male - British Accent)', lang: 'en', gender: 'Male' },
    { id: 'en-GB-SoniaNeural', name: 'Sonia (Female - British Accent)', lang: 'en', gender: 'Female' },
    
    // Tamil Voices (தமிழ்)
    { id: 'ta-IN-ValluvarNeural', name: 'வள்ளுவர் (ஆண் - Male India)', lang: 'ta', gender: 'Male' },
    { id: 'ta-IN-PallaviNeural', name: 'பல்லவி (பெண் - Female India)', lang: 'ta', gender: 'Female' },
    { id: 'ta-LK-KumarNeural', name: 'குமார் (ஆண் - Male Sri Lanka)', lang: 'ta', gender: 'Male' },
    { id: 'ta-LK-SaranyaNeural', name: 'சரண்யா (பெண் - Female Sri Lanka)', lang: 'ta', gender: 'Female' },
    { id: 'ta-MY-SuryaNeural', name: 'சூர்யா (ஆண் - Male Malaysia)', lang: 'ta', gender: 'Male' },
    { id: 'ta-SG-VenbaNeural', name: 'வெண்பா (பெண் - Female Singapore)', lang: 'ta', gender: 'Female' },
  ];

  // Filtered Voices based on active language
  protected readonly availableVoices = computed(() => {
    const lang = this.language();
    return this.voicesList.filter(v => v.lang === lang);
  });

  // Current Thumbnail Image
  protected readonly currentThumbnailImage = computed(() => {
    const pool = this.imagePool();
    if (pool.length === 0) return 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=1280&h=720&fit=crop';
    const index = this.activeImageIndex() % pool.length;
    return pool[index];
  });

  // Computed Full Master Script
  protected readonly fullScriptText = computed(() => {
    const parts: string[] = [];
    const secList = this.sections();
    
    for (const sec of secList) {
      parts.push(`[${sec.title.toUpperCase()}]\n${sec.content}\n`);
    }
    
    if (this.callToAction()) {
      parts.push(`[OUTRO & CALL TO ACTION]\n${this.callToAction()}`);
    }
    
    return parts.join('\n');
  });

  // Computed Full Complete YouTube Package
  protected readonly fullPackageText = computed(() => {
    const title = this.youtubeTitle()?.trim() || '';
    const desc = this.youtubeDescription()?.trim() || '';
    
    const rawTags = this.tags() || [];
    const hashtagsFormatted = rawTags
      .map(tag => tag.trim().startsWith('#') ? tag.trim() : `#${tag.trim()}`)
      .filter(Boolean)
      .join(' ');

    const script = this.fullScriptText()?.trim() || '';
    const parts: string[] = [];

    if (title) parts.push(`Title:\n${title}`);
    if (desc) parts.push(`Description:\n${desc}`);
    if (hashtagsFormatted) parts.push(`Hashtags:\n${hashtagsFormatted}`);
    if (script) parts.push(`Scripts:\n${script}`);

    return parts.join('\n\n');
  });

  // Total Script Word Count & Duration
  protected readonly totalWordCount = computed(() => {
    const text = this.fullScriptText();
    if (!text) return 0;
    return text.trim().split(/\s+/).length;
  });

  protected readonly estimatedTotalMinutes = computed(() => {
    const words = this.totalWordCount();
    return (words / 135).toFixed(1);
  });

  constructor(
    private gameService: GameService,
    private videoRecorder: YoutubeVideoRecorderService
  ) {}

  ngOnInit() {}

  ngOnDestroy() {
    this.stopPreviewLoop();
    if (this.previewAudioEl) {
      this.previewAudioEl.pause();
      this.previewAudioEl = null;
    }
    const genUrl = this.generatedVideoUrl();
    if (genUrl) URL.revokeObjectURL(genUrl);
    const aUrl = this.audioUrl();
    if (aUrl) URL.revokeObjectURL(aUrl);
  }

  protected setLanguage(lang: 'en' | 'ta') {
    this.language.set(lang);
    if (lang === 'ta') {
      this.selectedVoice.set('ta-IN-ValluvarNeural');
    } else {
      this.selectedVoice.set('en-US-ChristopherNeural');
    }
  }

  protected applyPreset(preset: string) {
    this.topic.set(preset);
  }

  protected onGameSelected(game: IGDBGame | null) {
    this.selectedGame.set(game);
  }

  /**
   * Generates the long-form YouTube script from Gemini
   */
  protected generateScript() {
    const topicText = this.topic().trim();
    if (!topicText) {
      this.errorMessage.set('Please enter a video idea or topic to generate the script.');
      return;
    }

    this.errorMessage.set(null);
    this.isGenerating.set(true);
    this.state.set('generating');

    const params: GenerateYoutubeScriptParams = {
      topic: topicText,
      gameTitle: this.selectedGame()?.name || undefined,
      domain: this.domain(),
      tone: this.tone(),
      language: this.language(),
      targetMinutes: Number(this.targetMinutes()) || 8
    };

    this.gameService.generateYoutubeScript(params).subscribe({
      next: (res: YoutubeScriptResponse) => {
        this.youtubeTitle.set(res.youtubeTitle);
        this.youtubeDescription.set(res.youtubeDescription);
        this.thumbnailHeadline.set(res.thumbnailHeadline || res.youtubeTitle);
        
        if (this.language() === 'ta') {
          this.thumbnailDescription.set('முழுமையான விளக்கம் & ரகசியங்கள்');
        } else {
          this.thumbnailDescription.set('The Complete Breakdown & Truth');
        }

        this.sections.set(res.sections || []);
        this.callToAction.set(res.callToAction || '');
        this.tags.set(res.tags || []);
        this.imagePool.set(res.imagePool || []);
        this.activeImageIndex.set(0);
        this.audioBase64.set(null);
        this.audioUrl.set(null);
        this.videoScenes.set([]);
        this.generatedVideoBlob.set(null);
        this.generatedVideoUrl.set(null);

        this.isGenerating.set(false);
        this.state.set('editor');
      },
      error: (err: any) => {
        console.error('YouTube script generation failed:', err);
        this.errorMessage.set(err.error?.error || 'Failed to generate YouTube script. Please try again.');
        this.isGenerating.set(false);
        this.state.set('intake');
      }
    });
  }

  private async getBase64Image(url: string): Promise<string> {
    if (!url || url.startsWith('data:')) return url;
    try {
      const proxyUrl = this.gameService.getProxiedImageUrl(url);
      const resp = await fetch(proxyUrl);
      if (!resp.ok) throw new Error(`Proxy status: ${resp.status}`);
      const blob = await resp.blob();
      return new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
    } catch (err) {
      console.warn(`[Base64 Image Preloader] Could not convert image "${url}", using raw URL:`, err);
      return url;
    }
  }

  /**
   * Reshuffle thumbnail background photo
   */
  protected reshuffleThumbnailImage() {
    const pool = this.imagePool();
    if (pool.length <= 1) return;
    this.activeImageIndex.set((this.activeImageIndex() + 1) % pool.length);
  }

  /**
   * Download 16:9 YouTube Thumbnail in 1280x720 PNG
   */
  protected async downloadThumbnail() {
    const element = document.getElementById('youtube-thumbnail-canvas');
    if (!element) return;

    try {
      const currentUrl = this.currentThumbnailImage();
      const backdropEl = element.querySelector('.thumbnail-backdrop-img') as HTMLElement | null;
      let originalBg = '';
      if (backdropEl && currentUrl) {
        originalBg = backdropEl.style.backgroundImage;
        const b64 = await this.getBase64Image(currentUrl);
        backdropEl.style.backgroundImage = `url(${b64})`;
      }

      const dataUrl = await toPng(element, {
        quality: 1.0,
        pixelRatio: 2.0,
        cacheBust: false,
      });

      if (backdropEl && originalBg) {
        backdropEl.style.backgroundImage = originalBg;
      }

      const safeTitle = (this.youtubeTitle() || 'thumbnail').replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const link = document.createElement('a');
      link.download = `${safeTitle}-thumbnail.png`;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error('Failed to export thumbnail:', err);
      this.errorMessage.set('Could not export thumbnail. Please try again.');
    }
  }

  /**
   * Single Section AI Regeneration / Rewrite
   */
  protected openSectionRewrite(sectionId: string) {
    this.activeSectionRewriteId.set(sectionId);
    this.sectionRewriteHint.set('');
  }

  protected cancelSectionRewrite() {
    this.activeSectionRewriteId.set(null);
    this.sectionRewriteHint.set('');
  }

  protected executeSectionRegenerate(sectionId: string) {
    const currentList = this.sections();
    const sectionIndex = currentList.findIndex(s => s.id === sectionId);
    if (sectionIndex === -1) return;

    const targetSection = currentList[sectionIndex];
    this.isSectionGenerating.set(sectionId);

    const params: RegenerateSectionParams = {
      topic: this.topic(),
      sectionTitle: targetSection.title,
      currentContent: targetSection.content,
      hint: this.sectionRewriteHint().trim() || undefined,
      tone: this.tone(),
      language: this.language()
    };

    this.gameService.regenerateScriptSection(params).subscribe({
      next: (res) => {
        const updated = [...this.sections()];
        updated[sectionIndex] = {
          ...updated[sectionIndex],
          title: res.title || updated[sectionIndex].title,
          content: res.content,
          estimatedSeconds: res.estimatedSeconds || updated[sectionIndex].estimatedSeconds,
          visualCue: res.visualCue || updated[sectionIndex].visualCue,
          bulletPoints: res.bulletPoints || updated[sectionIndex].bulletPoints,
          imageQuery: res.imageQuery || updated[sectionIndex].imageQuery
        };
        this.sections.set(updated);
        this.isSectionGenerating.set(null);
        this.activeSectionRewriteId.set(null);
        this.sectionRewriteHint.set('');

        // Rebuild scenes if audio already synthesized
        if (this.previewTotalDuration() > 0) {
          this.buildVideoScenes(this.previewTotalDuration());
        }
      },
      error: (err) => {
        console.error('Section regeneration failed:', err);
        this.errorMessage.set('Failed to rewrite section. Please try again.');
        this.isSectionGenerating.set(null);
      }
    });
  }

  /**
   * Add a new section to the script
   */
  protected appendSectionFromPrompt() {
    const title = this.newSectionTitle().trim();
    const hint = this.newSectionHint().trim();
    if (!title) {
      this.errorMessage.set('Please provide a title or topic for the new section.');
      return;
    }

    this.isAddingSection.set(true);
    this.errorMessage.set(null);

    const params: RegenerateSectionParams = {
      topic: this.topic(),
      sectionTitle: title,
      hint: hint || undefined,
      tone: this.tone(),
      language: this.language()
    };

    this.gameService.regenerateScriptSection(params).subscribe({
      next: (res) => {
        const pool = this.imagePool();
        const newSec: YoutubeScriptSection = {
          id: `sec_${Date.now()}`,
          title: res.title || title,
          content: res.content,
          estimatedSeconds: res.estimatedSeconds || 60,
          visualCue: res.visualCue || 'B-roll footage illustrating the point.',
          bulletPoints: res.bulletPoints || ['Key discussion breakdown', 'Important facts & analysis'],
          imageQuery: res.imageQuery || `${this.topic()} ${title}`,
          imageUrl: pool[pool.length - 1] || this.currentThumbnailImage(),
          imagePool: pool
        };
        this.sections.set([...this.sections(), newSec]);
        this.newSectionTitle.set('');
        this.newSectionHint.set('');
        this.isAddingSection.set(false);
      },
      error: (err) => {
        console.error('Adding section failed:', err);
        this.errorMessage.set('Failed to generate new section. Please try again.');
        this.isAddingSection.set(false);
      }
    });
  }

  protected deleteSection(index: number) {
    const updated = [...this.sections()];
    updated.splice(index, 1);
    this.sections.set(updated);
  }

  protected moveSectionUp(index: number) {
    if (index <= 0) return;
    const updated = [...this.sections()];
    const temp = updated[index];
    updated[index] = updated[index - 1];
    updated[index - 1] = temp;
    this.sections.set(updated);
  }

  protected moveSectionDown(index: number) {
    const updated = [...this.sections()];
    if (index >= updated.length - 1) return;
    const temp = updated[index];
    updated[index] = updated[index + 1];
    updated[index + 1] = temp;
    this.sections.set(updated);
  }

  /**
   * Synthesizes full script narration using EdgeTTS and generates synchronized 1080p video scenes
   */
  protected generateVoiceoverAudio() {
    const text = this.fullScriptText();
    if (!text || text.trim() === '') {
      this.errorMessage.set('Script content is empty.');
      return;
    }

    this.audioBase64.set(null);
    this.audioUrl.set(null);
    this.audioBlob.set(null);
    this.isAudioSynthesizing.set(true);
    this.errorMessage.set(null);

    this.gameService.synthesizeNarratorAudio(text, this.selectedVoice(), this.selectedRate()).subscribe({
      next: async (res) => {
        this.audioBase64.set(res.audio);
        this.subtitles.set(res.subtitles || []);

        const byteCharacters = atob(res.audio);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'audio/mp3' });
        this.audioBlob.set(blob);

        const url = URL.createObjectURL(blob);
        this.audioUrl.set(url);
        this.previewAudioEl = new Audio(url);

        // Calculate accurate total duration using Web Audio API
        try {
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
          const ctx = new AudioContextClass();
          const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
          this.previewTotalDuration.set(buffer.duration);
          await ctx.close();
        } catch (e) {
          const words = text.trim().split(/\s+/).length;
          this.previewTotalDuration.set(words / 2.2);
        }

        // Build 1080p Video Scenes based on narration timeline
        this.buildVideoScenes(this.previewTotalDuration());

        this.isAudioSynthesizing.set(false);
      },
      error: (err) => {
        console.error('Audio synthesis failed:', err);
        this.errorMessage.set(err.error?.error || 'Failed to synthesize audio. Please try again.');
        this.isAudioSynthesizing.set(false);
      }
    });
  }

  /**
   * Automatically partitions the script into 8-10 second timed visual scenes
   */
  protected buildVideoScenes(totalDuration: number) {
    const secs = this.sections();
    if (secs.length === 0 || totalDuration <= 0) return;

    const pool = this.imagePool();
    const scenes: VideoScene[] = [];
    const totalWords = this.totalWordCount() || 1;
    let currentStart = 0;

    for (let i = 0; i < secs.length; i++) {
      const sec = secs[i];
      const secWords = sec.content.trim().split(/\s+/).length;
      const secDuration = (secWords / totalWords) * totalDuration;

      // Split long chapters into 8-10s sub-scenes so visuals change regularly
      const sceneCount = Math.max(1, Math.round(secDuration / 9));
      const sceneChunkDuration = secDuration / sceneCount;

      for (let c = 0; c < sceneCount; c++) {
        const sceneStart = currentStart + (c * sceneChunkDuration);
        const sceneEnd = Math.min(totalDuration, sceneStart + sceneChunkDuration);
        const poolIdx = (i + c) % (pool.length || 1);
        const sceneImg = sec.imageUrl || (pool.length > 0 ? pool[poolIdx] : this.currentThumbnailImage());

        scenes.push({
          id: `scene_${i}_${c}`,
          sectionId: sec.id,
          chapterTitle: sec.title,
          startTime: sceneStart,
          endTime: sceneEnd,
          duration: sceneEnd - sceneStart,
          bulletPoints: sec.bulletPoints && sec.bulletPoints.length > 0 ? sec.bulletPoints : [
            'Detailed storyline breakdown',
            'Key gameplay & lore analysis',
            'Core community takeaways'
          ],
          imageQuery: sec.imageQuery || `${this.topic()} ${sec.title}`,
          imageUrl: sceneImg,
          imagePool: pool,
          visualCue: sec.visualCue
        });
      }

      currentStart += secDuration;
    }

    if (scenes.length > 0) {
      scenes[scenes.length - 1].endTime = totalDuration;
      scenes[scenes.length - 1].duration = totalDuration - scenes[scenes.length - 1].startTime;
    }

    this.videoScenes.set(scenes);
    this.preloadAndRenderInitialFrame();
  }

  /**
   * Preloads scene images and renders the first frame on the preview canvas
   */
  private async preloadAndRenderInitialFrame() {
    const scenes = this.videoScenes();
    if (scenes.length === 0) return;

    this.preloadedImageMap = await this.videoRecorder.preloadSceneImages(
      scenes,
      (url) => this.gameService.getProxiedImageUrl(url)
    );

    setTimeout(() => {
      this.drawPreviewFrame(0);
    }, 100);
  }

  /**
   * Renders a specific frame on the 1080p preview canvas
   */
  private drawPreviewFrame(time: number) {
    if (!this.previewCanvasRef) return;
    const canvas = this.previewCanvasRef.nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    this.videoRecorder.renderFrame(
      ctx,
      time,
      this.previewTotalDuration(),
      this.videoScenes(),
      this.subtitles(),
      this.youtubeTitle() || this.topic(),
      this.preloadedImageMap
    );
  }

  /**
   * Toggle interactive video preview playback in lockstep with narration audio
   */
  protected toggleVideoPreviewPlay() {
    if (!this.previewAudioEl) {
      const url = this.audioUrl();
      if (url) this.previewAudioEl = new Audio(url);
    }
    if (!this.previewAudioEl) return;

    if (this.isPreviewPlaying()) {
      this.previewAudioEl.pause();
      this.isPreviewPlaying.set(false);
      this.stopPreviewLoop();
    } else {
      if (this.previewAudioEl.currentTime >= this.previewTotalDuration() - 0.2) {
        this.previewAudioEl.currentTime = 0;
      }

      this.previewAudioEl.play().then(() => {
        this.isPreviewPlaying.set(true);
        this.startPreviewLoop();
      }).catch(err => console.error('Audio play failed:', err));
    }
  }

  private startPreviewLoop() {
    this.stopPreviewLoop();

    const loop = () => {
      if (!this.isPreviewPlaying() || !this.previewAudioEl) return;
      const t = this.previewAudioEl.currentTime;
      this.previewCurrentTime.set(t);

      this.drawPreviewFrame(t);

      if (t >= this.previewTotalDuration()) {
        this.isPreviewPlaying.set(false);
        this.previewAudioEl.pause();
        return;
      }

      this.animFrameId = requestAnimationFrame(loop);
    };

    this.animFrameId = requestAnimationFrame(loop);
  }

  private stopPreviewLoop() {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  /**
   * Seek video timeline to specific timestamp
   */
  protected seekTimeline(event: Event) {
    const input = event.target as HTMLInputElement;
    const targetTime = Number(input.value);
    this.previewCurrentTime.set(targetTime);

    if (this.previewAudioEl) {
      this.previewAudioEl.currentTime = targetTime;
    }
    this.drawPreviewFrame(targetTime);
  }

  /**
   * Jump to specific scene in preview
   */
  protected jumpToScene(index: number) {
    const scenes = this.videoScenes();
    if (!scenes[index]) return;
    const targetTime = scenes[index].startTime;
    this.previewCurrentTime.set(targetTime);

    if (this.previewAudioEl) {
      this.previewAudioEl.currentTime = targetTime;
    }
    this.drawPreviewFrame(targetTime);
  }

  /**
   * Open Image Customizer Modal for a Scene
   */
  protected openSceneImagePicker(index: number) {
    const scenes = this.videoScenes();
    if (!scenes[index]) return;

    this.activeEditingSceneIndex.set(index);
    this.sceneImageSearchQuery.set(scenes[index].imageQuery || this.topic());
    
    // Immediately populate with all available preloaded images from the pool
    const pool = this.imagePool();
    if (pool.length > 0) {
      this.sceneImageResults.set([...pool]);
    } else {
      this.sceneImageResults.set([]);
      this.searchSceneImages();
    }
    this.isSceneImageModalOpen.set(true);
  }

  protected closeSceneImagePicker() {
    this.isSceneImageModalOpen.set(false);
    this.activeEditingSceneIndex.set(null);
  }

  /**
   * Search Google Images via Serper for the scene
   */
  protected searchSceneImages() {
    const q = this.sceneImageSearchQuery().trim();
    if (!q) return;

    this.isSearchingSceneImages.set(true);
    this.gameService.fetchSceneImages(q, 12).subscribe({
      next: (res) => {
        this.sceneImageResults.set(res.images || []);
        this.isSearchingSceneImages.set(false);
      },
      error: (err) => {
        console.error('Failed to search scene images:', err);
        this.isSearchingSceneImages.set(false);
      }
    });
  }

  /**
   * Assign chosen Serper image to the active scene
   */
  protected selectSceneImage(imageUrl: string) {
    const idx = this.activeEditingSceneIndex();
    if (idx === null) return;

    const updated = [...this.videoScenes()];
    updated[idx] = {
      ...updated[idx],
      imageUrl
    };
    this.videoScenes.set(updated);
    this.closeSceneImagePicker();

    // Preload newly assigned image and redraw current frame
    this.preloadAndRenderInitialFrame();
  }

  /**
   * Reshuffle scene image with available image pool
   */
  protected reshuffleSceneImage(index: number) {
    const scenes = [...this.videoScenes()];
    if (!scenes[index]) return;

    const pool = this.imagePool();
    if (pool.length <= 1) return;

    const currentImg = scenes[index].imageUrl;
    const currentPoolIdx = pool.indexOf(currentImg);
    const nextIdx = (currentPoolIdx + 1) % pool.length;
    scenes[index] = {
      ...scenes[index],
      imageUrl: pool[nextIdx]
    };

    this.videoScenes.set(scenes);
    this.preloadAndRenderInitialFrame();
  }

  /**
   * Export 1080p Landscape YouTube Video (.mp4 / .webm)
   */
  protected async exportYoutubeVideo() {
    const blob = this.audioBlob();
    if (!blob) {
      this.errorMessage.set('Please synthesize voiceover audio first.');
      return;
    }

    const scenes = this.videoScenes();
    if (scenes.length === 0) {
      this.errorMessage.set('Video scenes are not generated yet.');
      return;
    }

    if (this.isPreviewPlaying() && this.previewAudioEl) {
      this.previewAudioEl.pause();
      this.isPreviewPlaying.set(false);
      this.stopPreviewLoop();
    }

    this.isExportingVideo.set(true);
    this.exportProgress.set(0);
    this.errorMessage.set(null);

    try {
      // Ensure all scene images are preloaded
      const preloadedImages = await this.videoRecorder.preloadSceneImages(
        scenes,
        (url) => this.gameService.getProxiedImageUrl(url)
      );

      const title = this.youtubeTitle() || this.topic() || 'youtube_documentary';
      const finalVideoBlob = await this.videoRecorder.exportVideo(
        blob,
        scenes,
        this.subtitles(),
        title,
        preloadedImages,
        this.videoFps(),
        (progress) => {
          this.exportProgress.set(Math.round(progress));
        }
      );

      this.generatedVideoBlob.set(finalVideoBlob);
      const videoUrl = URL.createObjectURL(finalVideoBlob);
      this.generatedVideoUrl.set(videoUrl);

      // Auto download
      const extension = finalVideoBlob.type.includes('mp4') ? 'mp4' : 'webm';
      const safeTitle = title.replace(/[^a-z0-9]/gi, '_').toLowerCase().slice(0, 60);
      const link = document.createElement('a');
      link.download = `${safeTitle}-1080p.${extension}`;
      link.href = videoUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      this.isExportingVideo.set(false);
    } catch (err: any) {
      console.error('Video export error:', err);
      this.errorMessage.set(err.message || 'Failed to export 1080p video. Please try again.');
      this.isExportingVideo.set(false);
    }
  }

  /**
   * Download synthesized MP3 file
   */
  protected downloadAudioFile() {
    const base64 = this.audioBase64();
    if (!base64) return;

    const safeTitle = (this.youtubeTitle() || 'voiceover').replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const link = document.createElement('a');
    link.download = `${safeTitle}-narration.mp3`;
    link.href = `data:audio/mp3;base64,${base64}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // Copy Helpers
  protected copyTitle() {
    navigator.clipboard.writeText(this.youtubeTitle());
    this.isCopiedTitle.set(true);
    setTimeout(() => this.isCopiedTitle.set(false), 2000);
  }

  protected copyDescription() {
    navigator.clipboard.writeText(this.youtubeDescription());
    this.isCopiedDesc.set(true);
    setTimeout(() => this.isCopiedDesc.set(false), 2000);
  }

  protected copyAllTags() {
    navigator.clipboard.writeText(this.tags().join(', '));
    this.isCopiedTags.set(true);
    setTimeout(() => this.isCopiedTags.set(false), 2000);
  }

  protected copyMasterScript() {
    navigator.clipboard.writeText(this.fullPackageText());
    this.isCopiedScript.set(true);
    setTimeout(() => this.isCopiedScript.set(false), 2000);
  }

  protected startOver() {
    this.stopPreviewLoop();
    if (this.previewAudioEl) {
      this.previewAudioEl.pause();
      this.previewAudioEl = null;
    }
    this.topic.set('');
    this.selectedGame.set(null);
    this.youtubeTitle.set('');
    this.youtubeDescription.set('');
    this.thumbnailHeadline.set('');
    this.thumbnailDescription.set('');
    this.sections.set([]);
    this.callToAction.set('');
    this.tags.set([]);
    this.imagePool.set([]);
    this.audioBase64.set(null);
    this.audioUrl.set(null);
    this.audioBlob.set(null);
    this.subtitles.set([]);
    this.videoScenes.set([]);
    this.generatedVideoBlob.set(null);
    this.generatedVideoUrl.set(null);
    this.state.set('intake');
  }
}

