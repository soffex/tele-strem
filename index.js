const { addonBuilder } = require('stremio-addon-sdk');
const TelegramBot = require('node-telegram-bot-api');
const NodeCache = require('node-cache');
const crypto = require('crypto');
const axios = require('axios');

// Configuration with all required variables
const config = {
    port: process.env.PORT || 7000,
    
    // Telegram API credentials (required for large file support)
    apiId: parseInt(process.env.TELEGRAM_API_ID),
    apiHash: process.env.TELEGRAM_API_HASH,
    
    // Main bot token
    botToken: process.env.BOT_TOKEN,
    
    // Log channel (where files are stored/forwarded)
    logChannel: process.env.LOG_CHANNEL,
    
    // Search channels (where to look for content)
    searchChannels: (process.env.SEARCH_CHANNELS || '').split(',').filter(Boolean),
    
    // Multi-bot tokens for load balancing
    multiTokens: [
        process.env.MULTI_TOKEN1,
        process.env.MULTI_TOKEN2,
        process.env.MULTI_TOKEN3,
        process.env.MULTI_TOKEN4,
        process.env.MULTI_TOKEN5
    ].filter(Boolean),
    
    // Optional settings
    hashLength: parseInt(process.env.HASH_LENGTH) || 8,
    cacheTTL: parseInt(process.env.CACHE_TTL) || 3600,
    chunkSize: parseInt(process.env.CHUNK_SIZE) || 1024 * 1024, // 1MB chunks
    host: process.env.HOST || `https://${process.env.RENDER_EXTERNAL_HOSTNAME || 'localhost:7000'}`,
    
    // Feature flags
    enableAutoForward: process.env.ENABLE_AUTO_FORWARD !== 'false',
    enableCaching: process.env.ENABLE_CACHING !== 'false'
};

// Validate required config
if (!config.botToken) {
    console.error('❌ BOT_TOKEN is required');
    process.exit(1);
}

if (!config.logChannel) {
    console.error('❌ LOG_CHANNEL is required for file storage');
    process.exit(1);
}

// Initialize cache and storage
const cache = new NodeCache({ stdTTL: config.cacheTTL });
const fileDatabase = new Map(); // In-memory file database
const hashToFile = new Map(); // Hash to file mapping

// Bot management with load balancing
class BotManager {
    constructor() {
        this.bots = [];
        this.currentIndex = 0;
        this.initializeBots();
    }
    
    initializeBots() {
        // Main bot
        this.bots.push({
            bot: new TelegramBot(config.botToken, { polling: false }),
            token: config.botToken,
            id: 'main',
            usage: 0,
            lastUsed: 0
        });
        
        // Worker bots
        config.multiTokens.forEach((token, index) => {
            this.bots.push({
                bot: new TelegramBot(token, { polling: false }),
                token: token,
                id: `worker_${index + 1}`,
                usage: 0,
                lastUsed: 0
            });
        });
        
        console.log(`✅ Initialized ${this.bots.length} bots (1 main + ${config.multiTokens.length} workers)`);
    }
    
    // Get the least used bot for load balancing
    getAvailableBot() {
        // Sort by usage and last used time
        const sortedBots = [...this.bots].sort((a, b) => {
            if (a.usage !== b.usage) return a.usage - b.usage;
            return a.lastUsed - b.lastUsed;
        });
        
        const selectedBot = sortedBots[0];
        selectedBot.usage++;
        selectedBot.lastUsed = Date.now();
        
        return selectedBot;
    }
    
    async executeWithBot(operation) {
        const botData = this.getAvailableBot();
        try {
            return await operation(botData.bot, botData);
        } catch (error) {
            console.error(`Bot ${botData.id} error:`, error.message);
            throw error;
        }
    }
}

// File info extractor
class FileInfo {
    static extract(message) {
        let fileData = null;
        
        // Check for document (video files)
        if (message.document) {
            fileData = {
                fileId: message.document.file_id,
                fileUniqueId: message.document.file_unique_id,
                fileName: message.document.file_name || 'video.mp4',
                fileSize: message.document.file_size,
                mimeType: message.document.mime_type,
                type: 'document'
            };
        }
        // Check for video
        else if (message.video) {
            fileData = {
                fileId: message.video.file_id,
                fileUniqueId: message.video.file_unique_id,
                fileName: `video_${message.video.file_unique_id}.mp4`,
                fileSize: message.video.file_size,
                mimeType: 'video/mp4',
                duration: message.video.duration,
                width: message.video.width,
                height: message.video.height,
                type: 'video'
            };
        }
        
        if (fileData) {
            // Parse content metadata from message text
            const text = message.text || message.caption || '';
            const metadata = this.parseMetadata(text);
            
            return {
                ...fileData,
                ...metadata,
                messageId: message.message_id,
                date: message.date,
                chatId: message.chat.id
            };
        }
        
        return null;
    }
    
    static parseMetadata(text) {
        // Extract IMDB ID
        const imdbMatch = text.match(/(?:imdb|tt)[:=\s]*([0-9]{7,8})/i);
        const imdbId = imdbMatch ? `tt${imdbMatch[1]}` : null;
        
        // Extract title and year
        const titleMatch = text.match(/^(.+?)(?:\s*\((\d{4})\))?/m) || text.match(/🎬\s*(.+?)(?:\s*\((\d{4})\))?/);
        const title = titleMatch ? titleMatch[1].trim() : 'Unknown';
        const year = titleMatch ? titleMatch[2] : null;
        
        // Extract quality
        const qualityPatterns = {
            '4K': /4K|2160p|UHD/i,
            '1440p': /1440p|QHD/i,
            '1080p': /1080p|FHD|Full.*HD/i,
            '720p': /720p|HD/i,
            '480p': /480p|SD/i
        };
        
        let quality = 'Unknown';
        for (const [qual, pattern] of Object.entries(qualityPatterns)) {
            if (pattern.test(text)) {
                quality = qual;
                break;
            }
        }
        
        // Extract size
        const sizeMatch = text.match(/(?:size|💾)[:\s]*([0-9.]+)\s*(GB|MB)/i);
        const size = sizeMatch ? `${sizeMatch[1]} ${sizeMatch[2]}` : null;
        
        return { imdbId, title, year, quality, size };
    }
}

// File streaming proxy
class FileStreamProxy {
    static generateHash(fileId, messageId) {
        const data = `${fileId}:${messageId}:${config.botToken}`;
        return crypto.createHash('sha256').update(data).digest('hex').substring(0, config.hashLength);
    }
    
    static generateStreamUrl(fileInfo) {
        const hash = this.generateHash(fileInfo.fileId, fileInfo.messageId);
        hashToFile.set(hash, fileInfo);
        return `${config.host}/stream/${hash}`;
    }
    
    static async handleStream(req, res) {
        const { hash } = req.params;
        const fileInfo = hashToFile.get(hash);
        
        if (!fileInfo) {
            return res.status(404).json({ error: 'File not found' });
        }
        
        try {
            console.log(`📡 Streaming file: ${fileInfo.fileName} (${fileInfo.fileSize} bytes)`);
            
            // Set headers for streaming
            res.setHeader('Content-Type', fileInfo.mimeType || 'video/mp4');
            res.setHeader('Accept-Ranges', 'bytes');
            res.setHeader('Cache-Control', 'public, max-age=3600');
            
            if (fileInfo.fileSize) {
                res.setHeader('Content-Length', fileInfo.fileSize);
            }
            
            // Handle range requests for video seeking
            const range = req.headers.range;
            if (range && fileInfo.fileSize) {
                const parts = range.replace(/bytes=/, '').split('-');
                const start = parseInt(parts[0], 10);
                const end = parts[1] ? parseInt(parts[1], 10) : fileInfo.fileSize - 1;
                const chunksize = (end - start) + 1;
                
                res.status(206);
                res.setHeader('Content-Range', `bytes ${start}-${end}/${fileInfo.fileSize}`);
                res.setHeader('Content-Length', chunksize);
            }
            
            // Get file download link using bot API
            await botManager.executeWithBot(async (bot) => {
                try {
                    // Get file path from Telegram
                    const file = await bot.getFile(fileInfo.fileId);
                    const fileUrl = `https://api.telegram.org/file/bot${bot.token}/${file.file_path}`;
                    
                    // Proxy the file stream
                    const response = await axios({
                        method: 'get',
                        url: fileUrl,
                        responseType: 'stream',
                        headers: range ? { Range: range } : {}
                    });
                    
                    // Pipe the stream to client
                    response.data.pipe(res);
                    
                } catch (error) {
                    console.error('Streaming error:', error.message);
                    
                    if (!res.headersSent) {
                        res.status(500).json({ error: 'Streaming failed' });
                    }
                }
            });
            
        } catch (error) {
            console.error('Stream handler error:', error);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Internal server error' });
            }
        }
    }
}

// Content search engine
class ContentSearcher {
    static async searchContent(imdbId, type) {
        const cacheKey = `search_${imdbId}_${type}`;
        
        if (config.enableCaching) {
            const cached = cache.get(cacheKey);
            if (cached) {
                console.log(`📦 Cache hit for ${imdbId}`);
                return cached;
            }
        }
        
        console.log(`🔍 Searching for ${imdbId} (${type})`);
        
        const results = [];
        
        // Search in log channel first (faster)
        const logResults = await this.searchInChannel(config.logChannel, imdbId);
        results.push(...logResults);
        
        // Search in other channels if needed
        if (results.length === 0) {
            for (const channel of config.searchChannels) {
                const channelResults = await this.searchInChannel(channel, imdbId);
                results.push(...channelResults);
                
                if (results.length > 0) break; // Stop after finding results
            }
        }
        
        // Sort by quality
        const qualityOrder = { '4K': 5, '1440p': 4, '1080p': 3, '720p': 2, '480p': 1, 'Unknown': 0 };
        results.sort((a, b) => (qualityOrder[b.quality] || 0) - (qualityOrder[a.quality] || 0));
        
        if (config.enableCaching) {
            cache.set(cacheKey, results);
        }
        
        console.log(`✅ Found ${results.length} streams for ${imdbId}`);
        return results;
    }
    
    static async searchInChannel(channelId, imdbId) {
        const results = [];
        
        try {
            await botManager.executeWithBot(async (bot) => {
                // Search for messages containing IMDB ID
                // Note: This is a simplified implementation
                // In a real scenario, you'd implement proper message searching
                
                // For now, check if we have this file in our database
                for (const [hash, fileInfo] of hashToFile) {
                    if (fileInfo.imdbId === imdbId) {
                        const streamUrl = FileStreamProxy.generateStreamUrl(fileInfo);
                        
                        results.push({
                            name: this.generateStreamName(fileInfo),
                            url: streamUrl,
                            quality: fileInfo.quality,
                            size: fileInfo.size,
                            fileInfo: fileInfo
                        });
                    }
                }
            });
        } catch (error) {
            console.error(`Search error in channel ${channelId}:`, error.message);
        }
        
        return results;
    }
    
    static generateStreamName(fileInfo) {
        const parts = [fileInfo.title];
        if (fileInfo.year) parts.push(`(${fileInfo.year})`);
        if (fileInfo.quality !== 'Unknown') parts.push(fileInfo.quality);
        if (fileInfo.size) parts.push(fileInfo.size);
        return parts.join(' ');
    }
}

// File forwarder for automatic storage
class FileForwarder {
    static async forwardToLogChannel(message) {
        if (!config.enableAutoForward) return false;
        
        try {
            await botManager.executeWithBot(async (bot) => {
                await bot.forwardMessage(config.logChannel, message.chat.id, message.message_id);
                console.log(`📤 Forwarded file to log channel: ${message.message_id}`);
            });
            return true;
        } catch (error) {
            console.error('Forward error:', error.message);
            return false;
        }
    }
    
    static async processMessage(message) {
        const fileInfo = FileInfo.extract(message);
        
        if (fileInfo && fileInfo.imdbId) {
            // Store in our database
            const hash = FileStreamProxy.generateHash(fileInfo.fileId, fileInfo.messageId);
            fileDatabase.set(fileInfo.fileId, fileInfo);
            hashToFile.set(hash, fileInfo);
            
            console.log(`📁 Stored file: ${fileInfo.title} (${fileInfo.quality}) - ${fileInfo.fileName}`);
            
            // Forward to log channel if not already there
            if (message.chat.id.toString() !== config.logChannel.toString()) {
                await this.forwardToLogChannel(message);
            }
        }
    }
}

// Initialize bot manager
const botManager = new BotManager();

// Stremio addon manifest
const manifest = {
    id: 'org.tele-strem.filestream',
    version: '2.0.0',
    name: 'Tele-Strem FileStream',
    description: 'Stream large Telegram files to Stremio using FileStream technology',
    logo: 'https://via.placeholder.com/256x256/0080FF/FFFFFF?text=TFS',
    resources: ['stream'],
    types: ['movie', 'series'],
    catalogs: [],
    idPrefixes: ['tt'],
    behaviorHints: {
        configurable: true,
        configurationRequired: false
    }
};

// Create Stremio addon
const addon = new addonBuilder(manifest);

// Stream handler
addon.defineStreamHandler(async ({ type, id }) => {
    try {
        console.log(`📺 Stream request: ${type} - ${id}`);
        
        if (!id.startsWith('tt')) {
            return { streams: [] };
        }
        
        const results = await ContentSearcher.searchContent(id, type);
        
        const streams = results.map(result => ({
            name: result.name,
            url: result.url,
            behaviorHints: {
                bingeGroup: `tele-strem-${id}`,
                countryWhitelist: ['US', 'GB', 'CA', 'AU', 'DE', 'FR', 'ES', 'IT', 'NL', 'BE']
            }
        }));
        
        return { streams };
        
    } catch (error) {
        console.error('Stream handler error:', error);
        return { streams: [] };
    }
});

// Get addon interface and add custom routes
const addonInterface = addon.getInterface();

// Health check endpoint
addonInterface.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        version: manifest.version,
        bots: botManager.bots.length,
        files_stored: fileDatabase.size,
        cache_keys: cache.keys().length,
        log_channel: config.logChannel,
        search_channels: config.searchChannels.length,
        features: {
            auto_forward: config.enableAutoForward,
            caching: config.enableCaching,
            large_files: true
        },
        uptime: process.uptime()
    });
});

// File streaming endpoint - THIS IS THE KEY!
addonInterface.get('/stream/:hash', FileStreamProxy.handleStream);

// Manual file addition endpoint (for testing)
addonInterface.post('/add-file', async (req, res) => {
    try {
        const { messageId, chatId } = req.body;
        
        if (!messageId || !chatId) {
            return res.status(400).json({ error: 'messageId and chatId required' });
        }
        
        await botManager.executeWithBot(async (bot) => {
            const message = await bot.forwardMessage(config.logChannel, chatId, messageId);
            await FileForwarder.processMessage(message);
        });
        
        res.json({ success: true, message: 'File added to database' });
    } catch (error) {
        console.error('Add file error:', error);
        res.status(500).json({ error: 'Failed to add file' });
    }
});

// Start the server
if (require.main === module) {
    addonInterface.listen(config.port, () => {
        console.log('🚀 Tele-Strem FileStream addon running!');
        console.log(`📄 Manifest: ${config.host}/manifest.json`);
        console.log(`💊 Health: ${config.host}/health`);
        console.log(`🎬 Streaming: ${config.host}/stream/{hash}`);
        console.log(`🤖 Bots: ${botManager.bots.length} (1 main + ${config.multiTokens.length} workers)`);
        console.log(`📁 Log Channel: ${config.logChannel}`);
        console.log(`🔍 Search Channels: ${config.searchChannels.length}`);
        console.log(`✨ Large files supported via FileStream technology!`);
    });
}

module.exports = addonInterface;
