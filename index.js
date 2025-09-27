const { addonBuilder } = require('stremio-addon-sdk');
const express = require('express');
const cors = require('cors');

// Addon manifest with catalogs
const manifest = {
    id: 'org.telegram.catalog',
    version: '2.0.0',
    name: 'Telegram Media Catalog',
    description: 'Browse and stream your Telegram media collection',
    resources: ['catalog', 'stream', 'meta'],
    types: ['movie', 'series'],
    idPrefixes: ['telegram'],
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
    PORT: process.env.PORT || 3000,
    CACHE_TTL: 3600000, // 1 hour
};

// In-memory content database
let contentDatabase = {
    movies: new Map(),
    series: new Map()
};

// Cache for catalog responses
const cache = new Map();

class TelegramCatalogAddon {
    constructor() {
        this.addon = new addonBuilder(manifest);
        this.setupRoutes();
        this.loadSampleContent(); // Load some sample content for testing
    }

    setupRoutes() {
        // Catalog handler
        this.addon.defineCatalogHandler(({ type, id, extra }) => {
            console.log(`Catalog request: ${type}/${id}`, extra);
            return this.getCatalog(type, id, extra);
        });

        // Stream handler
        this.addon.defineStreamHandler(({ type, id }) => {
            console.log(`Stream request: ${type}/${id}`);
            return this.getStreams(type, id);
        });

        // Meta handler
        this.addon.defineMetaHandler(({ type, id }) => {
            console.log(`Meta request: ${type}/${id}`);
            return this.getMeta(type, id);
        });
    }

    loadSampleContent() {
        // Sample movies - replace with your actual content
        const sampleMovies = [
            {
                id: 'telegram:movie:1',
                type: 'movie',
                name: 'John Wick: Chapter 2',
                year: '2017',
                imdb_id: 'tt4425200',
                poster: 'https://m.media-amazon.com/images/M/MV5BMjE2NDkxNTY2M15BMl5BanBnXkFtZTgwMDc2NzE0MTI@._V1_SX300.jpg',
                background: 'https://m.media-amazon.com/images/M/MV5BMjE2NDkxNTY2M15BMl5BanBnXkFtZTgwMDc2NzE0MTI@._V1_.jpg',
                description: 'After returning to the criminal underworld to repay a debt, John Wick discovers that a large bounty has been put on his life.',
                genre: ['Action', 'Crime', 'Thriller'],
                director: ['Chad Stahelski'],
                cast: ['Keanu Reeves', 'Riccardo Scamarcio', 'Ian McShane'],
                runtime: '122 min',
                streams: [
                    {
                        title: '📺 John Wick 2 [1080p BluRay] 💾 2.5GB',
                        url: 'https://your-telegram-file-link.com/johnwick2.mp4', // Replace with actual link
                        quality: '1080p',
                        size: '2.5GB'
                    }
                ]
            },
            {
                id: 'telegram:movie:2',
                type: 'movie',
                name: 'Pushpa: The Rise',
                year: '2021',
                imdb_id: 'tt11389748',
                poster: 'https://m.media-amazon.com/images/M/MV5BY2QzYTQyYzItMzIwZi00OGNhLWEwYWQtMzUxN2JlZWMyYTJmXkEyXkFqcGdeQXVyMTI1NDA2OTYx._V1_SX300.jpg',
                background: 'https://m.media-amazon.com/images/M/MV5BY2QzYTQyYzItMzIwZi00OGNhLWEwYWQtMzUxN2JlZWMyYTJmXkEyXkFqcGdeQXVyMTI1NDA2OTYx._V1_.jpg',
                description: 'Violence erupts between red sandalwood smugglers and the police charged with bringing down their organization.',
                genre: ['Action', 'Drama'],
                director: ['Sukumar'],
                cast: ['Allu Arjun', 'Fahadh Faasil', 'Rashmika Mandanna'],
                runtime: '179 min',
                streams: [
                    {
                        title: '📺 Pushpa The Rise [720p WEBRip] 💾 1.8GB',
                        url: 'https://your-telegram-file-link.com/pushpa.mkv', // Replace with actual link
                        quality: '720p',
                        size: '1.8GB'
                    }
                ]
            }
        ];

        // Sample series
        const sampleSeries = [
            {
                id: 'telegram:series:1',
                type: 'series',
                name: 'Breaking Bad',
                year: '2008-2013',
                imdb_id: 'tt0903747',
                poster: 'https://m.media-amazon.com/images/M/MV5BYmQ4YWMxYjUtNjZmYi00MDQ1LWFjMjMtNjA5ZDdiYjdiODU5XkEyXkFqcGdeQXVyMTMzNDExODE5._V1_SX300.jpg',
                background: 'https://m.media-amazon.com/images/M/MV5BYmQ4YWMxYjUtNjZmYi00MDQ1LWFjMjMtNjA5ZDdiYjdiODU5XkEyXkFqcGdeQXVyMTMzNDExODE5._V1_.jpg',
                description: 'A high school chemistry teacher diagnosed with inoperable lung cancer turns to manufacturing and selling methamphetamine.',
                genre: ['Crime', 'Drama', 'Thriller'],
                director: ['Vince Gilligan'],
                cast: ['Bryan Cranston', 'Aaron Paul', 'Anna Gunn'],
                runtime: '47 min',
                streams: [
                    {
                        title: '📺 Breaking Bad S01E01 [1080p BluRay] 💾 900MB',
                        url: 'https://your-telegram-file-link.com/bb-s01e01.mkv', // Replace with actual link
                        quality: '1080p',
                        size: '900MB'
                    }
                ]
            }
        ];

        // Load content into database
        sampleMovies.forEach(movie => {
            contentDatabase.movies.set(movie.id, movie);
        });

        sampleSeries.forEach(series => {
            contentDatabase.series.set(series.id, series);
        });

        console.log(`📚 Loaded ${contentDatabase.movies.size} movies and ${contentDatabase.series.size} series`);
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

            // Convert database to array
            const allItems = Array.from(database.values());

            // Apply search filter
            if (extra.search) {
                const searchTerm = extra.search.toLowerCase();
                items = allItems.filter(item => 
                    item.name.toLowerCase().includes(searchTerm) ||
                    item.description.toLowerCase().includes(searchTerm)
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

            // Format items for Stremio
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
            console.log(`🔍 Looking for streams: ${type}/${id}`);

            const database = type === 'movie' ? contentDatabase.movies : contentDatabase.series;
            const content = database.get(id);

            if (!content || !content.streams) {
                console.log(`❌ No content found for ${id}`);
                return Promise.resolve({ streams: [] });
            }

            const streams = content.streams.map(stream => ({
                title: stream.title,
                url: stream.url,
                behaviorHints: {
                    notWebReady: true
                }
            }));

            console.log(`✅ Found ${streams.length} streams for ${content.name}`);
            return Promise.resolve({ streams });

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
                description: content.description,
                genre: content.genre,
                director: content.director,
                cast: content.cast,
                runtime: content.runtime
            };

            return Promise.resolve({ meta });

        } catch (error) {
            console.error('Meta error:', error);
            return Promise.reject(error);
        }
    }

    // Method to add new content (you can call this to add your movies/series)
    addMovie(movieData) {
        const id = `telegram:movie:${Date.now()}`;
        const movie = {
            id,
            type: 'movie',
            ...movieData
        };
        contentDatabase.movies.set(id, movie);
        console.log(`➕ Added movie: ${movie.name}`);
        return id;
    }

    addSeries(seriesData) {
        const id = `telegram:series:${Date.now()}`;
        const series = {
            id,
            type: 'series',
            ...seriesData
        };
        contentDatabase.series.set(id, series);
        console.log(`➕ Added series: ${series.name}`);
        return id;
    }

    // Method to update content streams
    updateStreams(contentId, streams) {
        const movie = contentDatabase.movies.get(contentId);
        const series = contentDatabase.series.get(contentId);
        
        if (movie) {
            movie.streams = streams;
            contentDatabase.movies.set(contentId, movie);
            console.log(`🔄 Updated streams for movie: ${movie.name}`);
        } else if (series) {
            series.streams = streams;
            contentDatabase.series.set(contentId, series);
            console.log(`🔄 Updated streams for series: ${series.name}`);
        }
    }

    getExpressApp() {
        const app = express();
        
        app.use(cors());
        app.use(express.json());

        // Root endpoint
        app.get('/', (req, res) => {
            res.redirect('/configure');
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
                version: '2.0.0',
                movies: contentDatabase.movies.size,
                series: contentDatabase.series.size,
                cache_size: cache.size
            });
        });

        // Content management endpoints
        app.post('/add-movie', (req, res) => {
            try {
                const id = this.addMovie(req.body);
                res.json({ success: true, id, message: 'Movie added successfully' });
            } catch (error) {
                res.status(400).json({ success: false, error: error.message });
            }
        });

        app.post('/add-series', (req, res) => {
            try {
                const id = this.addSeries(req.body);
                res.json({ success: true, id, message: 'Series added successfully' });
            } catch (error) {
                res.status(400).json({ success: false, error: error.message });
            }
        });

        app.get('/content', (req, res) => {
            res.json({
                movies: Array.from(contentDatabase.movies.values()),
                series: Array.from(contentDatabase.series.values())
            });
        });

        // Configuration and management interface
        app.get('/configure', (req, res) => {
            const moviesList = Array.from(contentDatabase.movies.values())
                .map(movie => `<li><strong>${movie.name}</strong> (${movie.year}) - ${movie.streams?.length || 0} streams</li>`)
                .join('');
            
            const seriesList = Array.from(contentDatabase.series.values())
                .map(series => `<li><strong>${series.name}</strong> (${series.year}) - ${series.streams?.length || 0} streams</li>`)
                .join('');

            res.send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Telegram Media Catalog</title>
                    <meta name="viewport" content="width=device-width, initial-scale=1">
                    <style>
                        body { 
                            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
                            max-width: 1000px; 
                            margin: 0 auto; 
                            padding: 20px;
                            background: #0f0f23;
                            color: #fff;
                            line-height: 1.6;
                        }
                        .container {
                            background: #1a1a2e;
                            padding: 30px;
                            border-radius: 15px;
                            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
                        }
                        h1 { 
                            color: #ff6b35; 
                            border-bottom: 3px solid #ff6b35; 
                            padding-bottom: 15px;
                            margin-bottom: 30px;
                        }
                        h2, h3 { color: #ffa500; margin-top: 30px; }
                        .status { 
                            padding: 20px; 
                            border-radius: 10px; 
                            margin: 20px 0;
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                            border: none;
                        }
                        .manifest-url {
                            background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
                            padding: 20px;
                            border-radius: 10px;
                            margin: 20px 0;
                            font-family: 'Monaco', 'Menlo', monospace;
                            word-break: break-all;
                        }
                        ul { 
                            background: #16213e;
                            padding: 20px;
                            border-radius: 10px;
                            margin: 15px 0;
                        }
                        li { 
                            margin: 10px 0; 
                            padding: 8px;
                            background: rgba(255, 255, 255, 0.05);
                            border-radius: 5px;
                        }
                        .btn {
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                            color: white;
                            padding: 12px 25px;
                            border: none;
                            border-radius: 8px;
                            text-decoration: none;
                            display: inline-block;
                            margin: 10px 5px;
                            cursor: pointer;
                            transition: transform 0.2s;
                        }
                        .btn:hover {
                            transform: translateY(-2px);
                        }
                        .stats {
                            display: grid;
                            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                            gap: 20px;
                            margin: 20px 0;
                        }
                        .stat-card {
                            background: linear-gradient(135deg, #43cea2 0%, #185a9d 100%);
                            padding: 20px;
                            border-radius: 10px;
                            text-align: center;
                        }
                        .stat-number {
                            font-size: 2em;
                            font-weight: bold;
                            margin-bottom: 5px;
                        }
                        code { 
                            background: rgba(255, 255, 255, 0.1); 
                            padding: 4px 8px; 
                            border-radius: 4px;
                            font-family: 'Monaco', 'Menlo', monospace;
                        }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <h1>🎬 Telegram Media Catalog v2.0</h1>
                        
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
                        </div>
                        
                        <div class="manifest-url">
                            <h3>📱 Install in Stremio:</h3>
                            <p><strong>Manifest URL:</strong></p>
                            <p><code>${req.protocol}://${req.get('host')}/manifest.json</code></p>
                            <p><small>Copy this URL and paste it in Stremio → Addons → Install from URL</small></p>
                        </div>

                        <div class="status">
                            <h3>✨ What's New in v2.0:</h3>
                            <ul style="background: none; padding: 0;">
                                <li>🎯 <strong>Catalog browsing</strong> - Browse movies and series like Netflix!</li>
                                <li>🔍 <strong>Search functionality</strong> - Search within your collection</li>
                                <li>🏷️ <strong>Genre filtering</strong> - Filter by Action, Comedy, Drama, etc.</li>
                                <li>📊 <strong>Rich metadata</strong> - Posters, descriptions, cast info</li>
                                <li>⚡ <strong>Better performance</strong> - Instant loading, smart caching</li>
                                <li>🎨 <strong>Beautiful interface</strong> - Modern Stremio integration</li>
                            </ul>
                        </div>

                        <h3>🎬 Your Movies (${contentDatabase.movies.size}):</h3>
                        <ul>
                            ${moviesList || '<li>No movies added yet. Use the API to add your content!</li>'}
                        </ul>

                        <h3>📺 Your Series (${contentDatabase.series.size}):</h3>
                        <ul>
                            ${seriesList || '<li>No series added yet. Use the API to add your content!</li>'}
                        </ul>

                        <h3>🔧 API Endpoints:</h3>
                        <div style="background: #16213e; padding: 20px; border-radius: 10px;">
                            <p><code>GET /content</code> - View all content</p>
                            <p><code>POST /add-movie</code> - Add a new movie</p>
                            <p><code>POST /add-series</code> - Add a new series</p>
                            <p><code>GET /health</code> - Health check</p>
                        </div>

                        <h3>📖 How to Add Your Content:</h3>
                        <ol>
                            <li>Get your Telegram file links</li>
                            <li>Use the API endpoints to add movies/series</li>
                            <li>Include proper metadata (name, year, poster, etc.)</li>
                            <li>Browse your collection in Stremio!</li>
                        </ol>

                        <div style="text-align: center; margin-top: 40px;">
                            <a href="/health" class="btn">Health Check</a>
                            <a href="/content" class="btn">View Content API</a>
                            <a href="/manifest.json" class="btn">View Manifest</a>
                        </div>

                        <script>
                            // Keep service alive
                            setInterval(() => {
                                fetch('/ping').catch(() => {});
                            }, 600000); // 10 minutes
                        </script>
                    </div>
                </body>
                </html>
            `);
        });

        // Serve addon manifest
        app.get('/manifest.json', (req, res) => {
            res.json(manifest);
        });

        // Use the addon middleware
        try {
            const addonInterface = this.addon.getInterface();
            if (addonInterface && typeof addonInterface === 'function') {
                app.use(addonInterface);
                console.log('✅ Stremio SDK interface loaded successfully');
            }
        } catch (error) {
            console.error('Error setting up addon interface:', error);
        }

        // 404 handler
        app.use((req, res) => {
            res.status(404).json({ 
                error: 'Not Found',
                message: `Path ${req.path} not found`,
                availableEndpoints: [
                    '/manifest.json',
                    '/health',
                    '/configure',
                    '/content',
                    '/add-movie',
                    '/add-series'
                ]
            });
        });

        return app;
    }

    start() {
        try {
            const app = this.getExpressApp();
            
            app.listen(CONFIG.PORT, () => {
                console.log(`🚀 Telegram Media Catalog v2.0 running on port ${CONFIG.PORT}`);
                console.log(`📚 Content loaded: ${contentDatabase.movies.size} movies, ${contentDatabase.series.size} series`);
                console.log(`🔗 Manifest URL: http://localhost:${CONFIG.PORT}/manifest.json`);
                console.log(`⚙️  Management: http://localhost:${CONFIG.PORT}/configure`);
                console.log(`📊 API: http://localhost:${CONFIG.PORT}/content`);
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
    addon = new TelegramCatalogAddon();
} catch (error) {
    console.error('Error initializing addon:', error);
    process.exit(1);
}

// Export for testing or external usage
module.exports = { TelegramCatalogAddon, CONFIG };

// Start the server if this file is run directly
if (require.main === module) {
    try {
        addon.start();
    } catch (error) {
        console.error('Error starting addon:', error);
        process.exit(1);
    }
                }
