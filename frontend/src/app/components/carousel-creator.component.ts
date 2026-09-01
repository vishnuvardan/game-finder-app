import { Component, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GameService, IGDBGame, CarouselSlide } from '../services/game.service';
import { AutocompleteInput } from './autocomplete-input';
import { toPng, toJpeg } from 'html-to-image';
import html2canvas from 'html2canvas';

type PageState = 'intake' | 'generating' | 'preview';
type AspectRatio = '4-5' | '9-16' | '1-1';
type SlideTheme = 'cyberpunk' | 'glass' | 'retro' | 'magazine' | 'ign' | 'kotaku' | 'polygon' | 'gamespot' | 'steam' | 'esports';

@Component({
  selector: 'app-carousel-creator',
  standalone: true,
  imports: [CommonModule, FormsModule, AutocompleteInput],
  templateUrl: './carousel-creator.component.html',
  styleUrl: './carousel-creator.component.css',
})
export class CarouselCreatorComponent {
  // Navigation & Page State
  protected readonly state = signal<PageState>('intake');
  protected readonly generationMode = signal<'topic' | 'steam'>('topic');
  protected readonly errorMessage = signal<string | null>(null);

  // Form inputs
  protected readonly selectedGame = signal<IGDBGame | null>(null);
  protected readonly customTopic = signal<string>('');
  protected readonly steamGamesInput = signal<string>('');
  protected readonly dealsCategory = signal<string>('main');
  protected readonly dealsCategoriesList = [
    { value: 'main', label: 'Main Specials / Deals' },
    { value: 'under_500', label: 'Deals under ₹500' },
    { value: 'under_250', label: 'Deals under ₹250' },
    { value: 'under_1000', label: 'Deals under ₹1,000' },
    { value: 'top_sellers', label: 'Top Selling Deals' }
  ];
  protected readonly watermark = signal<string>('@vsnuplays');
  protected readonly aspectRatio = signal<AspectRatio>('4-5');
  protected readonly theme = signal<SlideTheme>('cyberpunk');

  // List of themes for the theme cycling switcher
  protected readonly themesList: { value: SlideTheme; label: string }[] = [
    { value: 'cyberpunk', label: 'Neon Cyberpunk' },
    { value: 'glass', label: 'Glassmorphic' },
    { value: 'retro', label: 'Retro Arcade' },
    { value: 'magazine', label: 'Magazine Print' },
    { value: 'ign', label: 'IGN Editorial' },
    { value: 'kotaku', label: 'Kotaku Grunge' },
    { value: 'polygon', label: 'Polygon Creative' },
    { value: 'gamespot', label: 'GameSpot Steel' },
    { value: 'steam', label: 'Steam Storefront' },
    { value: 'esports', label: 'Esports Arena' },
  ];

  // Generated slides state
  protected readonly slides = signal<CarouselSlide[]>([]);
  protected readonly activeSlideIndex = signal<number>(0);
  protected readonly isDownloading = signal<boolean>(false);
  protected readonly caption = signal<string>('');
  protected readonly isCopied = signal<boolean>(false);
  protected readonly isPublishModalOpen = signal<boolean>(false);
  protected readonly publishPassword = signal<string>('');
  protected readonly publishStep = signal<'idle' | 'rendering' | 'publishing' | 'success' | 'error'>('idle');
  protected readonly publishProgressText = signal<string>('');
  protected readonly publishSuccess = signal<string | null>(null);
  protected readonly generatedCoverUrl = signal<string | null>(null);
  protected readonly imagePool = signal<string[]>([]);
  protected readonly useCoverImage = signal<boolean>(true);
  protected readonly customCoverUrl = signal<string>('');
  protected readonly customFirstSlideTitle = signal<string>('');
  protected readonly customFirstSlideSubtitle = signal<string>('');

  protected readonly getCoverUrl = computed(() => {
    if (!this.useCoverImage()) {
      return null;
    }
    return this.customCoverUrl() || this.slides()[0]?.mediaUrl || this.generatedCoverUrl() || this.selectedGame()?.coverUrl || null;
  });

  protected readonly hasCoverImage = computed(() => {
    return this.getCoverUrl() !== null;
  });

  protected copyCaption() {
    const text = this.caption();
    if (!text) return;

    // Sanitize text to avoid carriage return and formatting paste bugs in Instagram Web
    const sanitizedText = text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .trim();

    navigator.clipboard.writeText(sanitizedText).then(() => {
      this.isCopied.set(true);
      setTimeout(() => this.isCopied.set(false), 2000);
    });
  }

  // Shuffle images across all slides from the pooled high-res Steam & IGDB assets
  protected shuffleAllImages() {
    const pool = this.imagePool();
    if (!pool || pool.length === 0) return;

    const shuffled = [...pool].sort(() => 0.5 - Math.random());
    const updatedSlides = this.slides().map((slide, idx) => ({
      ...slide,
      mediaUrl: shuffled[idx % shuffled.length] || pool[idx % pool.length]
    }));
    this.slides.set(updatedSlides);
    if (updatedSlides[0]?.mediaUrl) {
      this.generatedCoverUrl.set(updatedSlides[0].mediaUrl);
    }
  }

  // Cycle through the 30-50 high-res images specifically for the active slide
  protected cycleActiveSlideImage() {
    const pool = this.imagePool();
    if (!pool || pool.length <= 1) return;

    const activeIdx = this.activeSlideIndex();
    const currentSlides = [...this.slides()];
    const currentUrl = currentSlides[activeIdx]?.mediaUrl;

    const poolIdx = pool.indexOf(currentUrl || '');
    const nextPoolIdx = (poolIdx + 1) % pool.length;
    const nextUrl = pool[nextPoolIdx];

    currentSlides[activeIdx] = {
      ...currentSlides[activeIdx],
      mediaUrl: nextUrl
    };
    this.slides.set(currentSlides);

    if (activeIdx === 0) {
      this.generatedCoverUrl.set(nextUrl);
    }
  }

  // Computed state validations
  protected readonly isGenerateEnabled = computed(() => {
    if (this.generationMode() === 'steam') {
      return true; // Steam deals can be blank to generate top deals
    }
    return this.customTopic().trim().length > 0;
  });

  // Quick Chips
  protected readonly topicChips = [
    { label: '📰 Recent News', text: 'Recent news, updates, and community buzz' },
    { label: '🤫 Rumors & Leaks', text: 'Recent rumors, leaks, and potential future updates' },
    { label: '📈 Sales & Stats', text: 'Sales milestones, downloads, active player counts, and ratings' },
    { label: '📅 Release & Price', text: 'Release dates, platforms, prices, and value proposition' },
    { label: '💡 Fun Facts & Lore', text: 'Interesting trivia, easter eggs, and game lore' },
  ];

  constructor(private gameService: GameService) {}

  protected onGameSelected(game: IGDBGame | null) {
    this.selectedGame.set(game);
  }

  protected selectTopicChip(text: string) {
    this.customTopic.set(text);
  }

  protected selectTheme(selectedTheme: SlideTheme) {
    this.theme.set(selectedTheme);
  }

  protected getThemeLabel(): string {
    const currentTheme = this.theme();
    const found = this.themesList.find(t => t.value === currentTheme);
    return found ? found.label : currentTheme;
  }

  protected nextTheme() {
    const currentTheme = this.theme();
    const currentIndex = this.themesList.findIndex(t => t.value === currentTheme);
    const nextIndex = (currentIndex + 1) % this.themesList.length;
    this.theme.set(this.themesList[nextIndex].value);
  }

  protected prevTheme() {
    const currentTheme = this.theme();
    const currentIndex = this.themesList.findIndex(t => t.value === currentTheme);
    const prevIndex = (currentIndex - 1 + this.themesList.length) % this.themesList.length;
    this.theme.set(this.themesList[prevIndex].value);
  }

  protected readonly aspectRatiosList: { value: AspectRatio; label: string }[] = [
    { value: '4-5', label: 'Instagram Portrait (4:5)' },
    { value: '9-16', label: 'Story / Reels (9:16)' },
    { value: '1-1', label: 'Classic Square (1:1)' },
  ];

  protected selectAspectRatio(ratio: AspectRatio) {
    this.aspectRatio.set(ratio);
  }

  protected getAspectRatioLabel(): string {
    const currentRatio = this.aspectRatio();
    const found = this.aspectRatiosList.find(r => r.value === currentRatio);
    return found ? found.label : currentRatio;
  }

  protected nextAspectRatio() {
    const currentRatio = this.aspectRatio();
    const currentIndex = this.aspectRatiosList.findIndex(r => r.value === currentRatio);
    const nextIndex = (currentIndex + 1) % this.aspectRatiosList.length;
    this.aspectRatio.set(this.aspectRatiosList[nextIndex].value);
  }

  protected prevAspectRatio() {
    const currentRatio = this.aspectRatio();
    const currentIndex = this.aspectRatiosList.findIndex(r => r.value === currentRatio);
    const prevIndex = (currentIndex - 1 + this.aspectRatiosList.length) % this.aspectRatiosList.length;
    this.aspectRatio.set(this.aspectRatiosList[prevIndex].value);
  }

  protected generateCarousel() {
    if (!this.isGenerateEnabled()) return;

    this.state.set('generating');
    this.errorMessage.set(null);
    this.slides.set([]);
    this.activeSlideIndex.set(0);
    this.generatedCoverUrl.set(null);

    if (this.generationMode() === 'steam') {
      const gamesStr = this.steamGamesInput().trim();
      const gameNames = gamesStr
        ? gamesStr.split(',').map(name => name.trim()).filter(name => name.length > 0)
        : undefined;

      // Force Steam Visual theme for Steam deals
      this.theme.set('steam');

      this.gameService.generateSteamDealsSlides(gameNames, this.dealsCategory()).subscribe({
        next: (res) => {
          if (!res.slides || res.slides.length === 0) {
            this.errorMessage.set('AI returned empty deals content. Please try again.');
            this.state.set('intake');
            return;
          }
          this.slides.set(res.slides);
          this.caption.set(res.caption || '');
          this.generatedCoverUrl.set(res.coverImageUrl || null);
          this.imagePool.set(res.imagePool || []);
          this.state.set('preview');
        },
        error: (err) => {
          console.error('Error generating Steam deals slides:', err);
          this.errorMessage.set(err.error?.error || 'Failed to generate Steam deals. Make sure the backend is running.');
          this.state.set('intake');
        }
      });
    } else {
      const game = this.selectedGame();
      const topic = this.customTopic();

      const name = game ? game.name : undefined;
      const summary = game ? game.summary : undefined;
      const genres = game ? game.genres : undefined;

      this.gameService.generateSlides(name, summary, genres, topic).subscribe({
        next: (res) => {
          if (!res.slides || res.slides.length === 0) {
            this.errorMessage.set('AI returned empty slides content. Please try again.');
            this.state.set('intake');
            return;
          }
          this.slides.set(res.slides);
          this.caption.set(res.caption || '');
          this.generatedCoverUrl.set(res.coverImageUrl || null);
          this.imagePool.set(res.imagePool || []);
          this.state.set('preview');
        },
        error: (err) => {
          console.error('Error generating slides:', err);
          this.errorMessage.set('Failed to generate slides. Make sure the backend is running.');
          this.state.set('intake');
        },
      });
    }
  }

  // Slide Navigation
  protected nextSlide() {
    if (this.slides().length === 0) return;
    this.activeSlideIndex.set((this.activeSlideIndex() + 1) % this.slides().length);
  }

  protected prevSlide() {
    if (this.slides().length === 0) return;
    this.activeSlideIndex.set(
      (this.activeSlideIndex() - 1 + this.slides().length) % this.slides().length
    );
  }

  protected goToSlide(index: number) {
    this.activeSlideIndex.set(index);
  }

  private async getBase64Image(url: string): Promise<string> {
    if (!url || url.startsWith('data:')) return url;
    try {
      const proxyUrl = `http://localhost:3000/api/proxy-image?url=${encodeURIComponent(url)}`;
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

  // Image exports using native GPU SVG foreignObject engine (html-to-image)
  private async triggerDownload(elementId: string, filename: string): Promise<boolean> {
    const cardElement = document.getElementById(elementId);
    if (!cardElement) {
      console.error(`Element not found for download: ${elementId}`);
      return false;
    }

    try {
      // Use html-to-image for pristine vector font anti-aliasing and native image rendering
      const imgData = await toPng(cardElement, {
        quality: 1.0,
        pixelRatio: 3.375, // 1080px native crisp output
        cacheBust: false,
      });

      const link = document.createElement('a');
      link.download = filename;
      link.href = imgData;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return true;
    } catch (err) {
      console.warn('html-to-image error, trying canvas fallback:', err);
      try {
        const canvas = await html2canvas(cardElement, {
          useCORS: true,
          allowTaint: true,
          logging: false,
          backgroundColor: '#070913',
          scale: 3.375,
          imageTimeout: 20000,
        });
        const imgData = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.download = filename;
        link.href = imgData;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        return true;
      } catch (fallbackErr) {
        console.error('All rendering options failed:', fallbackErr);
        return false;
      }
    }
  }

  protected async downloadActiveSlide() {
    this.errorMessage.set(null);
    const gameName = this.selectedGame()?.name || 'game';
    const index = this.activeSlideIndex();
    const safeName = gameName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const filename = `${safeName}-slide-${index + 1}.png`;

    // Convert active slide image to base64 first to guarantee 100% raw high-res fidelity
    const currentSlides = [...this.slides()];
    if (currentSlides[index]?.mediaUrl && !currentSlides[index].mediaUrl.startsWith('data:')) {
      const b64 = await this.getBase64Image(currentSlides[index].mediaUrl);
      currentSlides[index] = { ...currentSlides[index], mediaUrl: b64 };
      this.slides.set(currentSlides);
      await new Promise((r) => setTimeout(r, 150));
    }

    const success = await this.triggerDownload(`offscreen-slide-${index}`, filename);
    if (!success) {
      this.errorMessage.set('Failed to download active slide. Please ensure all assets are loaded.');
    }
  }

  protected async downloadAllSlides() {
    this.errorMessage.set(null);
    this.isDownloading.set(true);

    const gameName = this.selectedGame()?.name || 'game';
    const safeName = gameName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const totalSlides = this.slides().length;

    // Pre-convert all slide images to Base64 data URLs in parallel
    const currentSlides = [...this.slides()];
    const convertedSlides = await Promise.all(
      currentSlides.map(async (slide) => {
        if (slide.mediaUrl && !slide.mediaUrl.startsWith('data:')) {
          const b64 = await this.getBase64Image(slide.mediaUrl);
          return { ...slide, mediaUrl: b64 };
        }
        return slide;
      })
    );
    this.slides.set(convertedSlides);
    if (convertedSlides[0]?.mediaUrl) {
      this.generatedCoverUrl.set(convertedSlides[0].mediaUrl);
    }
    await new Promise((r) => setTimeout(r, 200));

    let successCount = 0;

    for (let i = 0; i < totalSlides; i++) {
      const elementId = `offscreen-slide-${i}`;
      const filename = `${safeName}-carousel-slide-${i + 1}.png`;
      
      await new Promise((resolve) => setTimeout(resolve, 300));
      const success = await this.triggerDownload(elementId, filename);
      if (success) successCount++;
    }

    this.isDownloading.set(false);

    if (successCount < totalSlides) {
      this.errorMessage.set(`Only downloaded ${successCount}/${totalSlides} slides successfully. Please try again.`);
    }
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

    this.errorMessage.set(null);
    this.publishStep.set('rendering');
    this.publishProgressText.set('Pre-loading full-resolution image assets into memory...');

    try {
      const totalSlides = this.slides().length;

      // Pre-convert all slide images to Base64 data URLs in parallel so html2canvas renders with 100% crystal-clear fidelity
      const currentSlides = [...this.slides()];
      const convertedSlides = await Promise.all(
        currentSlides.map(async (slide) => {
          if (slide.mediaUrl && !slide.mediaUrl.startsWith('data:')) {
            const b64 = await this.getBase64Image(slide.mediaUrl);
            return { ...slide, mediaUrl: b64 };
          }
          return slide;
        })
      );
      this.slides.set(convertedSlides);
      if (convertedSlides[0]?.mediaUrl) {
        this.generatedCoverUrl.set(convertedSlides[0].mediaUrl);
      }
      // Give browser 250ms to repaint DOM with high-res base64 textures
      await new Promise((r) => setTimeout(r, 250));

      const slideImages: string[] = [];

      for (let i = 0; i < totalSlides; i++) {
        this.publishProgressText.set(`Rendering slide ${i + 1} of ${totalSlides} in studio quality...`);
        const cardElement = document.getElementById(`offscreen-slide-${i}`);
        if (!cardElement) {
          throw new Error(`Slide element "offscreen-slide-${i}" was not found. Please wait.`);
        }
        
        await new Promise((resolve) => setTimeout(resolve, 150));
        
        let imgData: string;
        try {
          imgData = await toJpeg(cardElement, {
            quality: 0.98,
            pixelRatio: 3.375,
            backgroundColor: '#070913',
          });
        } catch (e) {
          console.warn('html-to-image jpeg failed, using canvas fallback:', e);
          const canvas = await html2canvas(cardElement, {
            useCORS: true,
            allowTaint: true,
            logging: false,
            backgroundColor: '#070913',
            scale: 3.375,
            imageTimeout: 20000,
          });
          imgData = canvas.toDataURL('image/jpeg', 0.98);
        }
        
        slideImages.push(imgData);
      }

      this.publishStep.set('publishing');
      this.publishProgressText.set('Uploading slides to storage & waiting for Instagram to process carousel... (takes ~15-25 seconds)');

      this.gameService.publishInstagramCarousel(slideImages, this.caption(), pwd).subscribe({
        next: (res) => {
          this.publishStep.set('success');
          this.publishProgressText.set('');
          this.publishSuccess.set(`Published successfully! Post ID: ${res.postId}`);
        },
        error: (err) => {
          this.publishStep.set('error');
          const errMsg = err.error?.error || 'Failed to publish to Instagram. Verify your password or credentials.';
          this.errorMessage.set(errMsg);
          this.publishProgressText.set('');
        }
      });

    } catch (err: any) {
      console.error(err);
      this.publishStep.set('error');
      this.errorMessage.set(err.message || 'An error occurred while compiling slides for Instagram.');
      this.publishProgressText.set('');
    }
  }

  protected startOver() {
    this.selectedGame.set(null);
    this.customTopic.set('');
    this.steamGamesInput.set('');
    this.slides.set([]);
    this.activeSlideIndex.set(0);
    this.caption.set('');
    this.generatedCoverUrl.set(null);
    this.customCoverUrl.set('');
    this.customFirstSlideTitle.set('');
    this.customFirstSlideSubtitle.set('');
    this.errorMessage.set(null);
    this.publishSuccess.set(null);
    this.isPublishModalOpen.set(false);
    this.state.set('intake');
  }
}
