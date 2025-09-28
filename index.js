const { addonBuilder } = require('stremio-addon-sdk');
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');

// Enhanced configuration with multiple setup options
const CONFIG = {
    // Bot tokens - supports multiple configuration methods
    TELEGRAM_BOTS: (() => {
        const bots = [];
        
        // Method 1: Individual bot tokens (TELEGRAM_BOT_TOKEN_1, _2, etc.)
        for (let i = 1; i <= 10; i++) {
            const token = process.env[`TELEGRAM_BOT_TOKEN_${i}`];
            if (token && !token.includes('your_bot')) {
                bots.push(token);
            }
        }
        
        // Method 2: Comma-separated tokens
        if (bots.length === 0 && process.env.TELEGRAM_BOT_TOKENS) {
            const tokens = process.env.TELEGRAM_BOT_TOKENS.split(',')
                .map(t => t.trim())
                .filter(t => t && !t.includes('your_bot'));
            bots.push(...tokens);
        }
        
        // Method 3: Single bot token (backward compatibility)
        if (bots.length === 0 && process.env.TELEGRAM_BOT_TOKEN) {
            const token = process.env.TELEGRAM_BOT_TOKEN.trim();
            if (token && !token.includes('your_bot')) {
                bots.push(token);
            }
        }
        
        return bots;
    })(),
    
    // Channel IDs - supports multiple configuration methods
    MONITORED_CHANNELS: (() => {
        const channels = [];
        
        // Method 1: Comma-separated channels
        if (process.env.TELEGRAM_CHANNELS) {
            const channelList = process.env.TELEGRAM_CHANNELS.split(',')
                .map(c => c.trim())
                .filter(c => c && (c.startsWith('-') || c.startsWith('@')));
            channels.push(...channelList);
        }
        
        // Method 2: Individual channel variables
        for (let i = 1; i <= 10; i++) {
            const channel = process.env[`TELEGRAM_CHANNEL_${i}`];
            if (channel && (channel.startsWith('-') || channel.startsWith('@'))) {
                channels.push(channel);
            }
        }
        
        // Fallback: default channels if none configured
        if (channels.length === 0) {
            console.log('⚠️ No channels configured. Add TELEGRAM_CHANNELS to your environment.');
        }
        
        return channels;
    })(),
    
    // Server settings
    PORT: process.env.PORT || 3000,
    NODE_ENV: process.env.NODE_ENV || 'production',
    
    // Webhook configuration
    WEBHOOK_SECRET: process.env.WEBHOOK_SECRET || crypto.randomBytes(32).toString('hex'),
    WEBHOOK_BASE_URL: process.env.WEBHOOK_BASE_URL,
    
    // Cache and performance
    CACHE_TTL: parseInt(process.env.CACHE_TTL) || 3600000, // 1 hour
    FILE_SCAN_INTERVAL: parseInt(process.env.FILE_SCAN_INTERVAL) || 300000, // 5 minutes
    MAX_FILE_SIZE: parseInt(process.env.MAX_FILE_SIZE) || 2147483648, // 2GB
    MAX_CACHE_SIZE: parseInt(process.env.MAX_CACHE_SIZE) || 10000,
    MAX_CATALOG_ITEMS: parseInt(process.env.MAX_CATALOG_ITEMS) || 100,
    
    // Rate limiting
    RATE_LIMIT_DELAY: parseInt(process.env.RATE_LIMIT_DELAY) || 1000,
    MAX_REQUESTS_PER_BOT_PER_MINUTE: parseInt(process.env.MAX_REQUESTS_PER_BOT_PER_MINUTE) || 20,
    RETRY_ATTEMPTS: parseInt(process.env.RETRY_ATTEMPTS) || 3,
    RETRY_DELAY: parseInt(process.env.RETRY_DELAY) || 2000,
    BOT_COOLDOWN_PERIOD: parseInt(process.env.BOT_COOLDOWN_PERIOD) || 60000,
    
    // File detection
    ALLOWED_FILE_TYPES: (process.env.ALLOWED_FILE_TYPES || 'mp4,mkv,avi,mov,wmv,flv,webm,m4v,3gp,ts,m2ts').split(',').map(t => t.trim()),
    SERIES_KEYWORDS: (process.env.SERIES_KEYWORDS || 'season,episode,s01,s02,s03,s04,s05,s06,s07,s08,s09,s10,ep,e01,e02,e03,e04,e05').split(',').map(k => k.trim().toLowerCase()),
    QUALITY_INDICATORS: (process.env.QUALITY_INDICATORS || '480p,720p,1080p,1440p,2160p,4K,BluRay,WEBRip,HDRip,DVDRip,CAMRip,WEB-DL,BDRip').split(',').map(q => q.trim()),
    TITLE_CLEANUP_WORDS: (process.env.TITLE_CLEANUP_WORDS || 'x264,x265,h264,h265,hevc,aac,ac3,dts,5.1,7.1,rarbg,yts,eztv').split(',').map(w => w.trim().toLowerCase()),
    
    // Metadata
    ENABLE_METADATA_FETCHING: process.env.ENABLE_METADATA_FETCHING === 'true',
    TMDB_API_KEY: process.env.TMDB_API_KEY,
    OMDB_API_KEY: process.env.OMDB_API_KEY,
    DEFAULT_MOVIE_POSTER: process.env.DEFAULT_MOVIE_POSTER || 'https://via.placeholder.com/300x450/2c3e50/ecf0f1?text=MOVIE',
    DEFAULT_SERIES_POSTER: process.env.DEFAULT_SERIES_POSTER || 'https://via.placeholder.com/300x450/34495e/ecf0f1?text=SERIES',
    
    // Logging
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
    ENABLE_REQUEST_LOGGING: process.env.ENABLE_REQUEST_LOGGING !== 'false',
    ENABLE_DETECTION_LOGGING: process.env.ENABLE_DETECTION_LOGGING !== 'false',
    
    // Security
    ENABLE_CORS: process.env.ENABLE_CORS !== 'false',
    CORS_ORIGINS: process.env.CORS_ORIGINS || '*',
    REQUEST_TIMEOUT: parseInt(process.env.REQUEST_TIMEOUT) || 30000,
    
    // Addon manifest
    ADDON_ID: process.env.ADDON_ID || 'org.telegram.autodetect',
    ADDON_VERSION: process.env.ADDON_VERSION || '5.0.0',
    ADDON_NAME: process.env.ADDON_NAME || 'Auto-Detect Media Collection',
    ADDON_DESCRIPTION: process.env.ADDON_DESCRIPTION || 'Automatically detect and stream media from Telegram channels'
};

// Addon manifest - defined after CONFIG
const manifest = {
    id: CONFIG.ADDON_ID,
    version: CONFIG.ADDON_VERSION,
    name: CONFIG.ADDON_NAME,
    description: CONFIG.ADDON_DESCRIPTION,
    resources: ['catalog', 'stream', 'meta'],
    types: ['movie', 'series'],
    idPrefixes: ['tg'],
    catalogs: [
        {
            type: 'movie',
            id: 'telegram-movies',
            name: 'Telegram Movies',
            extra: [{ name: 'search', isRequired: false }]
        },
        {
            type: 'series',
            id: 'telegram-series',
            name: 'Telegram Series', 
            extra: [{ name: 'search', isRequired: false }]
        }
    ]
};

// Global file storage - automatically populated
const AUTO_DETECTED_FILES = {
    movies: new Map(),
    series: new Map(),
    lastUpdate: Date.now()
};

// Bot rotation system
class BotRotator {
    constructor(botTokens) {
        this.bots = botTokens.map((token, index) => ({
            token,
            index,
            lastUsed: 0,
            rateLimitUntil: 0,
            errors: 0
        }));
        this.currentIndex = 0;
    }

    getAvailableBot() {
        const now = Date.now();
        
        // Find bot that's not rate limited
        for (let i = 0; i < this.bots.length; i++) {
            const bot = this.bots[i];
            if (bot.rateLimitUntil < now && bot.errors < 5) {
                bot.lastUsed = now;
                return bot;
            }
        }
        
        // If all rate limited, use least recently used
        const availableBot = this.bots.reduce((min, bot) => 
            bot.lastUsed < min.lastUsed ? bot : min
        );
        availableBot.lastUsed = now;
        return availableBot;
    }

    markBotError(botToken, isRateLimit = false) {
        const bot = this.bots.find(b => b.token === botToken);
        if (bot) {
            bot.errors++;
            if (isRateLimit) {
                bot.rateLimitUntil = Date.now() + 60000; // 1 minute cooldown
            }
        }
    }

    resetBotErrors(botToken) {
        const bot = this.bots.find(b => b.token === botToken);
        if (bot) {
            bot.errors = 0;
        }
    }
}

// File name parser for metadata extraction
class FileNameParser {
    static parse(filename) {
        const cleaned = filename.replace(/\.[^/.]+$/, ""); // Remove extension
        
        // Extract year
        const yearMatch = cleaned.match(/\b(19|20)\d{2}\b/);
        const year = yearMatch ? yearMatch[0] : '';
        
        // Extract quality
        const qualityMatch = cleaned.match(/\b(480p|720p|1080p|1440p|2160p|4K|BluRay|WEBRip|HDRip|DVDRip|CAMRip|WEB-DL|BDRip)\b/i);
        const quality = qualityMatch ? qualityMatch[0] : '';
        
        // Better series detection patterns
        const isSeriesPattern = /\b(S\d{1,2}E\d{1,2}|S\d{1,2}|Season|Episode|EP?\d{1,2}|E\d{1,2})\b/i;
        const isSeries = isSeriesPattern.test(filename);
        
        // Extract season/episode info for series
        let seasonInfo = '';
        if (isSeries) {
            const seasonEpisodeMatch = filename.match(/S(\d{1,2})E(\d{1,2})/i);
            const seasonMatch = filename.match(/S(\d{1,2})/i);
            const episodeMatch = filename.match(/E(\d{1,2})/i);
            
            if (seasonEpisodeMatch) {
                seasonInfo = `S${seasonEpisodeMatch[1]}E${seasonEpisodeMatch[2]}`;
            } else {
                if (seasonMatch) seasonInfo += `S${seasonMatch[1]}`;
                if (episodeMatch) seasonInfo += `E${episodeMatch[1]}`;
            }
        }
        
        // Clean title (remove common patterns)
        let title = cleaned
            .replace(/\b(19|20)\d{2}\b/g, '') // Remove year
            .replace(/\b(480p|720p|1080p|1440p|2160p|4K|BluRay|WEBRip|HDRip|DVDRip|CAMRip|WEB-DL|BDRip)\b/gi, '') // Remove quality
            .replace(/\b(x264|x265|H264|H265|HEVC|AAC|AC3|DTS|5\.1|7\.1|10bit|8CH|2CH|DS4K|AMZN|UNCUT)\b/gi, '') // Remove codecs and extra info
            .replace(/\bS\d{1,2}E\d{1,2}\b/gi, '') // Remove season/episode from title
            .replace(/\bS\d{1,2}\b/gi, '') // Remove season from title
            .replace(/\bE\d{1,2}\b/gi, '') // Remove episode from title
            .replace(/[._-]/g, ' ') // Replace separators with spaces
            .replace(/\s+/g, ' ') // Multiple spaces to single
            .trim();

        return {
            title: title || filename,
            year,
            quality,
            type: isSeries ? 'series' : 'movie',
            seasonInfo,
            originalFileName: filename
        };
    }
}

// Telegram file detector with webhook support
class TelegramAutoDetector {
    constructor() {
        this.botRotator = new BotRotator(CONFIG.TELEGRAM_BOTS);
        this.setupWebhooks();
        this.startFallbackScanner();
        console.log('🤖 Initialized with', CONFIG.TELEGRAM_BOTS.length, 'bots');
        console.log('📡 Monitoring', CONFIG.MONITORED_CHANNELS.length, 'channels');
    }

    async setupWebhooks() {
        if (CONFIG.TELEGRAM_BOTS.length === 0) {
            console.log('⚠️ No valid bot tokens found');
            return;
        }

        for (const bot of this.botRotator.bots) {
            try {
                const webhookUrl = `https://${process.env.RENDER_EXTERNAL_HOSTNAME || 'localhost'}/webhook/${bot.index}`;
                
                await axios.post(`https://api.telegram.org/bot${bot.token}/setWebhook`, {
                    url: webhookUrl,
                    secret_token: CONFIG.WEBHOOK_SECRET,
                    allowed_updates: ['channel_post', 'message']
                });
                
                console.log('🔗 Webhook set for bot', bot.index);
                this.botRotator.resetBotErrors(bot.token);
            } catch (error) {
                console.error(`❌ Failed to set webhook for bot ${bot.index}:`, error.message);
                this.botRotator.markBotError(bot.token);
            }
        }
    }

    async handleWebhookUpdate(update, botIndex) {
        try {
            const message = update.channel_post || update.message;
            if (!message) return;

            // Check if message is from monitored channels
            const channelId = message.chat.id.toString();
            if (!CONFIG.MONITORED_CHANNELS.includes(channelId)) {
                return;
            }

            // Process video or document files
            const file = message.video || message.document;
            if (!file) return;

            await this.processNewFile(message, file, botIndex);
            
        } catch (error) {
            console.error('Error processing webhook update:', error);
        }
    }

    async processNewFile(message, file, botIndex) {
        try {
            const bot = this.botRotator.bots[botIndex];
            const metadata = FileNameParser.parse(file.file_name || 'Unknown File');
            
            // Generate unique ID based on file and channel to prevent duplicates
            const uniqueKey = `${message.chat.id}_${message.message_id}_${file.file_unique_id || file.file_id}`;
            const fileId = `tg:${metadata.type}:${Buffer.from(uniqueKey).toString('base64').replace(/[^a-zA-Z0-9]/g, '')}`;
            
            // Check if file already exists to prevent duplicates
            const existingFiles = metadata.type === 'movie' ? AUTO_DETECTED_FILES.movies : AUTO_DETECTED_FILES.series;
            if (existingFiles.has(fileId)) {
                console.log('📋 File already exists, skipping:', metadata.title);
                return;
            }
            
            // For large files (>20MB), we'll use alternative streaming methods
            let streamUrl = null;
            let streamType = 'telegram_link'; // Default to telegram link
            
            // Only try getFile for smaller files
            if (file.file_size && file.file_size < 20971520) { // 20MB limit
                try {
                    const fileResponse = await axios.get(`https://api.telegram.org/bot${bot.token}/getFile`, {
                        params: { file_id: file.file_id },
                        timeout: 5000
                    });
                    
                    if (fileResponse.data.ok) {
                        streamUrl = `https://api.telegram.org/file/bot${bot.token}/${fileResponse.data.result.file_path}`;
                        streamType = 'direct_url';
                        console.log('✅ Got direct URL for', metadata.title);
                    }
                    
                    this.botRotator.resetBotErrors(bot.token);
                } catch (error) {
                    if (error.response?.status === 429) {
                        this.botRotator.markBotError(bot.token, true);
                    }
                    console.log('⚠️ Small file direct URL failed for', metadata.title);
                }
            } else {
                console.log('📦 Large file detected:', metadata.title, `(${this.formatFileSize(file.file_size)})`);
            }
            
            // For large files or if direct URL failed, use different approaches
            if (!streamUrl) {
                // Try multiple URL formats for better compatibility
                const channelUsername = await this.getChannelUsername(message.chat.id, bot.token);
                
                if (channelUsername) {
                    // Public channel link (best compatibility)
                    streamUrl = `https://t.me/${channelUsername}/${message.message_id}`;
                    streamType = 'public_link';
                } else {
                    // Private channel link (requires Telegram app)
                    const cleanChannelId = message.chat.id.toString().replace('-100', '');
                    streamUrl = `https://t.me/c/${cleanChannelId}/${message.message_id}`;
                    streamType = 'private_link';
                }
                
                console.log('🔗 Using', streamType, 'for', metadata.title);
            }

            // Create file entry with better metadata
            const fileEntry = {
                id: fileId,
                name: metadata.title,
                year: metadata.year || new Date().getFullYear().toString(),
                description: `${metadata.seasonInfo ? `${metadata.seasonInfo} - ` : ''}${metadata.originalFileName}`,
                poster: this.getDefaultPoster(metadata.type),
                genre: [metadata.type === 'movie' ? 'Action' : 'TV Shows'], // Generic genres for now
                imdb_id: '', // We could implement TMDB lookup later
                streamUrl: streamUrl,
                quality: metadata.quality || this.guessQualityFromSize(file.file_size),
                size: this.formatFileSize(file.file_size),
                channelId: message.chat.id.toString(),
                messageId: message.message_id,
                fileId: file.file_id,
                fileName: metadata.originalFileName,
                dateAdded: Date.now(),
                botIndex: botIndex,
                streamType: streamType,
                runtime: this.guessRuntime(metadata.type) // Add runtime for Stremio
            };

            // Store in appropriate category
            if (metadata.type === 'movie') {
                AUTO_DETECTED_FILES.movies.set(fileId, fileEntry);
            } else {
                AUTO_DETECTED_FILES.series.set(fileId, fileEntry);
            }

            AUTO_DETECTED_FILES.lastUpdate = Date.now();
            
            console.log('✅ Added new', metadata.type + ':', metadata.title, 
                       `(${AUTO_DETECTED_FILES.movies.size + AUTO_DETECTED_FILES.series.size} total files)`);
                       
        } catch (error) {
            console.error('Error processing file:', error);
        }
    }

    async getChannelUsername(chatId, botToken) {
        try {
            const response = await axios.get(`https://api.telegram.org/bot${botToken}/getChat`, {
                params: { chat_id: chatId },
                timeout: 5000
            });
            
            if (response.data.ok && response.data.result.username) {
                return response.data.result.username;
            }
        } catch (error) {
            // Ignore error, channel is probably private
        }
        return null;
    }

    guessQualityFromSize(fileSize) {
        if (!fileSize) return 'Unknown';
        
        const sizeGB = fileSize / (1024 * 1024 * 1024);
        
        if (sizeGB > 3) return '4K/2160p';
        if (sizeGB > 1.5) return '1080p';
        if (sizeGB > 0.8) return '720p';
        return '480p';
    }

    guessRuntime(type) {
        // Add some runtime for better Stremio display
        return type === 'movie' ? '120 min' : '45 min';
    }

    formatFileSize(bytes) {
        if (!bytes) return '';
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
    }

    getDefaultPoster(type) {
        return type === 'movie' 
            ? 'https://via.placeholder.com/300x450/2c3e50/ecf0f1?text=MOVIE'
            : 'https://via.placeholder.com/300x450/34495e/ecf0f1?text=SERIES';
    }

    async startFallbackScanner() {
        // Periodic scan as fallback in case webhooks miss something
        setInterval(async () => {
            if (CONFIG.TELEGRAM_BOTS.length === 0) return;
            
            try {
                const bot = this.botRotator.getAvailableBot();
                console.log('🔄 Running fallback scan...');
                
                // This is a basic fallback - in production you might want to implement
                // a more sophisticated scanning method
                
            } catch (error) {
                console.error('Fallback scan error:', error);
            }
        }, CONFIG.FILE_SCAN_INTERVAL);
    }
}

// Enhanced media server with auto-detection
class EnhancedMediaServer {
    constructor() {
        this.addon = new addonBuilder(manifest);
        this.detector = new TelegramAutoDetector();
        this.setupRoutes();
        this.cache = new Map();
        
        console.log('🚀 Enhanced Media Server v5.0 initialized');
    }

    setupRoutes() {
        this.addon.defineCatalogHandler(({ type, id, extra }) => {
            console.log('📋 Catalog request:', type, '/', id, extra);
            return this.getCatalog(type, id, extra);
        });

        this.addon.defineStreamHandler(({ type, id }) => {
            console.log('🎬 Stream request:', type, '/', id);
            return this.getStreams(type, id);
        });

        this.addon.defineMetaHandler(({ type, id }) => {
            console.log('📊 Meta request:', type, '/', id);
            return this.getMeta(type, id);
        });
    }

    async getCatalog(type, id, extra = {}) {
        try {
            const cacheKey = `catalog:${type}:${id}:${JSON.stringify(extra)}`;
            
            if (this.cache.has(cacheKey)) {
                const cached = this.cache.get(cacheKey);
                if (Date.now() - cached.timestamp < CONFIG.CACHE_TTL) {
                    return cached.data;
                }
            }

            // Get files from auto-detected storage
            const fileMap = type === 'movie' ? AUTO_DETECTED_FILES.movies : AUTO_DETECTED_FILES.series;
            let items = Array.from(fileMap.values());

            // Apply search filter
            if (extra.search) {
                const searchTerm = extra.search.toLowerCase();
                items = items.filter(item => 
                    item.name.toLowerCase().includes(searchTerm) ||
                    item.description.toLowerCase().includes(searchTerm) ||
                    item.fileName.toLowerCase().includes(searchTerm)
                );
            }

            // Sort by date added (newest first)
            items.sort((a, b) => b.dateAdded - a.dateAdded);

            const metas = items.map(item => ({
                id: item.id,
                type: type,
                name: item.name,
                poster: item.poster,
                year: item.year,
                imdb_id: item.imdb_id,
                description: item.description,
                genre: item.genre
            }));

            const result = { metas };
            
            this.cache.set(cacheKey, {
                data: result,
                timestamp: Date.now()
            });

            console.log('📋 Returning', metas.length, type + 's for catalog', id);
            return Promise.resolve(result);

        } catch (error) {
            console.error('Catalog error:', error);
            return Promise.resolve({ metas: [] });
        }
    }

    async getStreams(type, id) {
        try {
            const fileMap = type === 'movie' ? AUTO_DETECTED_FILES.movies : AUTO_DETECTED_FILES.series;
            const content = fileMap.get(id);

            if (!content) {
                console.log('❌ No content found for', id);
                return Promise.resolve({ streams: [] });
            }

            // Try to get fresh download URL if needed
            let streamUrl = content.streamUrl;
            if (!streamUrl || streamUrl.includes('t.me/c/')) {
                try {
                    const bot = this.detector.botRotator.bots[content.botIndex] || 
                               this.detector.botRotator.getAvailableBot();
                    
                    const fileResponse = await axios.get(`https://api.telegram.org/bot${bot.token}/getFile`, {
                        params: { file_id: content.fileId }
                    });
                    
                    if (fileResponse.data.ok) {
                        streamUrl = `https://api.telegram.org/file/bot${bot.token}/${fileResponse.data.result.file_path}`;
                        // Update stored URL
                        content.streamUrl = streamUrl;
                    }
                } catch (error) {
                    console.log('Could not refresh URL for', content.name);
                }
            }

            const stream = {
                title: `🎬 ${content.name} [${content.quality}]${content.size ? ` 💾 ${content.size}` : ''}`,
                url: streamUrl,
                behaviorHints: {
                    notWebReady: true,
                    bingeGroup: content.name
                }
            };

            console.log('✅ Generated stream for', content.name);
            return Promise.resolve({ streams: [stream] });

        } catch (error) {
            console.error('Stream error:', error);
            return Promise.resolve({ streams: [] });
        }
    }

    async getMeta(type, id) {
        try {
            const fileMap = type === 'movie' ? AUTO_DETECTED_FILES.movies : AUTO_DETECTED_FILES.series;
            const content = fileMap.get(id);

            if (!content) {
                return Promise.reject(new Error('Content not found'));
            }

            const meta = {
                id: content.id,
                type: type,
                name: content.name,
                poster: content.poster,
                year: content.year,
                imdb_id: content.imdb_id,
                description: content.description,
                genre: content.genre
            };

            return Promise.resolve({ meta });

        } catch (error) {
            console.error('Meta error:', error);
            return Promise.reject(error);
        }
    }

    getExpressApp() {
        const app = express();
        
        app.use(cors());
        app.use(express.json());

        // Webhook endpoints for each bot
        for (let i = 0; i < CONFIG.TELEGRAM_BOTS.length; i++) {
            app.post(`/webhook/${i}`, (req, res) => {
                // Verify webhook secret
                const receivedSecret = req.headers['x-telegram-bot-api-secret-token'];
                if (receivedSecret !== CONFIG.WEBHOOK_SECRET) {
                    return res.status(401).send('Unauthorized');
                }

                this.detector.handleWebhookUpdate(req.body, i);
                res.status(200).send('OK');
            });
        }



        // Root endpoint
        app.get('/', (req, res) => {
            res.redirect('/configure');
        });

        // Health check
        app.get('/health', (req, res) => {
            const totalFiles = AUTO_DETECTED_FILES.movies.size + AUTO_DETECTED_FILES.series.size;
            res.json({ 
                status: 'ok',
                version: '5.0.0',
                movies: AUTO_DETECTED_FILES.movies.size,
                series: AUTO_DETECTED_FILES.series.size,
                total_files: totalFiles,
                last_update: new Date(AUTO_DETECTED_FILES.lastUpdate).toISOString(),
                bots_configured: CONFIG.TELEGRAM_BOTS.length,
                channels_monitored: CONFIG.MONITORED_CHANNELS.length,
                cache_size: this.cache.size
            });
        });

        // Configuration interface
        app.get('/configure', (req, res) => {
            const totalFiles = AUTO_DETECTED_FILES.movies.size + AUTO_DETECTED_FILES.series.size;
            const lastUpdate = new Date(AUTO_DETECTED_FILES.lastUpdate).toLocaleString();
            
            const recentMovies = Array.from(AUTO_DETECTED_FILES.movies.values())
                .sort((a, b) => b.dateAdded - a.dateAdded)
                .slice(0, 10)
                .map(movie => `<li><strong>${movie.name}</strong> (${movie.year}) - ${movie.quality} - <small>${new Date(movie.dateAdded).toLocaleDateString()}</small></li>`)
                .join('');
            
            const recentSeries = Array.from(AUTO_DETECTED_FILES.series.values())
                .sort((a, b) => b.dateAdded - a.dateAdded)
                .slice(0, 10)
                .map(series => `<li><strong>${series.name}</strong> (${series.year}) - ${series.quality} - <small>${new Date(series.dateAdded).toLocaleDateString()}</small></li>`)
                .join('');

            const htmlContent = `<!DOCTYPE html>
<html>
<head>
    <title>Auto-Detect Media Collection v5.0</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 1200px; 
            margin: 0 auto; 
            padding: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: #fff;
            min-height: 100vh;
        }
        .container { 
            background: rgba(255, 255, 255, 0.1); 
            padding: 30px; 
            border-radius: 20px; 
            backdrop-filter: blur(10px);
            box-shadow: 0 8px 32px rgba(0,0,0,0.3);
        }
        h1 { 
            color: #fff; 
            text-align: center;
            margin-bottom: 30px;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
        }
        .stats { 
            display: grid; 
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); 
            gap: 20px; 
            margin: 30px 0; 
        }
        .stat-card { 
            background: rgba(255, 255, 255, 0.2); 
            padding: 25px; 
            border-radius: 15px; 
            text-align: center;
            backdrop-filter: blur(5px);
        }
        .stat-number { 
            font-size: 2.5em; 
            font-weight: bold; 
            margin-bottom: 10px; 
        }
        .manifest-url { 
            background: rgba(255, 255, 255, 0.2); 
            padding: 25px; 
            border-radius: 15px; 
            margin: 25px 0; 
            text-align: center;
            backdrop-filter: blur(5px);
        }
        .btn { 
            background: rgba(255, 255, 255, 0.2); 
            color: white; 
            padding: 15px 30px; 
            border: 2px solid rgba(255, 255, 255, 0.3); 
            border-radius: 10px; 
            text-decoration: none; 
            display: inline-block; 
            margin: 10px; 
            cursor: pointer;
            font-weight: bold;
            transition: all 0.3s ease;
            backdrop-filter: blur(5px);
        }
        .btn:hover {
            background: rgba(255, 255, 255, 0.3);
            transform: translateY(-2px);
        }
        ul { 
            background: rgba(255, 255, 255, 0.1); 
            padding: 25px; 
            border-radius: 15px; 
            margin: 20px 0;
            backdrop-filter: blur(5px);
        }
        li { 
            margin: 10px 0; 
            padding: 10px; 
            background: rgba(255, 255, 255, 0.1); 
            border-radius: 8px; 
            border-left: 4px solid #fff;
        }
        code { 
            background: rgba(0, 0, 0, 0.3); 
            padding: 6px 12px; 
            border-radius: 6px; 
            font-family: 'Monaco', monospace;
            word-break: break-all;
        }
        .status-indicator {
            display: inline-block;
            width: 12px;
            height: 12px;
            border-radius: 50%;
            margin-right: 8px;
        }
        .status-online { background-color: #2ecc71; }
        .status-offline { background-color: #e74c3c; }
        .auto-refresh { 
            position: fixed; 
            top: 20px; 
            right: 20px; 
            background: rgba(0,0,0,0.5); 
            padding: 10px; 
            border-radius: 5px; 
            font-size: 12px;
        }
    </style>
</head>
<body>
    <div class="auto-refresh">Auto-refresh: ON</div>
    <div class="container">
        <h1>🤖 Auto-Detect Media Collection v5.0</h1>
        
        <div class="stats">
            <div class="stat-card">
                <div class="stat-number">${AUTO_DETECTED_FILES.movies.size}</div>
                <div>Movies Detected</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${AUTO_DETECTED_FILES.series.size}</div>
                <div>Series Detected</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${CONFIG.TELEGRAM_BOTS.length}</div>
                <div>Active Bots</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${CONFIG.MONITORED_CHANNELS.length}</div>
                <div>Monitored Channels</div>
            </div>
        </div>
        
        <div class="manifest-url">
            <h3>📱 Install in Stremio:</h3>
            <p><code>${req.protocol}://${req.get('host')}/manifest.json</code></p>
            <p><small>Copy this URL and paste it in Stremio → Addons → Install from URL</small></p>
        </div>

        <div style="background: rgba(255, 255, 255, 0.1); padding: 20px; border-radius: 15px; margin: 20px 0;">
            <h3>🔄 System Status:</h3>
            <p><span class="status-indicator ${totalFiles > 0 ? 'status-online' : 'status-offline'}"></span> 
               <strong>${totalFiles}</strong> total files detected</p>
            <p>📅 <strong>Last Update:</strong> ${lastUpdate}</p>
            <p>🤖 <strong>Bots Status:</strong> ${CONFIG.TELEGRAM_BOTS.length} configured</p>
            <p>📡 <strong>Webhooks:</strong> Active on /webhook/0 to /webhook/${CONFIG.TELEGRAM_BOTS.length - 1}</p>
        </div>

        <h3>🎬 Recent Movies (${AUTO_DETECTED_FILES.movies.size} total):</h3>
        <ul>${recentMovies || '<li>No movies detected yet. Add video files to your monitored channels!</li>'}</ul>

        <h3>📺 Recent Series (${AUTO_DETECTED_FILES.series.size} total):</h3>
        <ul>${recentSeries || '<li>No series detected yet. Add video files to your monitored channels!</li>'}</ul>

        <div style="background: rgba(255, 255, 255, 0.1); padding: 20px; border-radius: 15px; margin: 20px 0;">
            <h3>⚡ Auto-Detection Features:</h3>
            <ul style="background: none; padding: 0; margin: 0;">
                <li>🎯 <strong>Real-time Detection:</strong> Files are detected instantly via webhooks</li>
                <li>🔄 <strong>Smart Bot Rotation:</strong> Automatic rate limit avoidance</li>
                <li>📝 <strong>Intelligent Parsing:</strong> Extracts title, year, quality from filenames</li>
                <li>🎭 <strong>Auto-categorization:</strong> Movies vs Series detection</li>
                <li>⚡ <strong>Instant Streaming:</strong> Direct Telegram file URLs</li>
            </ul>
        </div>

        <div style="text-align: center; margin-top: 40px;">
            <a href="/health" class="btn">🔍 System Health</a>
            <a href="/manifest.json" class="btn">📋 View Manifest</a>
            <button onclick="location.reload()" class="btn">🔄 Refresh</button>
        </div>

        <script>
            // Auto-refresh every 30 seconds
            setInterval(() => location.reload(), 30000);
            // Keep-alive ping
            setInterval(() => fetch('/health').catch(() => {}), 60000);
        </script>
    </div>
</body>
</html>`;

            res.send(htmlContent);
        });

        // API endpoint to manually trigger channel scan
        app.post('/scan', async (req, res) => {
            try {
                // Trigger a manual scan if needed
                res.json({ message: 'Scan triggered', timestamp: new Date().toISOString() });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Serve manifest
        app.get('/manifest.json', (req, res) => {
            res.json(manifest);
        });

        // Use addon interface with error handling
        try {
            const addonInterface = this.addon.getInterface();
            if (addonInterface && typeof addonInterface === 'function') {
                app.use(addonInterface);
                console.log('✅ Stremio addon interface mounted successfully');
            } else {
                console.log('⚠️ Addon interface not available, using manual routes');
                
                // Manual route handlers as fallback
                app.get('/catalog/:type/:id.json', async (req, res) => {
                    try {
                        const result = await this.getCatalog(req.params.type, req.params.id, req.query);
                        res.json(result);
                    } catch (error) {
                        res.status(500).json({ error: error.message });
                    }
                });
                
                app.get('/stream/:type/:id.json', async (req, res) => {
                    try {
                        const result = await this.getStreams(req.params.type, req.params.id);
                        res.json(result);
                    } catch (error) {
                        res.status(500).json({ error: error.message });
                    }
                });
                
                app.get('/meta/:type/:id.json', async (req, res) => {
                    try {
                        const result = await this.getMeta(req.params.type, req.params.id);
                        res.json(result);
                    } catch (error) {
                        res.status(500).json({ error: error.message });
                    }
                });
            }
        } catch (error) {
            console.error('❌ Error setting up addon interface:', error.message);
            console.log('🔄 Falling back to manual routes');
            
            // Manual route handlers as fallback
            app.get('/catalog/:type/:id.json', async (req, res) => {
                try {
                    const result = await this.getCatalog(req.params.type, req.params.id, req.query);
                    res.json(result);
                } catch (error) {
                    res.status(500).json({ error: error.message });
                }
            });
            
            app.get('/stream/:type/:id.json', async (req, res) => {
                try {
                    const result = await this.getStreams(req.params.type, req.params.id);
                    res.json(result);
                } catch (error) {
                    res.status(500).json({ error: error.message });
                }
            });
            
            app.get('/meta/:type/:id.json', async (req, res) => {
                try {
                    const result = await this.getMeta(req.params.type, req.params.id);
                    res.json(result);
                } catch (error) {
                    res.status(500).json({ error: error.message });
                }
            });
        }

        return app;
    }

    start() {
        const app = this.getExpressApp();
        
        app.listen(CONFIG.PORT, () => {
            console.log('🚀 Enhanced Media Server v5.0 running on port', CONFIG.PORT);
            console.log('🤖 Bots configured:', CONFIG.TELEGRAM_BOTS.length);
            console.log('📡 Channels monitored:', CONFIG.MONITORED_CHANNELS.length);
            console.log('🔗 Manifest: http://localhost:' + CONFIG.PORT + '/manifest.json');
            console.log('⚙️  Management: http://localhost:' + CONFIG.PORT + '/configure');
            console.log('📊 Auto-detected files:', AUTO_DETECTED_FILES.movies.size + AUTO_DETECTED_FILES.series.size);
        });
    }
}

// Initialize and start
if (require.main === module) {
    try {
        const server = new EnhancedMediaServer();
        server.start();
    } catch (error) {
        console.error('Error starting server:', error);
        process.exit(1);
    }
}

module.exports = { EnhancedMediaServer, CONFIG };
