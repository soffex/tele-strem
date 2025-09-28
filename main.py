#!/usr/bin/env python3
"""
Hybrid Architecture Stremio Addon with Pyrogram
- Single client for metadata operations
- Smart caching and chunked downloading
- Rate limit aware streaming
"""

import os
import asyncio
import json
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, AsyncGenerator
import hashlib
import time
from dataclasses import dataclass
from collections import defaultdict
import sqlite3
import pickle

from fastapi import FastAPI, HTTPException, Request, BackgroundTasks
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
from pyrogram import Client, filters
from pyrogram.types import Message
import aiofiles
import aiofiles.os

# Import persistence manager
from persistence import PersistenceManager, PersistentMediaDatabase, HeartbeatManager, AutoSaveManager

# Configuration
class Config:
    # Telegram API credentials
    API_ID = int(os.getenv('API_ID', ''))
    API_HASH = os.getenv('API_HASH', '')
    PHONE_NUMBER = os.getenv('PHONE_NUMBER', '')
    
    # Channels to monitor
    MONITORED_CHANNELS = [ch.strip() for ch in os.getenv('MONITORED_CHANNELS', '').split(',') if ch.strip()]
    
    # Server configuration
    HOST = os.getenv('HOST', '0.0.0.0')
    PORT = int(os.getenv('PORT', 8080))
    
    # Storage paths
    SESSION_PATH = os.getenv('SESSION_PATH', './sessions')
    CACHE_PATH = os.getenv('CACHE_PATH', './cache')
    DB_PATH = os.getenv('DB_PATH', './data/media.db')
    
    # Performance settings
    CHUNK_SIZE = int(os.getenv('CHUNK_SIZE', 1024 * 1024))  # 1MB chunks
    MAX_CACHE_SIZE = int(os.getenv('MAX_CACHE_SIZE', 5 * 1024 * 1024 * 1024))  # 5GB cache
    CACHE_CLEANUP_INTERVAL = int(os.getenv('CACHE_CLEANUP_INTERVAL', 3600))  # 1 hour
    
    # Rate limiting
    MAX_CONCURRENT_DOWNLOADS = int(os.getenv('MAX_CONCURRENT_DOWNLOADS', 3))
    RATE_LIMIT_DELAY = float(os.getenv('RATE_LIMIT_DELAY', 1.0))  # Delay between operations
    
    # Addon configuration
    ADDON_NAME = os.getenv('ADDON_NAME', 'Personal Telegram Media')
    ADDON_VERSION = os.getenv('ADDON_VERSION', '1.0.0')

# Ensure directories exist
for path in [Config.SESSION_PATH, Config.CACHE_PATH, Path(Config.DB_PATH).parent]:
    Path(path).mkdir(exist_ok=True, parents=True)

@dataclass
class RateLimitInfo:
    last_request: float = 0
    request_count: int = 0
    reset_time: float = 0

class RateLimiter:
    def __init__(self):
        self.info = RateLimitInfo()
        self.active_downloads = 0
        
    async def acquire_download_slot(self):
        """Wait for available download slot"""
        while self.active_downloads >= Config.MAX_CONCURRENT_DOWNLOADS:
            await asyncio.sleep(0.1)
        
        # Wait for rate limit if needed
        now = time.time()
        if now - self.info.last_request < Config.RATE_LIMIT_DELAY:
            await asyncio.sleep(Config.RATE_LIMIT_DELAY - (now - self.info.last_request))
        
        self.active_downloads += 1
        self.info.last_request = time.time()
        
    def release_download_slot(self):
        """Release download slot"""
        self.active_downloads = max(0, self.active_downloads - 1)

class MediaDatabase:
    def __init__(self, db_path: str):
        self.db_path = db_path
        self.init_db()
        
    def init_db(self):
        """Initialize SQLite database"""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute('''
                CREATE TABLE IF NOT EXISTS media_files (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    year TEXT,
                    quality TEXT,
                    type TEXT NOT NULL,
                    description TEXT,
                    channel_id INTEGER,
                    message_id INTEGER,
                    file_id TEXT,
                    file_size INTEGER,
                    original_filename TEXT,
                    date_added TEXT,
                    last_accessed TEXT,
                    access_count INTEGER DEFAULT 0
                )
            ''')
            
            conn.execute('''
                CREATE TABLE IF NOT EXISTS file_cache (
                    file_id TEXT PRIMARY KEY,
                    cache_path TEXT,
                    size INTEGER,
                    created_at TEXT,
                    last_accessed TEXT
                )
            ''')
            
            conn.execute('CREATE INDEX IF NOT EXISTS idx_type ON media_files(type)')
            conn.execute('CREATE INDEX IF NOT EXISTS idx_date_added ON media_files(date_added)')
    
    def add_file(self, file_data: Dict) -> str:
        """Add file to database"""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute('''
                INSERT OR REPLACE INTO media_files 
                (id, name, year, quality, type, description, channel_id, message_id, 
                 file_id, file_size, original_filename, date_added)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                file_data['id'], file_data['name'], file_data['year'], 
                file_data['quality'], file_data['type'], file_data['description'],
                file_data['channel_id'], file_data['message_id'], file_data['file_id'],
                file_data['file_size'], file_data['original_filename'], file_data['date_added']
            ))
        return file_data['id']
    
    def get_file(self, file_id: str) -> Optional[Dict]:
        """Get file by ID"""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.execute('SELECT * FROM media_files WHERE id = ?', (file_id,))
            row = cursor.fetchone()
            if row:
                # Update access stats
                conn.execute('''
                    UPDATE media_files 
                    SET last_accessed = ?, access_count = access_count + 1 
                    WHERE id = ?
                ''', (datetime.now().isoformat(), file_id))
                return dict(row)
        return None
    
    def get_catalog(self, content_type: str, search: str = None, limit: int = 100) -> List[Dict]:
        """Get catalog items"""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            
            query = 'SELECT * FROM media_files WHERE type = ?'
            params = [content_type]
            
            if search:
                query += ' AND (name LIKE ? OR description LIKE ?)'
                search_term = f'%{search}%'
                params.extend([search_term, search_term])
            
            query += ' ORDER BY date_added DESC LIMIT ?'
            params.append(limit)
            
            cursor = conn.execute(query, params)
            return [dict(row) for row in cursor.fetchall()]

class CacheManager:
    def __init__(self, cache_path: str, db: MediaDatabase):
        self.cache_path = Path(cache_path)
        self.db = db
        
    def get_cache_key(self, channel_id: int, message_id: int, file_id: str) -> str:
        """Generate cache key"""
        return hashlib.md5(f"{channel_id}_{message_id}_{file_id}".encode()).hexdigest()
    
    def get_cache_path(self, cache_key: str) -> Path:
        """Get cache file path"""
        return self.cache_path / f"{cache_key}.cache"
    
    async def is_cached(self, cache_key: str) -> bool:
        """Check if file is cached"""
        cache_file = self.get_cache_path(cache_key)
        return cache_file.exists()
    
    async def cache_file_stream(self, cache_key: str, file_stream: AsyncGenerator) -> Path:
        """Cache file stream to disk"""
        cache_file = self.get_cache_path(cache_key)
        
        async with aiofiles.open(cache_file, 'wb') as f:
            async for chunk in file_stream:
                await f.write(chunk)
        
        return cache_file
    
    async def read_cached_file(self, cache_key: str) -> AsyncGenerator[bytes, None]:
        """Read cached file"""
        cache_file = self.get_cache_path(cache_key)
        
        async with aiofiles.open(cache_file, 'rb') as f:
            while True:
                chunk = await f.read(Config.CHUNK_SIZE)
                if not chunk:
                    break
                yield chunk
    
    async def cleanup_cache(self):
        """Clean up old cache files"""
        cache_size = 0
        cache_files = []
        
        for cache_file in self.cache_path.glob("*.cache"):
            stat = await aiofiles.os.stat(cache_file)
            cache_size += stat.st_size
            cache_files.append((cache_file, stat.st_mtime, stat.st_size))
        
        if cache_size > Config.MAX_CACHE_SIZE:
            # Sort by last modified time (oldest first)
            cache_files.sort(key=lambda x: x[1])
            
            for cache_file, _, size in cache_files:
                if cache_size <= Config.MAX_CACHE_SIZE * 0.8:  # Keep 80% of max size
                    break
                try:
                    await aiofiles.os.unlink(cache_file)
                    cache_size -= size
                    print(f"Cleaned up cache file: {cache_file.name}")
                except OSError:
                    pass

class MediaParser:
    @staticmethod
    def parse_filename(filename: str) -> Dict:
        """Extract metadata from filename"""
        name = filename.rsplit('.', 1)[0]
        
        # Extract year
        year_match = re.search(r'\b(19|20)\d{2}\b', name)
        year = year_match.group(0) if year_match else str(datetime.now().year)
        
        # Extract quality
        quality_patterns = [
            r'\b(480p|720p|1080p|1440p|2160p|4K)\b',
            r'\b(BluRay|WEBRip|HDRip|DVDRip|CAMRip|WEB-DL|BDRip)\b'
        ]
        quality = 'Unknown'
        for pattern in quality_patterns:
            match = re.search(pattern, name, re.IGNORECASE)
            if match:
                quality = match.group(0)
                break
        
        # Detect series
        series_patterns = [
            r'\bS\d{1,2}E\d{1,2}\b',
            r'\bSeason\s+\d+\b',
            r'\bEpisode\s+\d+\b'
        ]
        is_series = any(re.search(pattern, name, re.IGNORECASE) for pattern in series_patterns)
        
        # Clean title
        title = name
        cleanup_patterns = [
            r'\b(19|20)\d{2}\b',
            r'\b(480p|720p|1080p|1440p|2160p|4K)\b',
            r'\b(BluRay|WEBRip|HDRip|DVDRip|CAMRip|WEB-DL|BDRip)\b',
            r'\b(x264|x265|H264|H265|HEVC|AAC|AC3|DTS)\b',
            r'\bS\d{1,2}E\d{1,2}\b',
        ]
        for pattern in cleanup_patterns:
            title = re.sub(pattern, '', title, flags=re.IGNORECASE)
        
        title = re.sub(r'[._-]', ' ', title)
        title = re.sub(r'\s+', ' ', title).strip()
        
        return {
            'title': title or filename,
            'year': year,
            'quality': quality,
            'type': 'series' if is_series else 'movie',
            'original_filename': filename
        }

class TelegramStreamer:
    def __init__(self, db: MediaDatabase, cache_manager: CacheManager):
        self.client = None
        self.db = db
        self.cache_manager = cache_manager
        self.rate_limiter = RateLimiter()
        
    async def initialize(self):
        """Initialize Pyrogram client"""
        self.client = Client(
            "stremio_session",
            api_id=Config.API_ID,
            api_hash=Config.API_HASH,
            phone_number=Config.PHONE_NUMBER,
            workdir=Config.SESSION_PATH
        )
        
        await self.client.start()
        print(f"Connected to Telegram as {(await self.client.get_me()).first_name}")
        
        # Scan channels
        await self._scan_channels()
        
    async def _scan_channels(self):
        """Scan channels for media files"""
        print("Scanning channels for media files...")
        
        for channel in Config.MONITORED_CHANNELS:
            try:
                channel_id = int(channel) if channel.lstrip('-').isdigit() else channel
                count = 0
                
                async for message in self.client.get_chat_history(channel_id, limit=200):
                    if message.document or message.video:
                        await self._process_message(message)
                        count += 1
                        
                        # Add delay to respect rate limits
                        await asyncio.sleep(0.1)
                        
                print(f"Scanned channel {channel}: {count} files")
                
            except Exception as e:
                print(f"Error scanning channel {channel}: {e}")
    
    async def _process_message(self, message: Message):
        """Process media message"""
        try:
            file_obj = message.document or message.video
            if not file_obj:
                return
                
            filename = getattr(file_obj, 'file_name', f"file_{message.id}")
            if not filename:
                return
                
            # Parse metadata
            file_info = MediaParser.parse_filename(filename)
            
            # Create file data
            file_data = {
                'id': f"tg:{file_info['type']}:{message.chat.id}:{message.id}",
                'name': file_info['title'],
                'year': file_info['year'],
                'quality': file_info['quality'],
                'type': file_info['type'],
                'description': f"Personal media: {file_info['original_filename']}",
                'channel_id': message.chat.id,
                'message_id': message.id,
                'file_id': file_obj.file_id,
                'file_size': file_obj.file_size,
                'original_filename': file_info['original_filename'],
                'date_added': datetime.now().isoformat()
            }
            
            # Add to database
            self.db.add_file(file_data)
            
        except Exception as e:
            print(f"Error processing message {message.id}: {e}")
    
    async def stream_file(self, channel_id: int, message_id: int, use_cache: bool = True) -> AsyncGenerator[bytes, None]:
        """Stream file with smart caching"""
        try:
            await self.rate_limiter.acquire_download_slot()
            
            message = await self.client.get_messages(channel_id, message_id)
            if not (message.document or message.video):
                raise HTTPException(status_code=404, detail="File not found")
            
            file_obj = message.document or message.video
            cache_key = self.cache_manager.get_cache_key(channel_id, message_id, file_obj.file_id)
            
            # Check cache first
            if use_cache and await self.cache_manager.is_cached(cache_key):
                print(f"Serving from cache: {cache_key}")
                async for chunk in self.cache_manager.read_cached_file(cache_key):
                    yield chunk
                return
            
            # Stream from Telegram
            print(f"Streaming from Telegram: {file_obj.file_name}")
            
            async def telegram_stream():
                async for chunk in self.client.stream_media(message, chunk_size=Config.CHUNK_SIZE):
                    yield chunk
            
            # Cache while streaming for future use
            if use_cache and file_obj.file_size < Config.MAX_CACHE_SIZE // 2:  # Only cache smaller files
                chunks = []
                async for chunk in telegram_stream():
                    chunks.append(chunk)
                    yield chunk
                
                # Save to cache in background
                asyncio.create_task(self._save_to_cache(cache_key, chunks))
            else:
                async for chunk in telegram_stream():
                    yield chunk
                    
        finally:
            self.rate_limiter.release_download_slot()
    
    async def _save_to_cache(self, cache_key: str, chunks: List[bytes]):
        """Save chunks to cache"""
        try:
            cache_file = self.cache_manager.get_cache_path(cache_key)
            async with aiofiles.open(cache_file, 'wb') as f:
                for chunk in chunks:
                    await f.write(chunk)
            print(f"Cached file: {cache_key}")
        except Exception as e:
            print(f"Cache save error: {e}")

# FastAPI app
app = FastAPI(title="Hybrid Telegram Stremio Addon")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global instances with persistence
persistence_manager = PersistenceManager(Config.DB_PATH.replace('/media.db', ''))
db = PersistentMediaDatabase(Config.DB_PATH, persistence_manager)
cache_manager = CacheManager(Config.CACHE_PATH, db)
streamer = TelegramStreamer(db, cache_manager)
heartbeat = HeartbeatManager()
auto_save = AutoSaveManager(persistence_manager)

# Stremio manifest
MANIFEST = {
    "id": "org.personal.telegram.hybrid",
    "version": Config.ADDON_VERSION,
    "name": Config.ADDON_NAME,
    "description": "Stream personal media from Telegram with smart caching",
    "resources": ["catalog", "stream", "meta"],
    "types": ["movie", "series"],
    "idPrefixes": ["tg"],
    "catalogs": [
        {
            "type": "movie",
            "id": "personal-movies",
            "name": "Personal Movies",
            "extra": [{"name": "search", "isRequired": False}]
        },
        {
            "type": "series", 
            "id": "personal-series",
            "name": "Personal Series",
            "extra": [{"name": "search", "isRequired": False}]
        }
    ]
}

# Routes
@app.get("/")
async def root():
    return {"message": "Hybrid Telegram Stremio Addon", "status": "running"}

@app.get("/manifest.json")
async def get_manifest():
    return MANIFEST

@app.get("/health")
async def health_check():
    movie_count = len(db.get_catalog('movie'))
    series_count = len(db.get_catalog('series'))
    
    return {
        "status": "healthy",
        "movies": movie_count,
        "series": series_count,
        "active_downloads": streamer.rate_limiter.active_downloads,
        "timestamp": datetime.now().isoformat()
    }

@app.get("/catalog/{content_type}/{catalog_id}.json")
async def get_catalog(content_type: str, catalog_id: str, search: str = None):
    """Get catalog items"""
    try:
        items = db.get_catalog(content_type, search)
        
        metas = [{
            'id': item['id'],
            'type': content_type,
            'name': item['name'],
            'poster': f'https://via.placeholder.com/300x450/2c3e50/ecf0f1?text={content_type.upper()}',
            'year': item['year'],
            'description': item['description']
        } for item in items]
        
        return {"metas": metas}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/stream/{content_type}/{video_id}.json")
async def get_streams(content_type: str, video_id: str, request: Request):
    """Get stream URLs"""
    try:
        file_data = db.get_file(video_id)
        if not file_data:
            raise HTTPException(status_code=404, detail="File not found")
        
        base_url = f"{request.url.scheme}://{request.url.netloc}"
        stream_url = f"{base_url}/stream-file/{file_data['channel_id']}/{file_data['message_id']}"
        
        return {
            "streams": [{
                "title": f"{file_data['name']} [{file_data['quality']}]",
                "url": stream_url,
                "behaviorHints": {
                    "notWebReady": False
                }
            }]
        }
    except Exception as e:
        raise HTTPEx
