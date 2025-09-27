const { addonBuilder } = require('stremio-addon-sdk');
const express = require('express');
const cors = require('cors');
const axios = require('axios');

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
                { name: 'genre', isRequired: false, options: ['Action', 'Comedy', 'Drama', 'Horror', 'Sci-Fi', 'Thriller'] }
            ]
        },
        {
            type: 'series',
            id: 'telegram-series',
            name: 'My Series',
            extra: [
                { name: 'search', isRequired: false },
                { name: 'genre', isRequired: false, options: ['Action', 'Comedy', 'Drama', 'Crime', 'Sci-Fi'] }
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
};

// Content database
let contentDatabase = {
    movies: new Map(),
    series: new Map(),
    fileCache: new Map()
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

        while (messageCount < 500) {
            try {
                const messages = await this.getChannelMessages(channelId, offset, limit);
                
                if (!messages || messages.length === 0) break;

                for (const message of messages) {
                    await this.processMessage(message, channelId);
                }

                offset += limit;
                messageCount += messages.length;
                
                await this.sleep(1000);
                
            } catch (error) {
                console.error(`Error fetching messages from ${channelId}:`, error.message);
                break;
            }
        }
    }

    async getChannelMessages(channelId, offset = 0, limit = 100) {
        try {
            // Method 1: Try to get chat administrators to verify access
            const adminResponse = await axios.get(
                `https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/getChatAdministrators`,
                { params: { chat_id: channelId }, timeout: 10000 }
            );

            if (!adminResponse.data.ok) {
                throw new Error(`Cannot access channel ${channelId}: ${adminResponse.data.description}`);
            }

            console.log(`✅ Bot has access to channel ${channelId}`);

            // Method 2: Get recent updates that include channel posts
            const updatesResponse = await axios.get(
                `https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/getUpdates`,
                {
                    params: {
                        allowed_updates: JSON.stringify(['channel_post']),
                        limit: 100,
                        offset: -100 // Get recent messages
                    },
                    timeout: 10000
                }
            );

            if (!updatesResponse.data.ok) {
                throw new Error(`Cannot get updates: ${updatesResponse.data.description}`);
            }

            // Filter for our specific channel
            const updates = updatesResponse.data.result || [];
            const channelMessages = updates
                .filter(update => {
                    if (!update.channel_post) return false;
                    const postChannelId = update.channel_post.chat.id.toString();
                    return postChannelId === channelId.toString();
                })
                .map(update => update.channel_post);

            console.log(`📨 Found ${channelMessages.length} messages from channel ${channelId}`);
            return channelMessages;

        } catch (error) {
            if (error.response?.status === 400) {
                console.error(`❌ Bot not admin in channel ${channelId}:`, error.response.data.description);
            } else if (error.response?.status === 403) {
                console.error(`❌ Bot kicked/blocked from channel ${channelId}:`, error.response.data.description);
            } else {
                console.error(`❌ Error accessing channel ${channelId}:`, error.message);
            }
            return [];
        }
    }

    async processMessage(message, channelId) {
        try {
            const video = message.video || message.document;
            if (!video) return;

            const fileName = video.file_name || '';
            const isVideo = video.mime_type?.startsWith('video/') || 
                           fileName.match(/\.(mp4|mkv|avi|mov|wmv|flv|webm)$/i);
            
            if (!isVideo) return;

            const text = message.text || message.caption || '';
            const metadata = this.extractMetadata(text, fileName);
            
            if (!metadata.title) return;

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

        if (!metadata.title) {
            metadata.title = fileName
                .replace(/\.[^.]+$/, '')
                .replace(/[._-]/g, ' ')
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

        // Extract quality
        const qualityMatch = (text + ' ' + fileName).match(/\b(\d{3,4}p|4K|UHD|HD|SD)\b/i);
        if (qualityMatch) {
            metadata.description = `Quality: ${qualityMatch[1]}`;
        }

        // Default poster
        metadata.poster = `https://via.placeholder.com/300x450/1a1a2e/fff?text=${encodeURIComponent(metadata.title)}`;
        metadata.background = metadata.poster;

        return metadata;
    }

    async streamTelegramFile(fileId, range, res) {
        try {
            const fileInfo = await this.getTelegramFileInfo(fileId);
            if (!fileInfo) {
                return res.status(404).send('File not found');
            }

            const fileUrl = `https://api.telegram.org/file/bot${CONFIG.TELEGRAM_BOT_TOKEN}/${fileInfo.file_path}`;
            
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

                const response = await axios.get(fileUrl, {
                    headers: { Range: `bytes=${start}-${end}` },
                    responseType: 'stream'
                });

                response.data.pipe(res);
            } else {
                headers['Content-Length'] = fileInfo.file_size;
                res.writeHead(200, headers);

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
            
            if (cache.has(cacheKey)) {
                const cached = cache.get(cacheKey);
                if (Date.now() - cached.timestamp < CONFIG.CACHE_TTL) {
                    return cached.data;
                }
            }

            let items = [];
            const database = type === 'movie' ? contentDatabase.movies : contentDatabase.series;
            const allItems = Array.from(database.values());

            if (extra.search) {
                const searchTerm = extra.search.toLowerCase();
                items = allItems.filter(item => 
                    item.name.toLowerCase().includes(searchTerm) ||
                    (item.description && item.description.toLowerCase().includes(searchTerm))
                );
            } else {
                items = allItems;
            }

            if (extra.genre) {
                items = items.filter(item => 
                    item.genre && item.genre.includes(extra.genre)
                );
            }

            items.sort((a, b) => a.name.localeCompare(b.name));

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
        const sampleMovies = [
            {
                id: 'tg:movie:sample1',
                type: 'movie',
                name: 'Sample Movie - Add Bot Token',
                year: '2023',
                poster: 'https://via.placeholder.com/300x450/1a1a2e/fff?text=Add+Bot+Token',
                description: 'Configure TELEGRAM_BOT_TOKEN and TELEGRAM_CHANNELS to load your real content!',
                genre: ['Action'],
                telegramFile: null
            }
        ];

        sampleMovies.forEach(movie => {
            contentDatabase.movies.set(movie.id, movie);
        });

        console.log('📚 Sample content loaded - Add bot token for real content');
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
            
            console.log(`🎥 Streaming file: ${f
