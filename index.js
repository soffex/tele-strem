const { addonBuilder } = require('stremio-addon-sdk');
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');

// Configuration first - before everything else
const CONFIG = {
    // Bot tokens 
    TELEGRAM_BOTS: (() => {
        const bots = [];
        for (let i = 1; i <= 10; i++) {
            const token = process.env[`TELEGRAM_BOT_TOKEN_${i}`];
            if (token && !token.includes('your_bot')) {
                bots.push(token);
            }
        }
        if (bots.length === 0 && process.env.TELEGRAM_BOT_TOKENS) {
            const tokens = process.env.TELEGRAM_BOT_TOKENS.split(',')
                .map(t => t.trim())
                .filter(t => t && !t.includes('your_bot'));
            bots.push(...tokens);
        }
        if (bots.length === 0 && process.env.TELEGRAM_BOT_TOKEN) {
            const token = process.env.TELEGRAM_BOT_TOKEN.trim();
            if (token && !token.includes('your_bot')) {
                bots.push(token);
            }
        }
        return bots;
    })(),
    
    // Channels
    MONITORED_CHANNELS: (() => {
        const channels = [];
        if (process.env.TELEGRAM_CHANNELS) {
            const channelList = process.env.TELEGRAM_CHANNELS.split(',')
                .map(c => c.trim())
                .filter(c => c && (c.startsWith('-') || c.startsWith('@')));
            channels.push(...channelList);
        }
        for (let i = 1; i <= 10; i++) {
            const channel = process.env[`TELEGRAM_CHANNEL_${i}`];
            if (channel && (channel.startsWith('-') || channel.startsWith('@'))) {
                channels.push(channel);
            }
        }
        return channels;
    })(),
    
    PORT: process.env.PORT || 3000,
    WEBHOOK_SECRET: process.env.WEBHOOK_SECRET || crypto.randomBytes(16).toString('hex'),
    CACHE_TTL: 3600000,
    FILE_SCAN_INTERVAL: 300000
};

// Simple hardcoded manifest to avoid CONFIG issues
const manifest = {
    id: 'org.telegram.simple',
    version: '5.1.0',
    name: 'Telegram Media Stream',
    description: 'Stream media from Telegram channels',
    resources: ['catalog', 'stream', 'meta'],
    types: ['movie', 'series'],
    idPrefixes: ['tg'],
    catalogs: [
        {
            type: 'movie',
            id: 'telegram-movies',
            name: 'Movies',
            extra: [{ name: 'search', isRequired: false }]
        },
        {
            type: 'series',
            id: 'telegram-series',
            name: 'Series', 
            extra: [{ name: 'search', isRequired: false }]
        }
    ]
};

// File storage with better duplicate prevention
const DETECTED_FILES = {
    movies: new Map(),
    series: new Map(),
    processed: new Set(), // Track processed message IDs
    lastUpdate: Date.now()
};

// Simple file parser
class FileParser {
    static parse(filename) {
        const name = filename.replace(/\.[^/.]+$/, "");
        
        // Better series detection
        const isSeriesPattern = /\b(S\d{1,2}E\d{1,2}|S\d{1,2}|Season|Episode)\b/i;
        const isSeries = isSeriesPattern.test(filename);
        
        // Extract year
        const yearMatch = name.match(/\b(19|20)\d{2}\b/);
        const year = yearMatch ? yearMatch[0] : new Date().getFullYear().toString();
        
        // Extract quality
        const qualityMatch = name.match(/\b(480p|720p|1080p|1440p|2160p|4K|BluRay|WEBRip|HDRip)\b/i);
        const quality = qualityMatch ? qualityMatch[0] : '';
        
        // Clean title
        let title = name
            .replace(/\b(19|20)\d{2}\b/g, '')
            .replace(/\b(480p|720p|1080p|1440p|2160p|4K|BluRay|WEBRip|HDRip|DVDRip|CAMRip|WEB-DL|BDRip)\b/gi, '')
            .replace(/\b(x264|x265|H264|H265|HEVC|AAC|AC3|DTS|10bit|8CH|2CH|HEV)\b/gi, '')
            .replace(/\bS\d{1,2}E\d{1,2}\b/gi, '')
            .replace(/[._-]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        return {
            title: title || filename,
            year,
            quality,
            type: isSeries ? 'series' : 'movie',
            originalFileName: filename
        };
    }
}

// Bot rotation
class BotManager {
    constructor(tokens) {
        this.bots = tokens.map((token, index) => ({
            token,
            index,
            lastUsed: 0,
            errors: 0
        }));
        this.currentIndex = 0;
    }

    getBot() {
        if (this.bots.length === 0) return null;
        const bot = this.bots[this.currentIndex % this.bots.length];
        this.currentIndex++;
        bot.lastUsed = Date.now();
        return bot;
    }
}

// File detector
class FileDetector {
    constructor() {
        this.botManager = new BotManager(CONFIG.TELEGRAM_BOTS);
        this.setupWebhooks();
        console.log('🤖 Initialized with', CONFIG.TELEGRAM_BOTS.length, 'bots');
        console.log('📡 Monitoring', CONFIG.MONITORED_CHANNELS.length, 'channels');
    }

    async setupWebhooks() {
        for (let i = 0; i < CONFIG.TELEGRAM_BOTS.length; i++) {
            try {
                const webhookUrl = `https://${process.env.RENDER_EXTERNAL_HOSTNAME}/webhook/${i}`;
                await axios.post(`https://api.telegram.org/bot${CONFIG.TELEGRAM_BOTS[i]}/setWebhook`, {
                    url: webhookUrl,
                    secret_token: CONFIG.WEBHOOK_SECRET
                });
                console.log('🔗 Webhook set for bot', i);
            } catch (error) {
                console.error('❌ Webhook setup failed for bot', i, ':', error.message);
            }
        }
    }

    async handleWebhook(update, botIndex) {
        try {
            const message = update.channel_post || update.message;
            if (!message) return;

            const channelId = message.chat.id.toString();
            if (!CONFIG.MONITORED_CHANNELS.includes(channelId)) return;

            const file = message.video || message.document;
            if (!file) return;

            // Prevent duplicates
            const messageKey = `${channelId}_${message.message_id}`;
            if (DETECTED_FILES.processed.has(messageKey)) {
                console.log('📋 Already processed:', messageKey);
                return;
            }

            await this.processFile(message, file, botIndex);
            DETECTED_FILES.processed.add(messageKey);

        } catch (error) {
            console.error('Webhook processing error:', error);
        }
    }

    async processFile(message, file, botIndex) {
        try {
            const metadata = FileParser.parse(file.file_name || 'Unknown File');
            const fileId = `tg:${metadata.type}:${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            console.log('📦 Processing file:', metadata.title, `(${this.formatSize(file.file_size)})`);

            // Generate stream URL - prioritize public links
            let streamUrl;
            const channelUsername = await this.getChannelUsername(message.chat.id, CONFIG.TELEGRAM_BOTS[botIndex]);
            
            if (channelUsername) {
                streamUrl = `https://t.me/${channelUsername}/${message.message_id}`;
                console.log('🔗 Public link generated for', metadata.title);
            } else {
                const cleanChannelId = message.chat.id.toString().replace('-100', '');
                streamUrl = `https://t.me/c/${cleanChannelId}/${message.message_id}`;
                console.log('🔗 Private link generated for', metadata.title);
            }

            // Create comprehensive file entry
            const fileEntry = {
                id: fileId,
                name: metadata.title,
                year: metadata.year,
                description: `${metadata.originalFileName}\n\nTo play: Install Telegram app and open this link, or use a compatible player.`,
                poster: this.getDefaultPoster(metadata.type),
                genre: [metadata.type === 'movie' ? 'Action' : 'Drama'],
                imdb_id: '',
                streamUrl: streamUrl,
                quality: metadata.quality || this.guessQuality(file.file_size),
                size: this.formatSize(file.file_size),
                channelId: message.chat.id.toString(),
                messageId: message.message_id,
                dateAdded: Date.now(),
                // Add metadata that Stremio expects
                runtime: metadata.type === 'movie' ? '120 min' : '45 min',
                releaseInfo: metadata.quality || 'Unknown Quality'
            };

            // Store in correct category
            const storage = metadata.type === 'movie' ? DETECTED_FILES.movies : DETECTED_FILES.series;
            storage.set(fileId, fileEntry);
            DETECTED_FILES.lastUpdate = Date.now();
            
            console.log('✅ Added', metadata.type + ':', metadata.title, 
                       `(Total: ${DETECTED_FILES.movies.size + DETECTED_FILES.series.size} files)`);

        } catch (error) {
            console.error('File processing error:', error);
        }
    }

    async getChannelUsername(chatId, botToken) {
        try {
            const response = await axios.get(`https://api.telegram.org/bot${botToken}/getChat`, {
                params: { chat_id: chatId },
                timeout: 5000
            });
            return response.data.ok ? response.data.result.username : null;
        } catch (error) {
            return null;
        }
    }

    formatSize(bytes) {
        if (!bytes) return '';
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
    }

    guessQuality(fileSize) {
        if (!fileSize) return 'Unknown';
        const sizeGB = fileSize / (1024 * 1024 * 1024);
        if (sizeGB > 3) return '4K';
        if (sizeGB > 1.5) return '1080p';
        if (sizeGB > 0.8) return '720p';
        return '480p';
    }

    getDefaultPoster(type) {
        return type === 'movie' 
            ? 'https://via.placeholder.com/300x450/2c3e50/ecf0f1?text=MOVIE'
            : 'https://via.placeholder.com/300x450/34495e/ecf0f1?text=SERIES';
    }
}

// Main server
class MediaServer {
    constructor() {
        this.addon = new addonBuilder(manifest);
        this.detector = new FileDetector();
        this.cache = new Map();
        this.setupHandlers();
        console.log('🚀 Media Server v5.1 initialized');
    }

    setupHandlers() {
        this.addon.defineCatalogHandler(({ type, id, extra }) => {
            return this.getCatalog(type, id, extra);
        });

        this.addon.defineStreamHandler(({ type, id }) => {
            return this.getStreams(type, id);
        });

        this.addon.defineMetaHandler(({ type, id }) => {
            return this.getMeta(type, id);
        });
    }

    async getCatalog(type, id, extra = {}) {
        try {
            console.log('📋 Catalog request:', type, id);
            
            const storage = type === 'movie' ? DETECTED_FILES.movies : DETECTED_FILES.series;
            let items = Array.from(storage.values());

            // Search filter
            if (extra.search) {
                const searchTerm = extra.search.toLowerCase();
                items = items.filter(item => 
                    item.name.toLowerCase().includes(searchTerm) ||
                    item.description.toLowerCase().includes(searchTerm)
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
                genre: item.genre,
                releaseInfo: item.releaseInfo
            }));

            console.log('📋 Returning', metas.length, type + 's');
            return { metas };

        } catch (error) {
            console.error('Catalog error:', error);
            return { metas: [] };
        }
    }

    async getStreams(type, id) {
        try {
            console.log('🎬 Stream request:', type, id);
            
            const storage = type === 'movie' ? DETECTED_FILES.movies : DETECTED_FILES.series;
            const content = storage.get(id);

            if (!content) {
                console.log('❌ Content not found:', id);
                return { streams: [] };
            }

            const stream = {
                title: `📺 ${content.name} [${content.quality}] ${content.size}`,
                url: content.streamUrl,
                behaviorHints: {
                    notWebReady: true,
                    bingeGroup: content.name
                }
            };

            console.log('✅ Stream generated:', content.name);
            return { streams: [stream] };

        } catch (error) {
            console.error('Stream error:', error);
            return { streams: [] };
        }
    }

    async getMeta(type, id) {
        try {
            console.log('📊 Meta request:', type, id);
            
            const storage = type === 'movie' ? DETECTED_FILES.movies : DETECTED_FILES.series;
            const content = storage.get(id);

            if (!content) {
                throw new Error('Content not found');
            }

            const meta = {
                id: content.id,
                type: type,
                name: content.name,
                poster: content.poster,
                year: content.year,
                runtime: content.runtime,
                genre: content.genre,
                description: content.description,
                releaseInfo: content.releaseInfo
            };

            console.log('✅ Meta generated:', content.name);
            return { meta };

        } catch (error) {
            console.error('Meta error:', error);
            throw error;
        }
    }

    setupFallbackRoutes(app) {
        // Manual Stremio protocol routes
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
        
        console.log('✅ Fallback routes configured');
    }

    start() {
        const app = express();
        app.use(cors());
        app.use(express.json());

        // Webhooks
        for (let i = 0; i < CONFIG.TELEGRAM_BOTS.length; i++) {
            app.post(`/webhook/${i}`, (req, res) => {
                const secret = req.headers['x-telegram-bot-api-secret-token'];
                if (secret !== CONFIG.WEBHOOK_SECRET) {
                    return res.status(401).send('Unauthorized');
                }
                this.detector.handleWebhook(req.body, i);
                res.status(200).send('OK');
            });
        }

        // Basic routes
        app.get('/', (req, res) => res.redirect('/configure'));
        
        app.get('/health', (req, res) => {
            const total = DETECTED_FILES.movies.size + DETECTED_FILES.series.size;
            res.json({
                status: 'ok',
                movies: DETECTED_FILES.movies.size,
                series: DETECTED_FILES.series.size,
                total: total,
                bots: CONFIG.TELEGRAM_BOTS.length,
                channels: CONFIG.MONITORED_CHANNELS.length
            });
        });

        app.get('/configure', (req, res) => {
            const total = DETECTED_FILES.movies.size + DETECTED_FILES.series.size;
            const manifestUrl = `${req.protocol}://${req.get('host')}/manifest.json`;
            
            res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>Telegram Media Stream v5.1</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; background: #1a1a2e; color: #fff; }
        .container { background: #16213e; padding: 30px; border-radius: 15px; }
        h1 { color: #ff6b35; text-align: center; }
        .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 20px; margin: 20px 0; }
        .stat { background: #0f3460; padding: 20px; border-radius: 10px; text-align: center; }
        .stat-number { font-size: 2em; font-weight: bold; color: #ff6b35; }
        .manifest { background: #0f3460; padding: 20px; border-radius: 10px; margin: 20px 0; text-align: center; }
        code { background: rgba(255,255,255,0.1); padding: 10px; border-radius: 5px; display: block; margin: 10px 0; }
        .status { color: ${total > 0 ? '#2ecc71' : '#e74c3c'}; }
    </style>
</head>
<body>
    <div class="container">
        <h1>📺 Telegram Media Stream v5.1</h1>
        
        <div class="stats">
            <div class="stat">
                <div class="stat-number">${DETECTED_FILES.movies.size}</div>
                <div>Movies</div>
            </div>
            <div class="stat">
                <div class="stat-number">${DETECTED_FILES.series.size}</div>
                <div>Series</div>
            </div>
            <div class="stat">
                <div class="stat-number">${CONFIG.TELEGRAM_BOTS.length}</div>
                <div>Bots</div>
            </div>
            <div class="stat">
                <div class="stat-number">${CONFIG.MONITORED_CHANNELS.length}</div>
                <div>Channels</div>
            </div>
        </div>
        
        <div class="manifest">
            <h3>📱 Install in Stremio:</h3>
            <code>${manifestUrl}</code>
            <p><small>Copy this URL and paste it in Stremio → Addons → Install from URL</small></p>
        </div>
        
        <div class="status">
            <h3>📊 System Status:</h3>
            <p>Status: ${total > 0 ? '✅ Active' : '⚠️ Waiting for files'}</p>
            <p>Total Files: ${total}</p>
            <p>Last Update: ${new Date(DETECTED_FILES.lastUpdate).toLocaleString()}</p>
        </div>
        
        <div style="margin-top: 30px; padding: 20px; background: rgba(255,193,7,0.1); border-radius: 10px;">
            <h3>⚠️ Important Note:</h3>
            <p>Due to Telegram's Bot API limitations, files larger than 20MB require the Telegram app to play. 
            For best results, install Telegram on your device and it will automatically handle the streaming.</p>
        </div>
    </div>
</body>
</html>`);
        });

        app.get('/manifest.json', (req, res) => {
            res.json(manifest);
        });

        // Addon interface with fallback
        try {
            const addonInterface = this.addon.getInterface();
            if (addonInterface && typeof addonInterface === 'function') {
                app.use(addonInterface);
                console.log('✅ Stremio interface mounted');
            } else {
                console.log('⚠️ Using fallback routes');
                this.setupFallbackRoutes(app);
            }
        } catch (error) {
            console.error('❌ Addon interface failed:', error);
            console.log('🔄 Setting up fallback routes');
            this.setupFallbackRoutes(app);
        }

        app.listen(CONFIG.PORT, () => {
            console.log('🚀 Server running on port', CONFIG.PORT);
            console.log('🔗 Manifest:', `http://localhost:${CONFIG.PORT}/manifest.json`);
        });
    }
}

// Start server
if (require.main === module) {
    try {
        const server = new MediaServer();
        server.start();
    } catch (error) {
        console.error('Server start error:', error);
        process.exit(1);
    }
}

module.exports = { MediaServer, CONFIG };
