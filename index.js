const { addonBuilder } = require('stremio-addon-sdk');
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');

// Addon manifest with catalogs
const manifest = {
    id: 'org.telegram.stream',
    version: '3.0.0',
    name: 'Telegram Stream Server',
    description: 'Stream your Telegram media files directly in Stremio',
    resources: ['catalog', 'stream', 'meta'],
    types: ['movie', 'series'],
    idPrefixes: ['tg'],
    catalogs: [
        {
            type: 'movie',
            id: 'telegram-movies',
            name: 'My Movies',
            extra: [
                { name: 'search', isRequired: false },
                { name: 'genre', isRequired: false, options: ['Action', 'Comedy', 'Drama', 'Horror', 'Sci-Fi', 'Thriller', 'Adventure', 'Crime'] }
            ]
        },
        {
            type: 'series',
            id: 'telegram-series',
            name: 'My Series',
            extra: [
                { name: 'search', isRequired: false },
                { name: 'genre', isRequired: false, options: ['Action', 'Comedy', 'Drama', 'Crime', 'Sci-Fi', 'Thriller'] }
            ]
        }
    ]
};

// Configuration
const CONFIG = {
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
    TELEGRAM_CHANNELS: (process.env.TELEGRAM_CHANNELS || '').split(',').filter(Boolean),
    PORT: process.env.PORT || 3000,
    CACHE_TTL: 3600000, // 1 hour
    STREAM_BUFFER_SIZE: 1024 * 1024, // 1MB chunks
    MAX_FILE_SIZE: 2000 * 1024 * 1024, // 2GB (Telegram limit)
};

// Content database
let contentDatabase = {
    movies: new Map(),
    series: new Map(),
    fileCache: new Map() // Cache for Telegram file info
};

// Cache for responses
const cache = new Map();

class TelegramStreamServer {
    constructor() {
        this.addon = new addonBuilder(manifest);
        this.setupRoutes();
        this.loadContentFromChannels();
    }

    setupRoutes() {
        // Catalog handler
        this.addon.defineCatalogHandler(({ type, id, extra }) => {
            console.log(`📋 Catalog request: ${type}/${id}`, extra);
            return this.getCatalog(type, id, extra);
        });

        // Stream handler
        this.addon.defineStreamHandler(({ type, id }) => {
            console.log(`🎬 Stream request: ${type}/${id}`);
            return this.getStreams(type, id);
        });

        // Meta handler
        this.addon.defineMetaHandler(({ type, id }) => {
            console.log(`📊 Meta request: ${type}/${id}`);
            return this.getMeta(type, id);
        });
    }

    async loadContentFromChannels() {
        if (!CONFIG.TELEGRAM_BOT_TOKEN) {
            console.log('⚠️ No bot token provided, loading sample content...');
            this.loadSampleContent();
            return;
        }

        console.log('🔄 Loading content from Telegram channels...');
        
        for (const channelId of CONFIG.TELEGRAM_CHANNELS) {
            try {
                await this.scanChannel(channelId);
            } catch (error) {
                console.error(`❌ Error scanning channel ${channelId}:`, error.message);
            }
        }

        console.log(`✅ Loaded ${contentDatabase.movies.size} movies and ${contentDatabase.series.size} series from Telegram`);
    }

    async scanChannel(channelId) {
        let offset = 0;
        const limit = 100;
        let messageCount = 0;

        while (messageCount < 500) { // Limit to prevent infinite loops
            try {
                const messages = await this.getChannelMessages(channelId, offset, limit);
                
                if (!messages || messages.length === 0) break;

                for (const message of messages) {
                    await this.processMessage(message, channelId);
                }

                offset += limit;
                messageCount += messages.length;
                
                // Rate limiting
                await this.sleep(1000);
                
            } catch (error) {
                console.error(`Error fetching messages from ${channelId}:`, error.message);
                break;
            }
        }
    }

    async getChannelMessages(channelId, offset = 0, limit = 100) {
        try {
            // Try to get chat history (may not work for all channels)
            const response = await axios.get(
                `https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/getUpdates`,
                {
                    params: { offset, limit },
                    timeout: 10000
                }
            );

            const updates = response.data?.result || [];
            return updates
                .filter(update => 
                    update.channel_post && 
                    update.channel_post.chat.id.toString() === channelId.toString()
                )
                .map(update => update.channel_post);

        } catch (error) {
            console.error('Error getting channel messages:', error.message);
            return [];
        }
    }

    async processMessage(message, channelId) {
        try {
            // Look for video files
            const video = message.video || message.document;
            if (!video) return;

            // Only process video files
            const fileName = video.file_name || '';
            const isVideo = video.mime_type?.startsWith('video/') || 
                           fileName.match(/\.(mp4|mkv|avi|mov|wmv|flv|webm)$/i);
            
            if (!isVideo) return;

            // Extract metadata from message text
            const text = message.text || message.caption || '';
            const metadata = this.extractMetadata(text, fileName);
            
            if (!metadata.title) return; // Skip if no title found

            // Create content entry
            const content = {
                id: `tg:${metadata.type}:${message.message_id}`,
                type: metadata.type,
                name: metadata.title,
                year: metadata.year,
                poster: metadata.poster,
                background: metadata.background,
                description: metadata.description,
                genre: metadata.genre,
                director: metadata.director,
                cast: metadata.cast,
                runtime: metadata.runtime,
                imdb_id: metadata.imdb_id,
                telegramFile: {
                    fileId: video.file_id,
                    fileName: fileName,
                    fileSize: video.file_size,
                    mimeType: video.mime_type,
                    channelId: channelId,
                    messageId: message.message_id
                }
            };

            // Add to appropriate database
            if (metadata.type === 'movie') {
                contentDatabase.movies.set(content.id, content);
            } else {
                contentDatabase.series.set(content.id, content);
            }

            console.log(`➕ Added ${metadata.type}: ${metadata.title}`);

        } catch (error) {
            console.error('Error processing message:', error.message);
        }
    }

    extractMetadata(text, fileName) {
        const metadata = {
            type: 'movie',
            title: '',
            year: '',
            poster: '',
            background: '',
            description: '',
            genre: [],
            director: [],
            cast: [],
            runtime: '',
            imdb_id: ''
        };

        // Extract title from text or filename
        const lines = text.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.length > 3 && trimmed.length < 100 && !trimmed.startsWith('http')) {
                // Remove common prefixes and clean up
                const cleaned = trimmed
                    .replace(/^[🎬📺🎭🎪🎨🎯🔥⭐🌟✨💫🎊🎉📀💿📱📺🎥🎦📹🎬]+\s*/, '')
                    .replace(/\[.*?\]/g, '')
                    .replace(/\(.*?p\)/gi, '')
                    .replace(/\b(bluray|webrip|hdtv|bdrip|dvdrip|cam|ts|tc)\b/gi, '')
                    .trim();
                
                if (cleaned.length > 3) {
                    metadata.title = cleaned;
                    break;
                }
            }
        }

        // Fallback to filename if no title found
        if (!metadata.title) {
            metadata.title = fileName
                .replace(/\.[^.]+$/, '') // Remove extension
                .replace(/[._-]/g, ' ')   // Replace separators
                .replace(/\b(bluray|webrip|hdtv|bdrip|dvdrip|cam|ts|tc|1080p|720p|480p)\b/gi, '')
                .trim();
        }

        // Extract year
        const yearMatch = (text + ' ' + fileName).match(/\b(19|20)\d{2}\b/);
        if (yearMatch) {
            metadata.year = yearMatch[0];
        }

        // Extract IMDB ID
        const imdbMatch = text.match(/\b(tt\d{7,})\b/i);
        if (imdbMatch) {
            metadata.imdb_id = imdbMatch[1];
        }

        // Detect series vs movie
        if (text.match(/\b(S\d+E\d+|Season|Episode|series)\b/i) || 
            fileName.match(/\b(S\d+E\d+|Season|Episode)\b/i)) {
            metadata.type = 'series';
        }

        // Extract quality and add to description
        const qualityMatch = (text + ' ' + fileName).match(/\b(\d{3,4}p|4K|UHD|HD|SD)\b/i);
        if (qualityMatch) {
            metadata.description = `Quality: ${qualityMatch[1]}`;
        }

        // Extract genre from text
        const genreKeywords = {
            'action': 'Action',
            'comedy': 'Comedy', 
            'drama': 'Drama',
            'horror': 'Horror',
            'thriller': 'Thriller',
            'sci-fi': 'Sci-Fi',
            'romance': 'Romance',
            'adventure': 'Adventure',
            'crime': 'Crime'
        };

        const lowerText = text.toLowerCase();
        Object.entries(genreKeywords).forEach(([keyword, genre]) => {
            if (lowerText.includes(keyword)) {
                metadata.genre.push(genre);
            }
        });

        // Default poster (you can enhance this with TMDB API later)
        metadata.poster = `https://via.placeholder.com/300x450/1a1a2e/fff?text=${encodeURIComponent(metadata.title)}`;
        metadata.background = metadata.poster;

        return metadata;
    }

    // Telegram file streaming proxy
    async streamTelegramFile(fileId, range, res) {
        try {
            // Get file info from Telegram
            const fileInfo = await this.getTelegramFileInfo(fileId);
            if (!fileInfo) {
                return res.status(404).send('File not found');
            }

            const fileUrl = `https://api.telegram.org/file/bot${CONFIG.TELEGRAM_BOT_TOKEN}/${fileInfo.file_path}`;
            
            // Handle range requests for video streaming
            const headers = {
                'Content-Type': 'video/mp4',
                'Accept-Ranges': 'bytes',
                'Cache-Control': 'no-cache'
            };

            if (range) {
                const parts = range.replace(/bytes=/, "").split("-");
                const start = parseInt(parts[0], 10);
                const end = parts[1] ? parseInt(parts[1], 10) : fileInfo.file_size - 1;
                const chunksize = (end - start) + 1;

                headers['Content-Range'] = `bytes ${start}-${end}/${fileInfo.file_size}`;
                headers['Content-Length'] = chunksize;
                
                res.writeHead(206, headers);

                // Stream the file chunk
                const response = await axios.get(fileUrl, {
                    headers: { Range: `bytes=${start}-${end}` },
                    responseType: 'stream'
                });

                response.data.pipe(res);
            } else {
                headers['Content-Length'] = fileInfo.file_size;
                res.writeHead(200, headers);

                // Stream the entire file
                const response = await axios.get(fileUrl, {
                    responseType: 'stream'
                });

                response.data.pipe(res);
            }

        } catch (error) {
            console.error('Streaming error:', error.message);
            res.status(500).send('Streaming error');
        }
    }

    async getTelegramFileInfo(fileId) {
        try {
            // Check cache first
            if (contentDatabase.fileCache.has(fileId)) {
                const cached = contentDatabase.fileCache.get(fileId);
                if (Date.now() - cached.timestamp < CONFIG.CACHE_TTL) {
                    return cached.data;
                }
            }

            const response = await axios.get(
                `https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/getFile`,
                { params: { file_id: fileId } }
            );

            const fileInfo = response.data.result;
            
            // Cache the result
            contentDatabase.fileCache.set(fileId, {
                data: fileInfo,
                timestamp: Date.now()
            });

            return fileInfo;

        } catch (error) {
            console.error('Error getting file info:', error.message);
            return null;
        }
    }

    async getCatalog(type, id, extra = {}) {
        try {
            const cacheKey = `catalog:${type}:${id}:${JSON.stringify(extra)}`;
            
            // Check cache
            if (cache.has(cacheKey)) {
                const cached = cache.get(cacheKey);
                if (Date.now() - cached.timestamp < CONFIG.CACHE_TTL) {
                    return cached.data;
                }
            }

            let items = [];
            const database = type === 'movie' ? contentDatabase.movies : contentDatabase.series;
            const allItems = Array.from(database.values());

            // Apply search filter
            if (extra.search) {
                const searchTerm = extra.search.toLowerCase();
                items = allItems.filter(item => 
                    item.name.toLowerCase().includes(searchTerm) ||
                    (item.description && item.description.toLowerCase().includes(searchTerm))
                );
            } else {
                items = allItems;
            }

            // Apply genre filter
            if (extra.genre) {
                items = items.filter(item => 
                    item.genre && item.genre.includes(extra.genre)
                );
            }

            // Sort by name
            items.sort((a, b) => a.name.localeCompare(b.name));

            // Format for Stremio
            const metas = items.map(item => ({
                id: item.id,
                type: item.type,
                name: item.name,
                poster: item.poster,
                background: item.background,
                year: item.year,
                imdb_id: item.imdb_id,
                description: item.description,
                genre: item.genre,
                director: item.director,
                cast: item.cast,
                runtime: item.runtime
            }));

            const result = { metas };

            // Cache result
            cache.set(cacheKey, {
                data: result,
                timestamp: Date.now()
            });

            console.log(`📋 Returning ${metas.length} ${type}s for catalog ${id}`);
            return Promise.resolve(result);

        } catch (error) {
            console.error('Catalog error:', error);
            return Promise.resolve({ metas: [] });
        }
    }

    async getStreams(type, id) {
        try {
            console.log(`🎬 Looking for streams: ${type}/${id}`);

            const database = type === 'movie' ? contentDatabase.movies : contentDatabase.series;
            const content = database.get(id);

            if (!content || !content.telegramFile) {
                console.log(`❌ No content found for ${id}`);
                return Promise.resolve({ streams: [] });
            }

            const fileInfo = content.telegramFile;
            const streamUrl = `${this.getBaseUrl()}/stream/${fileInfo.fileId}`;
            
            const qualityInfo = this.extractQualityFromFile(fileInfo.fileName);
            const sizeInfo = fileInfo.fileSize ? this.formatFileSize(fileInfo.fileSize) : '';

            const stream = {
                title: `📺 ${content.name} [${qualityInfo}] ${sizeInfo ? '💾 ' + sizeInfo : ''}`,
                url: streamUrl,
                behaviorHints: {
                    notWebReady: true,
                    bingeGroup: content.name
                }
            };

            console.log(`✅ Generated stream for ${content.name}: ${streamUrl}`);
            return Promise.resolve({ streams: [stream] });

        } catch (error) {
            console.error('Stream error:', error);
            return Promise.resolve({ streams: [] });
        }
    }

    async getMeta(type, id) {
        try {
            const database = type === 'movie' ? contentDatabase.movies : contentDatabase.series;
            const content = database.get(id);

            if (!content) {
                return Promise.reject(new Error('Content not found'));
            }

            const meta = {
                id: content.id,
                type: content.type,
                name: content.name,
                poster: content.poster,
                background: content.background,
                year: content.year,
                imdb_id: content.imdb_id,
                description: content.description || `Watch ${content.name}`,
                genre: content.genre || [],
                director: content.director || [],
                cast: content.cast || [],
                runtime: content.runtime || ''
            };

            return Promise.resolve({ meta });

        } catch (error) {
            console.error('Meta error:', error);
            return Promise.reject(error);
        }
    }

    extractQualityFromFile(fileName) {
        const qualityMatch = fileName.match(/\b(\d{3,4}p|4K|UHD|HD|SD)\b/i);
        if (qualityMatch) return qualityMatch[1];

        const sourceMatch = fileName.match(/\b(BluRay|WEBRip|HDTV|BDRip|DVDRip)\b/i);
        if (sourceMatch) return sourceMatch[1];

        return 'Unknown';
    }

    formatFileSize(bytes) {
        if (!bytes) return '';
        
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let size = bytes;
        let unitIndex = 0;

        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }

        return `${size.toFixed(1)} ${units[unitIndex]}`;
    }

    getBaseUrl() {
        return process.env.RENDER_EXTERNAL_URL || 
               process.env.RAILWAY_STATIC_URL || 
               `http://localhost:${CONFIG.PORT}`;
    }

    loadSampleContent() {
        // Sample content for demonstration
        const sampleMovies = [
            {
                id: 'tg:movie:sample1',
                type: 'movie',
                name: 'Sample Movie 1',
                year: '2023',
                poster: 'https://via.placeholder.com/300x450/1a1a2e/fff?text=Sample+Movie+1',
                description: 'Add your Telegram bot token and channels to load real content!',
                genre: ['Action'],
                telegramFile: null // No real file for sample
            }
        ];

        sampleMovies.forEach(movie => {
            contentDatabase.movies.set(movie.id, movie);
        });

        console.log('📚 Loaded sample content - Add bot token and channels for real content');
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    getExpressApp() {
        const app = express();
        
        app.use(cors());
        app.use(express.json());

        // Root endpoint
        app.get('/', (req, res) => {
            res.redirect('/configure');
        });

        // Telegram file streaming endpoint
        app.get('/stream/:fileId', async (req, res) => {
            const { fileId } = req.params;
            const range = req.headers.range;
            
            console.log(`🎥 Streaming file: ${fileId}, Range: ${range || 'full'}`);
            await this.streamTelegramFile(fileId, range, res);
        });

        // Keep-alive endpoint
        app.get('/ping', (req, res) => {
            res.json({ 
                status: 'alive', 
                timestamp: new Date().toISOString(),
                movies: contentDatabase.movies.size,
                series: contentDatabase.series.size
            });
        });

        // Health check
        app.get('/health', (req, res) => {
            res.json({ 
                status: 'ok',
                version: '3.0.0',
                movies: contentDatabase.movies.size,
                series: contentDatabase.series.size,
                cache_size: cache.size,
                bot_configured: !!CONFIG.TELEGRAM_BOT_TOKEN,
                channels_configured: CONFIG.TELEGRAM_CHANNELS.length
            });
        });

        // Force refresh content from channels
        app.post('/refresh', async (req, res) => {
            try {
                console.log('🔄 Manual refresh requested...');
                contentDatabase.movies.clear();
                contentDatabase.series.clear();
                cache.clear();
                
                await this.loadContentFromChannels();
                
                res.json({ 
                    success: true, 
                    movies: contentDatabase.movies.size,
                    series: contentDatabase.series.size
                });
            } catch (error) {
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // Configuration interface
        app.get('/configure', (req, res) => {
            const moviesList = Array.from(contentDatabase.movies.values())
                .slice(0, 10) // Show first 10
                .map(movie => `<li><strong>${movie.name}</strong> (${movie.year}) ${movie.telegramFile ? '✅' : '❌'}</li>`)
                .join('');
            
            const seriesList = Array.from(contentDatabase.series.values())
                .slice(0, 10) // Show first 10
                .map(series => `<li><strong>${series.name}</strong> (${series.year}) ${series.telegramFile ? '✅' : '❌'}</li>`)
                .join('');

            const hasMore = contentDatabase.movies.size > 10 || contentDatabase.series.size > 10;

            res.send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Telegram Stream Server v3.0</title>
                    <meta name="viewport" content="width=device-width, initial-scale=1">
                    <style>
                        body { 
                            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
                            max-width: 1200px; 
                            margin: 0 auto; 
                            padding: 20px;
                            background: linear-gradient(135deg, #0f0f23 0%, #1a1a2e 100%);
                            color: #fff;
                            line-height: 1.6;
                            min-height: 100vh;
                        }
                        .container {
                            background: rgba(26, 26, 46, 0.8);
                            padding: 40px;
                            border-radius: 20px;
                            box-shadow: 0 8px 32px rgba(0,0,0,0.3);
                            backdrop-filter: blur(10px);
                        }
                        h1 { 
                            color: #ff6b35; 
                            border-bottom: 3px solid #ff6b35; 
                            padding-bottom: 15px;
                            margin-bottom: 30px;
                            font-size: 2.5em;
                        }
                        h2, h3 { color: #ffa500; margin-top: 30px; }
                        .status { 
                            padding: 25px; 
                            border-radius: 15px; 
                            margin: 25px 0;
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                            border: none;
                        }
                        .manifest-url {
                            background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
                            padding: 25px;
                            border-radius: 15px;
                            margin: 25px 0;
                            font-family: 'Monaco', 'Menlo', monospace;
                            word-break: break-all;
                        }
                        .stats {
                            display: grid;
                            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                            gap: 20px;
                            margin: 30px 0;
                        }
                        .stat-card {
                            background: linear-gradient(135deg, #43cea2 0%, #185a9d 100%);
                            padding: 25px;
                            border-radius: 15px;
                            text-align: center;
                        }
                        .stat-number {
                            font-size: 2.5em;
                            font-weight: bold;
                            margin-bottom: 10px;
                        }
                        .btn {
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                            color: white;
                            padding: 15px 30px;
                            border: none;
                            border-radius: 10px;
                            text-decoration: none;
                            display: inline-block;
                            margin: 10px 10px;
                            cursor: pointer;
                            transition: all 0.3s;
                            font-weight: bold;
                        }
                        .btn:hover {
                            transform: translateY(-3px);
                            box-shadow: 0 5px 15px rgba(0,0,0,0.3);
                        }
                        .btn-refresh {
                            background: linear-gradient(135deg, #ff6b35 0%, #f7931e 100%);
                        }
                        ul { 
                            background: rgba(22, 33, 62, 0.5);
                            padding: 25px;
                            border-radius: 15px;
                            margin: 20px 0;
                        }
                        li { 
                            margin: 15px 0; 
                            padding: 12px;
                            background: rgba(255, 255, 255, 0.05);
                            border-radius: 8px;
                            border-left: 4px solid #ff6b35;
                        }
                        code { 
                            background: rgba(255, 255, 255, 0.1); 
                            padding: 6px 12px; 
                            border-radius: 6px;
                            font-family: 'Monaco', 'Menlo', monospace;
                        }
                        .config-status {
                            padding: 20px;
                            border-radius: 10px;
                            margin: 20px 0;
                        }
                        .config-ok { background: linear-gradient(135deg, #56ab2f 0%, #a8e6cf 100%); }
                        .config-error { background: linear-gradient(135deg, #ff416c 0%, #ff4b2b 100%); }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <h1>🎬 Telegram Stream Server v3.0</h1>
                        
                        <div class="stats">
                            <div class="stat-card">
                                <div class="stat-number">${contentDatabase.movies.size}</div>
                                <div>Movies</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-number">${contentDatabase.series.size}</div>
                                <div>Series</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-number">${cache.size}</div>
                                <div>Cached Items</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-number">${CONFIG.TELEGRAM_CHANNELS.length}</div>
                                <div>Channels</div>
                            </div>
                        </div>

                        <div class="config-status ${CONFIG.TELEGRAM_BOT_TOKEN ? 'config-ok' : 'config-error'}">
                            <h3>🤖 Bot Configuration:</h3>
                            <p><strong>Status:</strong> ${CONFIG.TELEGRAM_BOT_TOKEN ? '✅ Configured' : '❌ Not configured'}</p>
                            <p><strong>Channels:</strong> ${CONFIG.TELEGRAM_CHANNELS.length ? CONFIG.TELEGRAM_CHANNELS.join(', ') : 'None configured'}</p>
                            ${!CONFIG.TELEGRAM_BOT_TOKEN ? '<p><strong>⚠️ Add TELEGRAM_BOT_TOKEN and TELEGRAM_CHANNELS environment variables to load real content!</strong></p>' : ''}
                        </div>
                        
                        <div class="manifest-url">
                            <h3>📱 Install in Stremio:</h3>
                            <p><strong>Manifest URL:</strong></p>
                            <p><code>${req.protocol}://${req.get('host')}/manifest.json</code></p>
                            <p><small>Copy this URL and paste it in Stremio → Addons → Install from URL</small></p>
                        </div>

                        <div class="status">
                            <h3>✨ New in v3.0 - Direct Telegram Streaming:</h3>
                            <ul style="background: none; padding: 0;">
                                <li>🎯 <strong>Auto-discovery</strong> - Scans your Telegram channels automatically</li>
                                <li>🎥 <strong>Direct streaming</strong> - Streams Telegram files directly to
