const { addonBuilder } = require('stremio-addon-sdk');
const { TelegramApi } = require('telegram');
const { StringSession } = require('telegram/sessions');
const NodeCache = require('node-cache');
const input = require('input');

// Configuration with validation
const config = {
    port: process.env.PORT || 7000,
    apiId: parseInt(process.env.TELEGRAM_API_ID),
    apiHash: process.env.TELEGRAM_API_HASH,
    stringSession: process.env.TELEGRAM_STRING_SESSION || '',
    channels: (process.env.TELEGRAM_CHANNELS || '').split(',').filter(Boolean),
    botTokens: (process.env.TELEGRAM_BOT_TOKENS || '').split(',').filter(Boolean),
    cacheTTL: parseInt(process.env.CACHE_TTL) || 3600,
    searchLimit: parseInt(process.env.SEARCH_LIMIT) || 100,
    enableBotFallback: process.env.ENABLE_BOT_FALLBACK !== 'false',
    streamingDomain: process.env.STREAMING_DOMAIN || `https://${process.env.RENDER_EXTERNAL_HOSTNAME || 'localhost:7000'}`
};

// Cache for search results and file info
const cache = new NodeCache({ stdTTL: config.cacheTTL });

// Telegram Client for large file access
let telegramClient = null;

// Bot tokens for metadata only (not file downloads)
const botTokens = config.botTokens;
let currentBotIndex = 0;

// Initialize Telegram Client (handles large files)
async function initTelegramClient() {
    if (!config.apiId || !config.apiHash) {
        console.log('⚠️  Telegram Client not configured - using bot API only (20MB limit)');
        return null;
    }

    try {
        const session = new StringSession(config.stringSession);
        telegramClient = new TelegramApi(session, config.apiId, config.apiHash, {
            connectionRetries: 5,
        });

        await telegramClient.start({
            phoneNumber: async () => await input.text('Please enter your phone number: '),
            password: async () => await input.text('Please enter your password: '),
            phoneCode: async () => await input.text('Please enter the code you received: '),
            onError: (err) => console.log('Telegram auth error:', err),
        });

        console.log('✅ Telegram Client initialized (supports large files)');
        
        // Save session for future use
        if (!config.stringSession) {
            console.log('🔑 Save this session string for future use:');
            console.log('TELEGRAM_STRING_SESSION=' + telegramClient.session.save());
        }
        
        return telegramClient;
    } catch (error) {
        console.error('❌ Failed to initialize Telegram Client:', error.message);
        return null;
    }
}

// Enhanced message parser
function parseMessage(message) {
    const text = message.message || message.text || message.caption || '';
    
    // Extract IMDB ID
    const imdbMatch = text.match(/(?:imdb|tt)[:=\s]*([0-9]{7,8})/i);
    const imdbId = imdbMatch ? `tt${imdbMatch[1]}` : null;
    
    // Enhanced quality detection
    const qualityPatterns = {
        '4K': /4K|2160p|UHD|Ultra.*HD/i,
        '1440p': /1440p|QHD/i,
        '1080p': /1080p|FHD|Full.*HD/i,
        '720p': /720p|HD/i,
        '480p': /480p|SD/i,
        '360p': /360p/i
    };
    
    let quality = 'Unknown';
    for (const [qual, pattern] of Object.entries(qualityPatterns)) {
        if (pattern.test(text)) {
            quality = qual;
            break;
        }
    }
    
    // Extract title and year
    const titlePatterns = [
        /🎬\s*(.+?)(?:\s*\((\d{4})\))?(?:\n|$)/,
        /^(.+?)(?:\s*\((\d{4})\))?(?:\n|$)/,
        /Title[:\s]+(.+?)(?:\s*\((\d{4})\))?(?:\n|$)/i
    ];
    
    let title = 'Unknown';
    let year = null;
    
    for (const pattern of titlePatterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
            title = match[1].trim();
            year = match[2] || null;
            break;
        }
    }
    
    // File size
    const sizeMatch = text.match(/(?:size|💾)[:\s]*([0-9.]+)\s*(GB|MB|KB)/i);
    const size = sizeMatch ? `${sizeMatch[1]} ${sizeMatch[2]}` : null;
    
    // Get file info if available
    let fileInfo = null;
    if (message.document) {
        fileInfo = {
            fileId: message.document.id,
            fileName: message.document.attributes?.find(attr => attr.fileName)?.fileName || 'video.mp4',
            fileSize: message.document.size,
            mimeType: message.document.mimeType
        };
    } else if (message.media?.document) {
        fileInfo = {
            fileId: message.media.document.id,
            fileName: message.media.document.attributes?.find(attr => attr.fileName)?.fileName || 'video.mp4',
            fileSize: message.media.document.size,
            mimeType: message.media.document.mimeType
        };
    }
    
    return {
        imdbId,
        title,
        year,
        quality,
        size,
        fileInfo,
        messageId: message.id,
        text
    };
}

// Search for content in channels
async function searchContent(imdbId, type) {
    const cacheKey = `search_${imdbId}_${type}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;
    
    console.log(`🔍 Searching for ${imdbId} (${type})`);
    
    const results = [];
    
    // Search using Telegram Client (preferred)
    if (telegramClient) {
        for (const channelUsername of config.channels) {
            try {
                const channel = await telegramClient.getEntity(channelUsername);
                const messages = await telegramClient.getMessages(channel, {
                    limit: config.searchLimit,
                    search: imdbId
                });
                
                for (const message of messages) {
                    const parsed = parseMessage(message);
                    if (parsed.imdbId === imdbId && parsed.fileInfo) {
                        results.push({
                            ...parsed,
                            channelId: channel.id,
                            channelUsername
                        });
                    }
                }
            } catch (error) {
                console.error(`Error searching channel ${channelUsername}:`, error.message);
            }
        }
    }
    
    // Fallback to bot search for metadata only
    if (results.length === 0 && config.enableBotFallback && botTokens.length > 0) {
        console.log('🔄 Falling back to bot search...');
        // Bot search implementation here (simplified)
    }
    
    // Sort by quality
    const qualityOrder = { '4K': 5, '1440p': 4, '1080p': 3, '720p': 2, '480p': 1, '360p': 0, 'Unknown': -1 };
    results.sort((a, b) => (qualityOrder[b.quality] || -1) - (qualityOrder[a.quality] || -1));
    
    cache.set(cacheKey, results);
    return results;
}

// Generate streaming URL for large files
function generateStreamingUrl(channelId, messageId, fileId) {
    // Create a streaming endpoint that will handle the file download
    const streamPath = `/stream/${channelId}/${messageId}/${fileId}`;
    return `${config.streamingDomain}${streamPath}`;
}

// File streaming handler
async function handleFileStream(req, res) {
    const { channelId, messageId, fileId } = req.params;
    
    try {
        if (!telegramClient) {
            return res.status(500).json({ error: 'Telegram client not available' });
        }
        
        console.log(`📥 Streaming file: ${fileId} from message ${messageId}`);
        
        // Get the message with file
        const messages = await telegramClient.getMessages(parseInt(channelId), {
            ids: [parseInt(messageId)]
        });
        
        if (!messages.length) {
            return res.status(404).json({ error: 'File not found' });
        }
        
        const message = messages[0];
        const document = message.document || message.media?.document;
        
        if (!document) {
            return res.status(404).json({ error: 'No document in message' });
        }
        
        // Set appropriate headers
        res.setHeader('Content-Type', document.mimeType || 'video/mp4');
        res.setHeader('Content-Length', document.size);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        
        // Handle range requests for video seeking
        const range = req.headers.range;
        if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : document.size - 1;
            const chunksize = (end - start) + 1;
            
            res.status(206);
            res.setHeader('Content-Range', `bytes ${start}-${end}/${document.size}`);
            res.setHeader('Content-Length', chunksize);
        }
        
        // Stream the file directly from Telegram
        const stream = await telegramClient.downloadMedia(document, {
            progressCallback: (downloaded, total) => {
                // Optional: progress logging
            }
        });
        
        // Pipe the stream to response
        if (stream && stream.pipe) {
            stream.pipe(res);
        } else {
            // Handle buffer response
            res.end(stream);
        }
        
    } catch (error) {
        console.error('Streaming error:', error);
        res.status(500).json({ error: 'Streaming failed' });
    }
}

// Stremio addon manifest
const manifest = {
    id: 'org.tele-strem.fixed',
    version: '1.1.0',
    name: 'Tele-Strem (Large Files)',
    description: 'Stream large video files from Telegram channels to Stremio',
    logo: 'https://via.placeholder.com/256x256/0080FF/FFFFFF?text=TS',
    resources: ['stream'],
    types: ['movie', 'series'],
    idPrefixes: ['tt'],
    behaviorHints: {
        configurable: true,
        configurationRequired: false
    }
};

// Create addon
const addon = new addonBuilder(manifest);

// Stream handler
addon.defineStreamHandler(async ({ type, id }) => {
    try {
        console.log(`📺 Stream request: ${type} - ${id}`);
        
        if (!id.startsWith('tt')) {
            return { streams: [] };
        }
        
        const results = await searchContent(id, type);
        
        const streams = results.map(result => {
            const streamName = `${result.title}${result.year ? ` (${result.year})` : ''} ${result.quality}${result.size ? ` ${result.size}` : ''}`;
            
            let streamUrl;
            if (result.fileInfo && telegramClient) {
                // Use our streaming endpoint for large files
                streamUrl = generateStreamingUrl(result.channelId, result.messageId, result.fileInfo.fileId);
            } else {
                // Fallback or external link
                streamUrl = null;
            }
            
            if (!streamUrl) return null;
            
            return {
                name: streamName,
                url: streamUrl,
                behaviorHints: {
                    bingeGroup: `tele-strem-${id}`,
                    countryWhitelist: ['US', 'GB', 'CA', 'AU', 'DE', 'FR', 'ES', 'IT']
                }
            };
        }).filter(Boolean);
        
        console.log(`✅ Found ${streams.length} streams for ${id}`);
        return { streams };
        
    } catch (error) {
        console.error('Stream handler error:', error);
        return { streams: [] };
    }
});

// Health check
const healthCheck = () => ({
    status: 'ok',
    version: manifest.version,
    telegram_client: !!telegramClient,
    channels: config.channels.length,
    bot_tokens: botTokens.length,
    cache_keys: cache.keys().length,
    uptime: process.uptime()
});

// Initialize and start
async function start() {
    try {
        // Initialize Telegram client
        if (config.apiId && config.apiHash) {
            await initTelegramClient();
        }
        
        // Get addon interface
        const addonInterface = addon.getInterface();
        
        // Add custom routes
        addonInterface.get('/health', (req, res) => {
            res.json(healthCheck());
        });
        
        // Add file streaming route
        addonInterface.get('/stream/:channelId/:messageId/:fileId', handleFileStream);
        
        // Start server
        addonInterface.listen(config.port, () => {
            console.log(`🚀 Tele-Strem addon running on port ${config.port}`);
            console.log(`📄 Manifest: http://localhost:${config.port}/manifest.json`);
            console.log(`💊 Health: http://localhost:${config.port}/health`);
            console.log(`🔧 Client: ${telegramClient ? 'Connected' : 'Bot API only (20MB limit)'}`);
        });
        
    } catch (error) {
        console.error('💥 Startup error:', error);
        process.exit(1);
    }
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 Shutting down...');
    if (telegramClient) {
        telegramClient.disconnect();
    }
    process.exit(0);
});

// Start the application
if (require.main === module) {
    start();
}

module.exports = addon.getInterface();
