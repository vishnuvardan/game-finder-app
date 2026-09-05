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
  SubtitleSegment,
  ChapterTimestamp
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
  protected readonly selectedRate = signal<string>('-10%');
  protected readonly selectedPitch = signal<string>('-15Hz');
  protected readonly audioBase64 = signal<string | null>(null);
  protected readonly audioUrl = signal<string | null>(null);
  protected readonly audioBlob = signal<Blob | null>(null);
  protected readonly isPlaying = signal<boolean>(false);
  protected readonly subtitles = signal<SubtitleSegment[]>([]);

  // 1080p Video Studio Signals
  protected readonly videoScenes = signal<VideoScene[]>([]);
  protected readonly synthesizedChapters = signal<ChapterTimestamp[]>([]);
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

  // Scene Asset Customizer Modal (Dual tab: Google Images or Local Video)
  protected readonly isSceneImageModalOpen = signal<boolean>(false);
  protected readonly activeEditingSceneIndex = signal<number | null>(null);
  protected readonly activeAssetTab = signal<'images' | 'video'>('images');
  protected readonly uploadedVideoFile = signal<File | null>(null);
  protected readonly uploadedVideoUrl = signal<string | null>(null);
  protected readonly uploadedVideoFileName = signal<string>('');
  protected readonly uploadedVideoDuration = signal<number>(0);
  protected readonly videoStartOffset = signal<number>(0);
  protected readonly videoMaxStartOffset = signal<number>(0);
  protected readonly videoVolume = signal<number>(0.3);
  protected readonly isVideoLoading = signal<boolean>(false);

  protected readonly Math = Math;

  protected readonly sceneImageSearchQuery = signal<string>('');
  protected readonly sceneImageResults = signal<string[]>([]);
  protected readonly isSearchingSceneImages = signal<boolean>(false);
  protected readonly brokenImages = new Set<string>();
  protected readonly hasEmptyScenes = computed(() => {
    return this.videoScenes().some(s => (!s.imageUrl || s.imageUrl.trim() === '' || this.brokenImages.has(s.imageUrl)) && s.mediaType !== 'video');
  });

  // Scene Image Range Selection
  protected readonly rangeStartScene = signal<number>(1);
  protected readonly rangeEndScene = signal<number>(1);
  protected readonly rangeFeedbackMessage = signal<string | null>(null);

  protected getRangeSceneCount(): number {
    const total = this.videoScenes().length;
    if (total === 0) return 0;
    const s = Math.max(1, Math.min(this.rangeStartScene(), total));
    const e = Math.max(1, Math.min(this.rangeEndScene(), total));
    return Math.abs(e - s) + 1;
  }

  protected setRangePreset(start: number, end: number) {
    const total = this.videoScenes().length || 1;
    this.rangeStartScene.set(Math.max(1, Math.min(start, total)));
    this.rangeEndScene.set(Math.max(1, Math.min(end, total)));
    this.rangeFeedbackMessage.set(null);
  }

  protected clampSceneNumber(val: any): number {
    const total = this.videoScenes().length || 1;
    const num = Number(val);
    if (isNaN(num) || num < 1) return 1;
    if (num > total) return total;
    return Math.floor(num);
  }

  // Copy Feedback Signals
  protected readonly isCopiedTitle = signal<boolean>(false);
  protected readonly isCopiedDesc = signal<boolean>(false);
  protected readonly isCopiedScript = signal<boolean>(false);
  protected readonly isCopiedTags = signal<boolean>(false);

  @ViewChild('audioPlayer') audioPlayerRef?: ElementRef<HTMLAudioElement>;
  @ViewChild('previewCanvas') previewCanvasRef?: ElementRef<HTMLCanvasElement>;
  @ViewChild('trimmerPreview') trimmerPreviewRef?: ElementRef<HTMLVideoElement>;

  private previewAudioEl: HTMLAudioElement | null = null;
  private animFrameId: number | null = null;
  private preloadedImageMap = new Map<string, HTMLImageElement>();

  // Voice Catalogue: Max 2 voices per language (Deep Bass Male & Natural Female)
  protected readonly voicesList: VoiceOption[] = [
    // English
    { id: 'en-US-ChristopherNeural', name: 'Christopher (Deep Bass Male)', lang: 'en', gender: 'Male' },
    { id: 'en-US-JennyNeural', name: 'Jenny (Natural Female)', lang: 'en', gender: 'Female' },

    // Tamil (தமிழ்)
    { id: 'ta-IN-ValluvarNeural', name: 'வள்ளுவர் (Deep Bass Male)', lang: 'ta', gender: 'Male' },
    { id: 'ta-IN-PallaviNeural', name: 'பல்லவி (Clear Female)', lang: 'ta', gender: 'Female' },
  ];

  // Detect if current generated script is in Tamil
  protected readonly isTamilScript = computed(() => {
    if (this.language() === 'ta') return true;
    const title = this.youtubeTitle() || '';
    const script = this.fullScriptText() || '';
    return /[\u0B80-\u0BFF]/.test(title + script);
  });

  // Only show the 2 voices matching the active script's language
  protected readonly currentLanguageVoices = computed(() => {
    const isTamil = this.isTamilScript();
    return this.voicesList.filter(v => isTamil ? v.lang === 'ta' : v.lang === 'en');
  });

  protected onVoiceChange(voiceId: string) {
    this.selectedVoice.set(voiceId);
    if (voiceId === 'en-US-ChristopherNeural' || voiceId === 'ta-IN-ValluvarNeural') {
      this.selectedPitch.set('-15Hz');
      this.selectedRate.set('-10%');
    } else {
      this.selectedPitch.set('+0Hz');
      this.selectedRate.set('+0%');
    }
  }

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
  ) { }

  ngOnInit() { }

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

        const isTamil = this.language() === 'ta' || /[\u0B80-\u0BFF]/.test(res.youtubeTitle + (res.sections?.[0]?.content || ''));
        if (isTamil) {
          this.thumbnailDescription.set('முழுமையான விளக்கம் & ரகசியங்கள்');
          this.selectedVoice.set('ta-IN-ValluvarNeural');
        } else {
          this.thumbnailDescription.set('The Complete Breakdown & Truth');
          this.selectedVoice.set('en-US-ChristopherNeural');
        }
        this.selectedPitch.set('-15Hz');
        this.selectedRate.set('-10%');

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
    if (this.previewTotalDuration() > 0) {
      this.buildVideoScenes(this.previewTotalDuration());
    }
  }

  protected moveSectionUp(index: number) {
    if (index <= 0) return;
    const updated = [...this.sections()];
    const temp = updated[index];
    updated[index] = updated[index - 1];
    updated[index - 1] = temp;
    this.sections.set(updated);
    if (this.previewTotalDuration() > 0) {
      this.buildVideoScenes(this.previewTotalDuration());
    }
  }

  protected moveSectionDown(index: number) {
    const updated = [...this.sections()];
    if (index >= updated.length - 1) return;
    const temp = updated[index];
    updated[index] = updated[index + 1];
    updated[index + 1] = temp;
    this.sections.set(updated);
    if (this.previewTotalDuration() > 0) {
      this.buildVideoScenes(this.previewTotalDuration());
    }
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

    this.gameService.synthesizeNarratorAudio(
      text,
      this.selectedVoice(),
      this.selectedRate(),
      this.selectedPitch(),
      this.sections(),
      this.callToAction()
    ).subscribe({
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

        // Build 1080p Video Scenes based on exact physical chapters from audio synthesis
        if (res.chapters && res.chapters.length > 0) {
          this.synthesizedChapters.set(res.chapters);
          this.buildVideoScenesFromChapters(res.chapters, this.previewTotalDuration());
          // Sync YouTube Description timestamps to exact physical seconds of the audio
          this.youtubeDescription.set(this.syncDescriptionTimestamps(this.youtubeDescription(), res.chapters));
        } else {
          this.buildVideoScenes(this.previewTotalDuration());
        }

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
   * Partitions the video timeline chapter-wise (exactly 1 scene per chapter)
   */
  protected buildVideoScenes(totalDuration: number) {
    const secs = this.sections();
    if (secs.length === 0 || totalDuration <= 0) return;

    // If physical chapters have been synthesized and match current section count, always use them
    const cachedChapters = this.synthesizedChapters();
    if (cachedChapters.length === secs.length && cachedChapters.length > 0) {
      this.buildVideoScenesFromChapters(cachedChapters, totalDuration);
      return;
    }

    const pool = this.imagePool();
    const scenes: VideoScene[] = [];
    const totalEst = secs.reduce((acc, s) => acc + (s.estimatedSeconds || Math.max(15, Math.round(s.content.trim().split(/\s+/).length / 2.1))), 0) || 1;
    let currentStart = 0;

    for (let i = 0; i < secs.length; i++) {
      const sec = secs[i];
      const estSec = sec.estimatedSeconds || Math.max(15, Math.round(sec.content.trim().split(/\s+/).length / 2.1));
      const secDuration = (estSec / totalEst) * totalDuration;
      const sceneStart = currentStart;
      const sceneEnd = (i === secs.length - 1) ? totalDuration : Math.min(totalDuration, sceneStart + secDuration);
      const poolIdx = i % (pool.length || 1);
      const isVideo = sec.mediaType === 'video' && !!sec.videoUrl;
      const sceneImg = isVideo ? undefined : (sec.imageUrl || (pool.length > 0 ? pool[poolIdx] : this.currentThumbnailImage()));

      scenes.push({
        id: `scene_${i}`,
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
        imageQuery: sec.title,
        mediaType: isVideo ? 'video' : 'image',
        videoUrl: isVideo ? sec.videoUrl : undefined,
        videoFileName: isVideo ? sec.videoFileName : undefined,
        videoStartOffset: isVideo ? sec.videoStartOffset : undefined,
        videoDuration: isVideo ? sec.videoDuration : undefined,
        videoVolume: isVideo ? (sec.videoVolume ?? this.videoVolume()) : undefined,
        imageUrl: sceneImg,
        imagePool: pool,
        visualCue: sec.visualCue
      });

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
   * Builds 1080p Video Scenes directly from frame-accurate synthesized audio chapter boundaries
   */
  protected buildVideoScenesFromChapters(chapters: ChapterTimestamp[], totalDuration: number) {
    const secs = this.sections();
    const pool = this.imagePool();
    const scenes: VideoScene[] = [];

    for (let i = 0; i < chapters.length; i++) {
      const ch = chapters[i];
      const sec = secs[i] || {
        id: ch.id,
        title: ch.title,
        content: '',
        imageUrl: undefined,
        bulletPoints: [],
        imageQuery: undefined,
        visualCue: undefined
      };

      const poolIdx = i % (pool.length || 1);
      const isVideo = sec.mediaType === 'video' && !!sec.videoUrl;
      const sceneImg = isVideo ? undefined : (sec.imageUrl || (pool.length > 0 ? pool[poolIdx] : this.currentThumbnailImage()));

      scenes.push({
        id: `scene_${i}`,
        sectionId: ch.id,
        chapterTitle: ch.title,
        startTime: ch.startTime,
        endTime: ch.endTime,
        duration: ch.duration,
        bulletPoints: sec.bulletPoints && sec.bulletPoints.length > 0 ? sec.bulletPoints : [
          'Detailed storyline breakdown',
          'Key gameplay & lore analysis',
          'Core community takeaways'
        ],
        imageQuery: ch.title || sec.title,
        mediaType: isVideo ? 'video' : 'image',
        videoUrl: isVideo ? sec.videoUrl : undefined,
        videoFileName: isVideo ? sec.videoFileName : undefined,
        videoStartOffset: isVideo ? sec.videoStartOffset : undefined,
        videoDuration: isVideo ? sec.videoDuration : undefined,
        videoVolume: isVideo ? (sec.videoVolume ?? this.videoVolume()) : undefined,
        imageUrl: sceneImg,
        imagePool: pool,
        visualCue: sec.visualCue
      });
    }

    if (scenes.length > 0 && totalDuration > 0) {
      scenes[scenes.length - 1].endTime = totalDuration;
      scenes[scenes.length - 1].duration = totalDuration - scenes[scenes.length - 1].startTime;
    }

    this.videoScenes.set(scenes);
    this.preloadAndRenderInitialFrame();
  }

  /**
   * Formats seconds into MM:SS display without DecimalPipe rounding errors
   */
  protected formatTimestamp(seconds: number): string {
    const totalSecs = Math.max(0, Math.floor(seconds || 0));
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }

  /**
   * Synchronizes timestamps in the YouTube description with the exact physical audio timestamps
   */
  private syncDescriptionTimestamps(desc: string, chapters: ChapterTimestamp[]): string {
    if (!chapters || chapters.length === 0) return desc;

    const formattedLines = chapters.map(ch => {
      const timeStr = this.formatTimestamp(ch.startTime);
      return `${timeStr} - ${ch.title}`;
    });

    const isTamil = this.isTamilScript();
    const chapterHeader = isTamil ? '📌 இந்த வீடியோவில் உள்ளவை (Chapters):' : '📌 CHAPTERS:';
    const newChapterBlock = `${chapterHeader}\n${formattedLines.join('\n')}`;

    // Robust Regex to match any existing timestamp section in English, Tamil, or any format
    const existingRegex = /(?:(?:📌|📍|⏰|🎯|✨)?\s*(?:CHAPTERS?|TIMESTAMPS?|அத்தியாயங்கள்|இந்த வீடியோவில் உள்ளவை):?\s*\n+)?(?:\d{1,2}:\d{2}(?::\d{2})?\s*[-–—:\s]\s*[^\n]+\n*)+/i;

    if (existingRegex.test(desc)) {
      return desc.replace(existingRegex, `${newChapterBlock}\n\n`).trim();
    } else {
      return desc ? `${desc.trim()}\n\n${newChapterBlock}\n` : newChapterBlock;
    }
  }

  /**
   * Preloads scene images and video assets, then renders the first frame on the preview canvas
   */
  private async preloadAndRenderInitialFrame() {
    const scenes = this.videoScenes();
    if (scenes.length === 0) return;

    this.preloadedImageMap = await this.videoRecorder.preloadSceneMedia(
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
        this.previewCurrentTime.set(0);
      } else {
        // Ensure audio element syncs with the current preview scrubber position
        this.previewAudioEl.currentTime = this.previewCurrentTime();
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

      // Synchronize video element playback for the active video scene
      const scenes = this.videoScenes();
      const activeScene = scenes.find(s => t >= s.startTime && (s === scenes[scenes.length - 1] ? t <= s.endTime : t < s.endTime));

      if (activeScene?.mediaType === 'video' && activeScene.videoElement) {
        const vid = activeScene.videoElement;
        const vol = activeScene.videoVolume !== undefined ? activeScene.videoVolume : this.videoVolume();
        vid.volume = vol;
        vid.muted = (vol === 0);
        const vidDur = vid.duration || activeScene.videoDuration || 0;
        const elapsedInScene = Math.max(0, t - activeScene.startTime);
        let targetVideoTime = (activeScene.videoStartOffset || 0) + elapsedInScene;

        // When video is shorter than chapter duration, loop seamlessly
        if (vidDur > 0) {
          targetVideoTime = targetVideoTime % vidDur;
        }

        if (vid.paused && t >= activeScene.startTime && t < activeScene.endTime) {
          vid.play().catch(() => {});
        }
        if (Math.abs(vid.currentTime - targetVideoTime) > 0.15) {
          vid.currentTime = targetVideoTime;
        }
      }

      // Pre-warm the next scene if it is a video (within 1s of chapter boundary)
      const activeIdx = activeScene ? scenes.indexOf(activeScene) : -1;
      if (activeIdx >= 0 && activeIdx < scenes.length - 1) {
        const nextScene = scenes[activeIdx + 1];
        if (nextScene?.mediaType === 'video' && nextScene.videoElement) {
          const timeUntilNext = nextScene.startTime - t;
          if (timeUntilNext > 0 && timeUntilNext <= 1.0) {
            const nextVid = nextScene.videoElement;
            const startOffset = nextScene.videoStartOffset || 0;
            if (nextVid.paused && Math.abs(nextVid.currentTime - startOffset) > 0.1) {
              nextVid.currentTime = startOffset;
            }
          }
        }
      }

      // Pause non-active scene video elements
      for (const s of scenes) {
        if (s !== activeScene && s.videoElement && !s.videoElement.paused) {
          s.videoElement.pause();
        }
      }

      this.drawPreviewFrame(t);

      if (t >= this.previewTotalDuration()) {
        this.isPreviewPlaying.set(false);
        this.previewAudioEl.pause();
        this.stopPreviewLoop();
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
    for (const s of this.videoScenes()) {
      if (s.videoElement && !s.videoElement.paused) {
        s.videoElement.pause();
      }
    }
  }

  /**
   * Seek video timeline to specific timestamp
   */
  protected seekTimeline(event: Event) {
    const input = event.target as HTMLInputElement;
    const targetTime = Number(input.value);
    this.previewCurrentTime.set(targetTime);

    if (!this.previewAudioEl && this.audioUrl()) {
      this.previewAudioEl = new Audio(this.audioUrl()!);
    }
    if (this.previewAudioEl) {
      this.previewAudioEl.currentTime = targetTime;
    }

    // Seek active video element if any
    const scenes = this.videoScenes();
    const activeScene = scenes.find(s => targetTime >= s.startTime && (s === scenes[scenes.length - 1] ? targetTime <= s.endTime : targetTime < s.endTime));
    if (activeScene?.mediaType === 'video' && activeScene.videoElement) {
      const vid = activeScene.videoElement;
      const vol = activeScene.videoVolume !== undefined ? activeScene.videoVolume : 0.3;
      vid.volume = vol;
      vid.muted = (vol === 0);
      const vidDur = vid.duration || activeScene.videoDuration || 0;
      const elapsed = Math.max(0, targetTime - activeScene.startTime);
      let targetVidTime = (activeScene.videoStartOffset || 0) + elapsed;
      if (vidDur > 0) {
        targetVidTime = targetVidTime % vidDur;
      }
      vid.currentTime = targetVidTime;
    }

    this.drawPreviewFrame(targetTime);
  }

  /**
   * Jump to specific scene in preview
   */
  protected jumpToScene(index: number) {
    const scenes = this.videoScenes();
    if (!scenes[index]) return;
    const targetTime = scenes[index].startTime + 0.05;
    this.previewCurrentTime.set(targetTime);

    if (!this.previewAudioEl && this.audioUrl()) {
      this.previewAudioEl = new Audio(this.audioUrl()!);
    }
    if (this.previewAudioEl) {
      this.previewAudioEl.currentTime = targetTime;
    }

    // Seek target scene video element if video
    if (scenes[index].mediaType === 'video' && scenes[index].videoElement) {
      const vid = scenes[index].videoElement!;
      const vol = scenes[index].videoVolume !== undefined ? scenes[index].videoVolume : 0.3;
      vid.volume = vol;
      vid.muted = (vol === 0);
      const vidDur = vid.duration || scenes[index].videoDuration || 0;
      let offset = scenes[index].videoStartOffset || 0;
      if (vidDur > 0) {
        offset = offset % vidDur;
      }
      vid.currentTime = offset;
    }

    this.drawPreviewFrame(targetTime);
  }

  /**
   * Open Asset Customizer Modal for a Scene (Dual Tab: Images or Video)
   */
  protected openSceneImagePicker(index: number) {
    const scenes = this.videoScenes();
    if (!scenes[index]) return;

    this.activeEditingSceneIndex.set(index);
    const scene = scenes[index];
    this.sceneImageSearchQuery.set(scene.chapterTitle || this.topic());

    const totalScenes = scenes.length;
    const startNum = index + 1;
    this.rangeStartScene.set(startNum);
    this.rangeEndScene.set(Math.min(totalScenes, startNum + 9));
    this.rangeFeedbackMessage.set(null);

    // If this chapter already has a video, initialize video tab state
    if (scene.mediaType === 'video' && scene.videoUrl) {
      this.activeAssetTab.set('video');
      this.uploadedVideoUrl.set(scene.videoUrl);
      this.uploadedVideoFileName.set(scene.videoFileName || 'Local Video');
      this.videoStartOffset.set(scene.videoStartOffset || 0);
      this.uploadedVideoDuration.set(scene.videoDuration || 0);
      this.videoVolume.set(scene.videoVolume !== undefined ? scene.videoVolume : 0.3);
      const chapterDuration = scene.duration || 30;
      this.videoMaxStartOffset.set(Math.max(0, (scene.videoDuration || 0) - chapterDuration));
    } else {
      this.activeAssetTab.set('images');
      this.uploadedVideoUrl.set(null);
      this.uploadedVideoFileName.set('');
      this.videoStartOffset.set(0);
      this.uploadedVideoDuration.set(0);
      this.videoVolume.set(0.3);
      this.videoMaxStartOffset.set(0);
    }

    // Gather all currently loaded images across pool and scenes
    const rawList: (string | undefined)[] = [
      ...this.imagePool(),
      ...this.videoScenes().map(s => s.imageUrl),
      ...this.sections().map(s => s.imageUrl)
    ];
    const allLoadedImages: string[] = Array.from(new Set(
      rawList.filter((url): url is string => typeof url === 'string' && url.trim().length > 0 && !this.brokenImages.has(url))
    ));

    this.imagePool.set(allLoadedImages);
    this.sceneImageResults.set(allLoadedImages);
    this.isSceneImageModalOpen.set(true);
  }

  protected closeSceneImagePicker() {
    this.isSceneImageModalOpen.set(false);
    this.activeEditingSceneIndex.set(null);
    this.rangeFeedbackMessage.set(null);
  }

  protected setActiveAssetTab(tab: 'images' | 'video') {
    this.activeAssetTab.set(tab);
    this.rangeFeedbackMessage.set(null);
  }

  /**
   * Returns current active scene duration in whole seconds
   */
  protected getActiveSceneDuration(): number {
    const idx = this.activeEditingSceneIndex();
    if (idx === null) return 30;
    const scenes = this.videoScenes();
    return scenes[idx] ? Math.max(1, Math.round(scenes[idx].duration)) : 30;
  }

  protected isCurrentSceneVideo(): boolean {
    const idx = this.activeEditingSceneIndex();
    if (idx === null) return false;
    const scenes = this.videoScenes();
    return scenes[idx]?.mediaType === 'video';
  }

  /**
   * Handles local video selection from disk
   */
  protected onVideoFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    this.isVideoLoading.set(true);
    this.rangeFeedbackMessage.set(null);

    const url = URL.createObjectURL(file);
    this.uploadedVideoFile.set(file);
    this.uploadedVideoFileName.set(file.name);
    this.uploadedVideoUrl.set(url);
    this.videoStartOffset.set(0);

    const tempVid = document.createElement('video');
    tempVid.src = url;
    tempVid.preload = 'metadata';
    tempVid.onloadedmetadata = () => {
      this.uploadedVideoDuration.set(tempVid.duration);
      const scenes = this.videoScenes();
      const idx = this.activeEditingSceneIndex();
      const chapterDuration = (idx !== null && scenes[idx]) ? scenes[idx].duration : 30;
      const maxOffset = Math.max(0, tempVid.duration - chapterDuration);
      this.videoMaxStartOffset.set(maxOffset);
      this.isVideoLoading.set(false);
    };
    tempVid.onerror = () => {
      this.isVideoLoading.set(false);
    };
  }

  /**
   * Updates start offset for the chapter video window
   */
  protected onVideoOffsetSlider(event: Event) {
    const input = event.target as HTMLInputElement;
    const val = Math.max(0, Math.min(this.videoMaxStartOffset(), Number(input.value) || 0));
    this.videoStartOffset.set(Math.round(val * 10) / 10);
  }

  /**
   * Master Background Video Audio Volume Control (located directly below preview video window)
   * Controls volume for all background videos across preview playback and export.
   */
  protected onGlobalVideoVolumeSlider(event: Event) {
    const input = event.target as HTMLInputElement;
    const val = Math.max(0, Math.min(1, Number(input.value) || 0));
    const rounded = Math.round(val * 100) / 100;
    this.videoVolume.set(rounded);

    if (this.trimmerPreviewRef?.nativeElement) {
      this.trimmerPreviewRef.nativeElement.volume = rounded;
      this.trimmerPreviewRef.nativeElement.muted = (rounded === 0);
    }

    // Apply immediately to all scenes with video
    const updatedScenes = this.videoScenes().map(scene => {
      if (scene.mediaType === 'video') {
        if (scene.videoElement) {
          scene.videoElement.volume = rounded;
          scene.videoElement.muted = (rounded === 0);
        }
        return { ...scene, videoVolume: rounded };
      }
      return scene;
    });
    this.videoScenes.set(updatedScenes);

    // Sync to sections
    const updatedSecs = this.sections().map(sec => {
      if (sec.mediaType === 'video') {
        return { ...sec, videoVolume: rounded };
      }
      return sec;
    });
    this.sections.set(updatedSecs);
  }

  /**
   * Updates background audio volume for the selected video
   */
  protected onVideoVolumeSlider(event: Event) {
    this.onGlobalVideoVolumeSlider(event);
  }

  /**
   * Applies selected local video clip & timeline window to current scene
   */
  protected applyVideoToScene() {
    const idx = this.activeEditingSceneIndex();
    if (idx === null) return;
    const scenes = [...this.videoScenes()];
    const scene = scenes[idx];
    if (!scene) return;

    const url = this.uploadedVideoUrl();
    if (!url) return;

    const vol = this.videoVolume();
    const vid = document.createElement('video');
    vid.src = url;
    vid.volume = vol;
    vid.muted = (vol === 0);
    vid.playsInline = true;
    vid.loop = true;
    vid.preload = 'auto';
    vid.currentTime = this.videoStartOffset();

    scenes[idx] = {
      ...scene,
      mediaType: 'video',
      imageUrl: undefined,
      videoUrl: url,
      videoFileName: this.uploadedVideoFileName(),
      videoStartOffset: this.videoStartOffset(),
      videoDuration: this.uploadedVideoDuration(),
      videoVolume: vol,
      videoElement: vid
    };
    this.videoScenes.set(scenes);

    // Sync to sections array so re-ordering/rebuild retains video
    const secs = [...this.sections()];
    if (secs[idx]) {
      secs[idx] = {
        ...secs[idx],
        mediaType: 'video',
        imageUrl: undefined,
        videoUrl: url,
        videoFileName: this.uploadedVideoFileName(),
        videoStartOffset: this.videoStartOffset(),
        videoDuration: this.uploadedVideoDuration(),
        videoVolume: vol
      };
      this.sections.set(secs);
    }

    this.rangeFeedbackMessage.set(`✓ Applied video "${this.uploadedVideoFileName()}" to Chapter ${idx + 1}!`);
    setTimeout(() => {
      this.closeSceneImagePicker();
      this.preloadAndRenderInitialFrame();
    }, 400);
  }

  /**
   * Reverts current scene from local video back to artwork image
   */
  protected removeVideoFromScene() {
    const idx = this.activeEditingSceneIndex();
    if (idx === null) return;
    const scenes = [...this.videoScenes()];
    if (!scenes[idx]) return;

    if (scenes[idx].videoElement) {
      scenes[idx].videoElement!.pause();
    }

    const pool = this.imagePool();
    const fallbackImage = (pool.length > 0) ? pool[idx % pool.length] : this.currentThumbnailImage();

    scenes[idx] = {
      ...scenes[idx],
      mediaType: 'image',
      imageUrl: fallbackImage,
      videoUrl: undefined,
      videoFileName: undefined,
      videoStartOffset: undefined,
      videoDuration: undefined,
      videoVolume: undefined,
      videoElement: undefined
    };
    this.videoScenes.set(scenes);

    const secs = [...this.sections()];
    if (secs[idx]) {
      secs[idx] = {
        ...secs[idx],
        mediaType: 'image',
        imageUrl: fallbackImage,
        videoUrl: undefined,
        videoFileName: undefined,
        videoStartOffset: undefined,
        videoDuration: undefined,
        videoVolume: undefined
      };
      this.sections.set(secs);
    }

    this.uploadedVideoUrl.set(null);
    this.uploadedVideoFile.set(null);
    this.uploadedVideoFileName.set('');
    this.activeAssetTab.set('images');
    this.rangeFeedbackMessage.set(`✓ Reverted Chapter ${idx + 1} to Image.`);
    this.preloadAndRenderInitialFrame();
  }

  /**
   * Search Google Images via Serper for the scene and append results to the cumulative pool
   */
  protected searchSceneImages() {
    const q = this.sceneImageSearchQuery().trim();
    if (!q) return;

    this.isSearchingSceneImages.set(true);
    this.gameService.fetchSceneImages(q, 15).subscribe({
      next: (res) => {
        const returned = (res.images || []).filter((u: string) => Boolean(u) && !this.brokenImages.has(u));
        // Append newly searched images to cumulative pool at the top, avoiding duplicates
        const updatedPool = Array.from(new Set([...returned, ...this.imagePool()]));
        this.imagePool.set(updatedPool);
        this.sceneImageResults.set(updatedPool);
        this.isSearchingSceneImages.set(false);
      },
      error: (err) => {
        console.error('Failed to search scene images:', err);
        this.isSearchingSceneImages.set(false);
      }
    });
  }

  /**
   * Assign chosen image to active scene, a range of scenes, all empty scenes, or all scenes
   */
  protected selectSceneImage(imageUrl: string, mode: 'single' | 'range' | 'empty' | 'all' = 'single') {
    const idx = this.activeEditingSceneIndex();
    const currentScenes = [...this.videoScenes()];
    if (currentScenes.length === 0) return;
    const totalScenes = currentScenes.length;

    if (mode === 'all') {
      const updated = currentScenes.map(scene => ({
        ...scene,
        mediaType: 'image' as const,
        videoUrl: undefined,
        videoElement: undefined,
        imageUrl
      }));
      this.videoScenes.set(updated);
      const updatedSecs = this.sections().map(sec => ({
        ...sec,
        mediaType: 'image' as const,
        videoUrl: undefined,
        imageUrl
      }));
      this.sections.set(updatedSecs);
      this.rangeFeedbackMessage.set(`✓ Applied image to ALL ${totalScenes} chapter scenes!`);
    } else if (mode === 'empty') {
      let count = 0;
      const updated = currentScenes.map((scene, i) => {
        const isCurrent = (idx !== null && i === idx);
        const isEmpty = !scene.imageUrl || scene.imageUrl.trim() === '' || this.brokenImages.has(scene.imageUrl);
        if (isCurrent || isEmpty) {
          count++;
          return {
            ...scene,
            mediaType: 'image' as const,
            videoUrl: undefined,
            videoElement: undefined,
            imageUrl
          };
        }
        return scene;
      });
      this.videoScenes.set(updated);
      const updatedSecs = this.sections().map((sec, i) => {
        const isCurrent = (idx !== null && i === idx);
        const isEmpty = !sec.imageUrl || sec.imageUrl.trim() === '' || this.brokenImages.has(sec.imageUrl);
        return (isCurrent || isEmpty) ? {
          ...sec,
          mediaType: 'image' as const,
          videoUrl: undefined,
          imageUrl
        } : sec;
      });
      this.sections.set(updatedSecs);
      this.rangeFeedbackMessage.set(`✓ Applied image to ${count} empty chapter scenes!`);
    } else if (mode === 'range') {
      const start = Math.max(1, Math.min(this.rangeStartScene(), this.rangeEndScene()));
      const end = Math.min(totalScenes, Math.max(this.rangeStartScene(), this.rangeEndScene()));
      const span = end - start + 1;

      const updated = currentScenes.map((scene, i) => {
        const sceneNum = i + 1;
        if (sceneNum >= start && sceneNum <= end) {
          return {
            ...scene,
            mediaType: 'image' as const,
            videoUrl: undefined,
            videoElement: undefined,
            imageUrl
          };
        }
        return scene;
      });
      this.videoScenes.set(updated);
      const updatedSecs = this.sections().map((sec, i) => {
        const sceneNum = i + 1;
        return (sceneNum >= start && sceneNum <= end) ? {
          ...sec,
          mediaType: 'image' as const,
          videoUrl: undefined,
          imageUrl
        } : sec;
      });
      this.sections.set(updatedSecs);
      this.rangeFeedbackMessage.set(`✓ Applied image to Chapters ${start}–${end}!`);

      // Auto-advance range to next block (e.g. 1-5 -> 6-10)
      const nextStart = end + 1;
      if (nextStart <= totalScenes) {
        const nextEnd = Math.min(totalScenes, nextStart + span - 1);
        this.rangeStartScene.set(nextStart);
        this.rangeEndScene.set(nextEnd);
      }
    } else {
      if (idx !== null && currentScenes[idx]) {
        currentScenes[idx] = {
          ...currentScenes[idx],
          mediaType: 'image' as const,
          videoUrl: undefined,
          videoElement: undefined,
          imageUrl
        };
        this.videoScenes.set(currentScenes);
        const updatedSecs = [...this.sections()];
        if (updatedSecs[idx]) {
          updatedSecs[idx] = {
            ...updatedSecs[idx],
            mediaType: 'image' as const,
            videoUrl: undefined,
            imageUrl
          };
          this.sections.set(updatedSecs);
        }
        this.closeSceneImagePicker();
      }
    }

    // Retain this image in imagePool if not present
    if (!this.imagePool().includes(imageUrl)) {
      this.imagePool.set([imageUrl, ...this.imagePool()]);
    }

    // Preload newly assigned image and redraw current frame
    this.preloadAndRenderInitialFrame();
  }

  /**
   * Handle broken image error in UI cards
   */
  protected handleImageError(imageUrl: string) {
    this.brokenImages.add(imageUrl);
    this.sceneImageResults.set(this.sceneImageResults().filter(u => u !== imageUrl));
    this.imagePool.set(this.imagePool().filter(u => u !== imageUrl));
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
    const currentPoolIdx = currentImg ? pool.indexOf(currentImg) : -1;
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
      // Ensure all scene images and video assets are preloaded
      const preloadedImages = await this.videoRecorder.preloadSceneMedia(
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
    this.synthesizedChapters.set([]);
    this.generatedVideoBlob.set(null);
    this.generatedVideoUrl.set(null);
    this.state.set('intake');
  }
}

