const { addonBuilder } = require('stremio-addon-sdk');
const axios = require('axios');
const express = require('express');
const cors = require('cors');

// Addon manifest
const manifest = {
    id: 'org.telegram.streams',
    version: '1.0.0',
    name: 'Telegram Streams',
    description: 'Stream movies and series from your Telegram channels',
    resources: ['stream'],
    types: ['movie', 'series'],
    idPrefixes: ['tt', 'tmdb'],
    catalogs: []
};

// Configuration
const CONFIG = {
    TELEGRAM_BOT_TOKENS: (process.env.TELEGRAM_BOT_TOKENS || process.env.TELEGRAM_BOT_TOKEN || '').split(',').filter(Boolean),
    TELEGRAM_CHANNELS: (process.env.TELEGRAM_CHANNELS || '').split(',').filter(Boolean),
    PORT: process.env.PORT || 3000,
    CACHE_TTL: 3600000, // 1 hour in milliseconds
    RATE_LIMIT_DELAY: parseInt(process.env.RATE_LIMIT_DELAY) || 1000, // ms between requests
    MAX_REQUESTS_PER_BOT_PER_MINUTE: parseInt(process.env.MAX_REQUESTS_PER_BOT_PER_MINUTE) || 20,
    RETRY_ATTEMPTS: parseInt(process.env.RETRY_ATTEMPTS) || 3,
    RETRY_DELAY: parseInt(process.env.RETRY_DELAY) || 2000, // ms
};

// Simple in-memory cache
const cache = new Map();

// Bot management for rate limiting
class BotManager {
    constructor(botTokens) {
        this.botTokens = botTokens;
        this.currentBotIndex = 0;
        this.botUsage = new Map(); // Track usage per bot
        this.lastRequestTime = new Map(); // Track last request time per bot
        
        // Initialize usage tracking
        botTokens.forEach(token => {
            this.botUsage.set(token, { requests: 0, resetTime: Date.now() + 60000 });
            this.lastRequestTime.set(token, 0);
        });
        
        console.log(`🤖 Initialized ${botTokens.length} bot token(s)`);
    }

    async getAvailableBot() {
        const now = Date.now();
        
        // Try each bot starting from current index
        for (let i = 0; i < this.botTokens.length; i++) {
            const botIndex = (this.currentBotIndex + i) % this.botTokens.length;
            const botToken = this.botTokens[botIndex];
            const usage = this.botUsage.get(botToken);
            
            // Reset counter if minute has passed
            if (now > usage.resetTime) {
                usage.requests = 0;
                usage.resetTime = now + 60000;
            }
            
            // Check if bot is available (under rate limit)
            if (usage.requests < CONFIG.MAX_REQUESTS_PER_BOT_PER_MINUTE) {
                // Ensure minimum delay between requests for this bot
                const lastRequest = this.lastRequestTime.get(botToken);
                const timeSinceLastRequest = now - lastRequest;
                
                if (timeSinceLastRequest >= CONFIG.RATE_LIMIT_DELAY) {
                    // Update usage and last request time
                    usage.requests++;
                    this.lastRequestTime.set(botToken, now);
                    this.currentBotIndex = botIndex;
                    
                    console.log(`Using bot ${botIndex + 1}/${this.botTokens.length} (${usage.requests}/${CONFIG.MAX_REQUESTS_PER_BOT_PER_MINUTE} requests)`);
                    return botToken;
                }
            }
        }
        
        // If no bot is immediately available, wait and try again
        console.log('⏳ All bots are rate limited, waiting...');
        await this.sleep(CONFIG.RATE_LIMIT_DELAY);
        return this.getAvailableBot();
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    getStats() {
        const stats = {};
        this.botTokens.forEach((token, index) => {
            const usage = this.botUsage.get(token);
            stats[`bot_${index + 1}`] = {
                requests_this_minute: usage.requests,
                limit: CONFIG.MAX_REQUESTS_PER_BOT_PER_MINUTE,
                reset_time: new Date(usage.resetTime).toISOString()
            };
        });
        return stats;
    }
}

class TelegramStreamsAddon {
    constructor() {
        this.addon = new addonBuilder(manifest);
        this.botManager = new BotManager(CONFIG.TELEGRAM_BOT_TOKENS);
        this.setupRoutes();
    }

    setupRoutes() {
        // Stream handler
        this.addon.defineStreamHandler(async ({ type, id }) => {
            try {
                console.log(`Looking for ${type} with ID: ${id}`);
                
                const streams = await this.searchStreams(id, type);
                return Promise.resolve({ streams });
            } catch (error) {
                console.error('Stream handler error:', error);
                return Promise.resolve({ streams: [] });
            }
        });
    }

    async searchStreams(imdbId, type) {
        const cacheKey = `${imdbId}-${type}`;
        
        // Check cache first
        if (cache.has(cacheKey)) {
            const cached = cache.get(cacheKey);
            if (Date.now() - cached.timestamp < CONFIG.CACHE_TTL) {
                console.log('Returning cached results');
                return cached.data;
            }
        }

        const streams = [];
        
        // Search through configured Telegram channels
        for (const channelId of CONFIG.TELEGRAM_CHANNELS) {
            try {
                const channelStreams = await this.searchChannel(channelId, imdbId, type);
                streams.push(...channelStreams);
            } catch (error) {
                console.error(`Error searching channel ${channelId}:`, error.message);
            }
        }

        // Cache results
        cache.set(cacheKey, {
            data: streams,
            timestamp: Date.now()
        });

        return streams;
    }

    async searchChannel(channelId, imdbId, type) {
        const streams = [];
        let offset = 0;
        const limit = 100;
        let hasMore = true;

        while (hasMore && offset < 500) { // Limit to prevent infinite loops
            try {
                const messages = await this.getChannelMessages(channelId, offset, limit);
                
                if (!messages || messages.length === 0) {
                    hasMore = false;
                    break;
                }

                for (const message of messages) {
                    const stream = await this.parseMessageForStream(message, imdbId, type);
                    if (stream) {
                        streams.push(stream);
                    }
                }

                offset += limit;
                
                // Rate limiting
                await this.sleep(100);
                
            } catch (error) {
                console.error(`Error fetching messages from channel ${channelId}:`, error.message);
                hasMore = false;
            }
        }

        return streams;
    }

    async getChannelMessages(channelId, offset = 0, limit = 100) {
        let attempts = 0;
        
        while (attempts < CONFIG.RETRY_ATTEMPTS) {
            try {
                const botToken = await this.botManager.getAvailableBot();
                
                const response = await axios.get(
                    `https://api.telegram.org/bot${botToken}/getUpdates`,
                    {
                        params: {
                            offset: offset,
                            limit: limit
                        },
                        timeout: 10000
                    }
                );

                const updates = response.data?.result || [];
                const messages = updates
                    .filter(update => update.channel_post && update.channel_post.chat.id.toString() === channelId)
                    .map(update => update.channel_post);

                return messages;
            } catch (error) {
                attempts++;
                
                if (error.response?.status === 429) {
                    const retryAfter = error.response.data?.parameters?.retry_after || CONFIG.RETRY_DELAY / 1000;
                    console.log(`⏳ Rate limit hit, waiting ${retryAfter}s before retry ${attempts}/${CONFIG.RETRY_ATTEMPTS}`);
                    await this.sleep(retryAfter * 1000);
                    continue;
                }
                
                if (attempts >= CONFIG.RETRY_ATTEMPTS) {
                    console.error('All attempts failed:', error.message);
                    return [];
                }
                
                console.log(`Attempt ${attempts} failed, retrying in ${CONFIG.RETRY_DELAY}ms...`);
                await this.sleep(CONFIG.RETRY_DELAY);
            }
        }
        
        return [];
    }

    async parseMessageForStream(message, targetImdbId, targetType) {
        if (!message.text && !message.caption) return null;

        const text = message.text || message.caption || '';
        
        // Look for IMDB IDs in the message
        const imdbMatch = text.match(/tt\d{7,}/g);
        if (!imdbMatch || !imdbMatch.includes(targetImdbId)) {
            return null;
        }

        // Look for video files or links
        let streamUrl = null;
        let quality = 'Unknown';
        let size = null;

        // Check for document/video attachment
        if (message.document) {
            // Get file info
            const fileId = message.document.file_id;
            streamUrl = await this.getTelegramFileUrl(fileId);
            size = this.formatFileSize(message.document.file_size);
            
            // Extract quality from filename
            const fileName = message.document.file_name || '';
            quality = this.extractQuality(fileName) || this.extractQuality(text);
        } else if (message.video) {
            const fileId = message.video.file_id;
            streamUrl = await this.getTelegramFileUrl(fileId);
            size = this.formatFileSize(message.video.file_size);
            quality = `${message.video.width}x${message.video.height}`;
        }

        // Look for external links in text
        if (!streamUrl) {
            const urlMatch = text.match(/(https?:\/\/[^\s]+)/g);
            if (urlMatch) {
                streamUrl = urlMatch[0];
                quality = this.extractQuality(text) || quality;
            }
        }

        if (!streamUrl) return null;

        // Create stream object
        const stream = {
            url: streamUrl,
            title: this.generateStreamTitle(text, quality, size),
            quality: quality,
            source: 'Telegram'
        };

        // Add additional metadata if available
        if (size) {
            stream.title += ` 💾 ${size}`;
        }

        return stream;
    }

    async getTelegramFileUrl(fileId) {
        let attempts = 0;
        
        while (attempts < CONFIG.RETRY_ATTEMPTS) {
            try {
                const botToken = await this.botManager.getAvailableBot();
                
                const response = await axios.get(
                    `https://api.telegram.org/bot${botToken}/getFile`,
                    {
                        params: { file_id: fileId },
                        timeout: 5000
                    }
                );

                const filePath = response.data?.result?.file_path;
                if (filePath) {
                    return `https://api.telegram.org/file/bot${botToken}/${filePath}`;
                }
                return null;
            } catch (error) {
                attempts++;
                
                if (error.response?.status === 429) {
                    const retryAfter = error.response.data?.parameters?.retry_after || CONFIG.RETRY_DELAY / 1000;
                    console.log(`⏳ File URL rate limit hit, waiting ${retryAfter}s`);
                    await this.sleep(retryAfter * 1000);
                    continue;
                }
                
                if (attempts >= CONFIG.RETRY_ATTEMPTS) {
                    console.error('Error getting Telegram file URL:', error.message);
                    return null;
                }
                
                await this.sleep(CONFIG.RETRY_DELAY);
            }
        }
        
        return null;
    }

    extractQuality(text) {
        const qualityPatterns = [
            /\b(\d{3,4}p)\b/i,           // 720p, 1080p, 4K
            /\b(4K|UHD)\b/i,            // 4K, UHD
            /\b(HD|SD)\b/i,             // HD, SD
            /\b(BluRay|BDRip)\b/i,      // BluRay
            /\b(WEB-?DL|WEBRip)\b/i,    // WEB-DL, WEBRip
            /\b(HDTV|HDCAM)\b/i,        // HDTV, HDCAM
        ];

        for (const pattern of qualityPatterns) {
            const match = text.match(pattern);
            if (match) {
                return match[1].toUpperCase();
            }
        }

        return null;
    }

    generateStreamTitle(text, quality, size) {
        // Try to extract movie/series title from text
        const lines = text.split('\n');
        let title = 'Telegram Stream';

        // Look for common title patterns
        for (const line of lines) {
            if (line.length > 5 && line.length < 100 && !line.startsWith('http')) {
                // Remove common prefixes and suffixes
                const cleaned = line
                    .replace(/^\W+|\W+$/g, '')
                    .replace(/\b(IMDB|tt\d+)\b/gi, '')
                    .trim();
                
                if (cleaned.length > 3) {
                    title = cleaned;
                    break;
                }
            }
        }

        return `📺 ${title} [${quality}]`;
    }

    formatFileSize(bytes) {
        if (!bytes) return null;
        
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let size = bytes;
        let unitIndex = 0;

        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }

        return `${size.toFixed(1)} ${units[unitIndex]}`;
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    getExpressApp() {
        const app = express();
        
        app.use(cors());
        app.use(express.json());

        // Keep-alive endpoint to prevent sleeping
        app.get('/ping', (req, res) => {
            res.json({ status: 'alive', timestamp: new Date().toISOString() });
        });

        // Root endpoint
        app.get('/', (req, res) => {
            res.redirect('/configure');
        });

        // Serve addon manifest
        app.get('/manifest.json', (req, res) => {
            res.json(manifest);
        });

        // Health check
        app.get('/health', (req, res) => {
            res.json({ 
                status: 'ok', 
                channels: CONFIG.TELEGRAM_CHANNELS.length,
                cache_size: cache.size,
                bots: CONFIG.TELEGRAM_BOT_TOKENS.length,
                bot_stats: this.botManager.getStats()
            });
        });

        // Configuration endpoint
        app.get('/configure', (req, res) => {
            const botStats = this.botManager.getStats();
            const botStatsHtml = Object.entries(botStats)
                .map(([botName, stats]) => 
                    `<li><strong>${botName}:</strong> ${stats.requests_this_minute}/${stats.limit} requests this minute</li>`
                )
                .join('');

            res.send(`
                <html>
                    <head>
                        <title>Telegram Streams Configuration</title>
                        <meta name="viewport" content="width=device-width, initial-scale=1">
                        <style>
                            body { 
                                font-family: Arial, sans-serif; 
                                max-width: 800px; 
                                margin: 0 auto; 
                                padding: 20px;
                                background: #f5f5f5;
                            }
                            .container {
                                background: white;
                                padding: 30px;
                                border-radius: 10px;
                                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                            }
                            h1 { color: #333; border-bottom: 2px solid #007bff; padding-bottom: 10px; }
                            h2, h3 { color: #555; }
                            .status { 
                                padding: 15px; 
                                border-radius: 5px; 
                                margin: 15px 0;
                                background: #d4edda;
                                border: 1px solid #c3e6cb;
                                color: #155724;
                            }
                            .error {
                                background: #f8d7da;
                                border: 1px solid #f5c6cb;
                                color: #721c24;
                            }
                            .manifest-url {
                                background: #e3f2fd;
                                padding: 15px;
                                border-radius: 5px;
                                margin: 15px 0;
                                border-left: 4px solid #2196f3;
                                font-family: monospace;
                                word-break: break-all;
                            }
                            ul { padding-left: 20px; }
                            li { margin: 5px 0; }
                            code { 
                                background: #f8f9fa; 
                                padding: 2px 5px; 
                                border-radius: 3px;
                                font-family: monospace;
                            }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <h1>🎬 Telegram Streams Addon</h1>
                            
                            <div class="status ${CONFIG.TELEGRAM_BOT_TOKENS.length === 0 ? 'error' : ''}">
                                <h2>📊 Current Status</h2>
                                <p><strong>Bot Tokens:</strong> ${CONFIG.TELEGRAM_BOT_TOKENS.length} configured</p>
                                <p><strong>Channels:</strong> ${CONFIG.TELEGRAM_CHANNELS.join(', ') || 'None configured'}</p>
                                <p><strong>Cache entries:</strong> ${cache.size}</p>
                                <p><strong>Rate Limit Delay:</strong> ${CONFIG.RATE_LIMIT_DELAY}ms</p>
                                <p><strong>Max Requests per Bot/Minute:</strong> ${CONFIG.MAX_REQUESTS_PER_BOT_PER_MINUTE}</p>
                            </div>
                            
                            <div class="manifest-url">
                                <h3>📱 Install in Stremio:</h3>
                                <p><strong>Manifest URL:</strong></p>
                                <p><code>${req.protocol}://${req.get('host')}/manifest.json</code></p>
                                <p><small>Copy this URL and paste it in Stremio → Addons → Install from URL</small></p>
                            </div>

                            <h3>🤖 Bot Usage Stats:</h3>
                            <ul>
                                ${botStatsHtml || '<li>No bot statistics available</li>'}
                            </ul>
                            
                            <h3>🔧 Setup Instructions:</h3>
                            <ol>
                                <li>Create multiple Telegram bots using @BotFather for better rate limits</li>
                                <li>Add all bots to your movie/series channels as admin</li>
                                <li>Set TELEGRAM_BOT_TOKENS environment variable (comma-separated)</li>
                                <li>Set TELEGRAM_CHANNELS environment variable (comma-separated channel IDs)</li>
                            </ol>
                            
                            <h3>⚡ Rate Limiting Features:</h3>
                            <ul>
                                <li>Uses multiple bots to distribute requests</li>
                                <li>Automatic retry with exponential backoff</li>
                                <li>Smart rate limit detection and handling</li>
                                <li>Current delay between requests: ${CONFIG.RATE_LIMIT_DELAY}ms</li>
                            </ul>

                            <h3>🔗 Test Endpoints:</h3>
                            <ul>
                                <li><a href="/health">/health</a> - Health check</li>
                                <li><a href="/manifest.json">/manifest.json</a> - Stremio manifest</li>
                                <li><a href="/ping">/ping</a> - Keep-alive ping</li>
                            </ul>
                        </div>

                        <script>
                            // Keep the service alive by pinging every 10 minutes
                            setInterval(() => {
                                fetch('/ping').catch(() => {});
                            }, 600000); // 10 minutes
                        </script>
                    </body>
                </html>
            `);
        });

        // Stream endpoints - multiple formats for compatibility
        const streamHandler = async (req, res) => {
            try {
                const { type, id } = req.params;
                console.log(`Stream request: ${type}/${id}`);
                
                // Remove .json extension if present
                const cleanId = id.replace('.json', '');
                
                const streams = await this.searchStreams(cleanId, type);
                console.log(`Found ${streams.length} streams for ${cleanId}`);
                
                res.json({ streams });
            } catch (error) {
                console.error('Stream endpoint error:', error);
                res.status(500).json({ streams: [], error: error.message });
            }
        };

        // Register stream endpoints in multiple formats
        app.get('/stream/:type/:id.json', streamHandler);
        app.get('/stream/:type/:id', streamHandler);
        app.get('/:type/:id.json', streamHandler);
        app.get('/:type/:id', streamHandler);

        // Try to use the addon SDK interface as fallback
        try {
            const addonInterface = this.addon.getInterface();
            if (addonInterface && typeof addonInterface === 'function') {
                app.use(addonInterface);
                console.log('✅ Stremio SDK interface loaded successfully');
            } else {
                console.log('⚠️ Stremio SDK interface not available, using manual endpoints');
            }
        } catch (error) {
            console.error('Error setting up addon interface:', error);
            console.log('🔄 Using fallback manual endpoints');
        }

        // Catch-all for debugging
        app.use((req, res, next) => {
            console.log(`📝 Request: ${req.method} ${req.path}`);
            next();
        });

        // 404 handler
        app.use((req, res) => {
            res.status(404).json({ 
                error: 'Not Found', 
                message: `Path ${req.path} not found`,
                availableEndpoints: [
                    '/manifest.json',
                    '/health',
                    '/configure',
                    '/stream/:type/:id',
                    '/ping'
                ]
            });
        });

        return app;
    }

    start() {
        try {
            const app = this.getExpressApp();
            
            app.listen(CONFIG.PORT, () => {
                console.log(`🚀 Telegram Streams Addon running on port ${CONFIG.PORT}`);
                console.log(`📺 Configured channels: ${CONFIG.TELEGRAM_CHANNELS.length}`);
                console.log(`🤖 Bot tokens: ${CONFIG.TELEGRAM_BOT_TOKENS.length}`);
                console.log(`⚡ Rate limit: ${CONFIG.MAX_REQUESTS_PER_BOT_PER_MINUTE} req/min per bot`);
                console.log(`⏱️  Delay between requests: ${CONFIG.RATE_LIMIT_DELAY}ms`);
                console.log(`🔗 Manifest URL: http://localhost:${CONFIG.PORT}/manifest.json`);
                console.log(`⚙️  Configuration: http://localhost:${CONFIG.PORT}/configure`);
            });
        } catch (error) {
            console.error('Error starting server:', error);
            throw error;
        }
    }
}

// Initialize and start the addon
let addon;

try {
    addon = new TelegramStreamsAddon();
} catch (error) {
    console.error('Error initializing addon:', error);
    process.exit(1);
}

// Export for testing or external usage
module.exports = { TelegramStreamsAddon, CONFIG };

// Start the server if this file is run directly
if (require.main === module) {
    try {
        addon.start();
    } catch (error) {
        console.error('Error starting addon:', error);
        process.exit(1);
    }
                }
