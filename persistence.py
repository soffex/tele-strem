#!/usr/bin/env python3
"""
Data Persistence Manager
Ensures all data survives container restarts and idle periods
"""

import os
import json
import sqlite3
import pickle
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, Optional
import asyncio

class PersistenceManager:
    def __init__(self, data_dir: str = "./data"):
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(exist_ok=True, parents=True)
        
        # File paths
        self.state_file = self.data_dir / "app_state.json"
        self.cache_index_file = self.data_dir / "cache_index.json"
        self.session_backup_file = self.data_dir / "session_backup.pkl"
        
    def save_app_state(self, state: Dict[str, Any]):
        """Save application state to disk"""
        try:
            state['last_saved'] = datetime.now().isoformat()
            with open(self.state_file, 'w') as f:
                json.dump(state, f, indent=2, default=str)
            print(f"App state saved: {len(state)} items")
        except Exception as e:
            print(f"Failed to save app state: {e}")
    
    def load_app_state(self) -> Dict[str, Any]:
        """Load application state from disk"""
        try:
            if self.state_file.exists():
                with open(self.state_file, 'r') as f:
                    state = json.load(f)
                print(f"App state loaded: {len(state)} items")
                return state
        except Exception as e:
            print(f"Failed to load app state: {e}")
        return {}
    
    def save_cache_index(self, cache_index: Dict[str, Any]):
        """Save cache index for faster startup"""
        try:
            with open(self.cache_index_file, 'w') as f:
                json.dump(cache_index, f, indent=2, default=str)
            print(f"Cache index saved: {len(cache_index)} entries")
        except Exception as e:
            print(f"Failed to save cache index: {e}")
    
    def load_cache_index(self) -> Dict[str, Any]:
        """Load cache index"""
        try:
            if self.cache_index_file.exists():
                with open(self.cache_index_file, 'r') as f:
                    index = json.load(f)
                print(f"Cache index loaded: {len(index)} entries")
                return index
        except Exception as e:
            print(f"Failed to load cache index: {e}")
        return {}
    
    def backup_session_data(self, session_data: Any):
        """Backup session data"""
        try:
            with open(self.session_backup_file, 'wb') as f:
                pickle.dump(session_data, f)
            print("Session data backed up")
        except Exception as e:
            print(f"Failed to backup session: {e}")
    
    def restore_session_data(self) -> Optional[Any]:
        """Restore session data"""
        try:
            if self.session_backup_file.exists():
                with open(self.session_backup_file, 'rb') as f:
                    data = pickle.load(f)
                print("Session data restored")
                return data
        except Exception as e:
            print(f"Failed to restore session: {e}")
        return None
    
    def create_startup_script(self):
        """Create startup script to ensure persistence"""
        startup_script = self.data_dir / "startup.sh"
        script_content = '''#!/bin/bash
# Persistence startup script

echo "Starting Telegram Stremio Addon with persistence..."

# Ensure directories exist
mkdir -p /app/sessions /app/cache /app/data

# Set proper permissions
chmod -R 755 /app/sessions /app/cache /app/data

# Create keepalive file
touch /app/data/keepalive

# Start the application
python /app/main.py
'''
        
        try:
            with open(startup_script, 'w') as f:
                f.write(script_content)
            startup_script.chmod(0o755)
            print("Startup script created")
        except Exception as e:
            print(f"Failed to create startup script: {e}")

# Integration with main application
class PersistentMediaDatabase:
    def __init__(self, db_path: str, persistence_manager: PersistenceManager):
        self.db_path = db_path
        self.persistence = persistence_manager
        self.init_db()
        self._create_backup_triggers()
        
    def init_db(self):
        """Initialize SQLite database with WAL mode for better concurrency"""
        with sqlite3.connect(self.db_path) as conn:
            # Enable WAL mode for better persistence
            conn.execute('PRAGMA journal_mode=WAL')
            conn.execute('PRAGMA synchronous=NORMAL')
            conn.execute('PRAGMA cache_size=10000')
            conn.execute('PRAGMA temp_store=memory')
            
            # Create tables
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
                    access_count INTEGER DEFAULT 0,
                    cached_path TEXT,
                    is_persistent INTEGER DEFAULT 1
                )
            ''')
            
            conn.execute('''
                CREATE TABLE IF NOT EXISTS app_metadata (
                    key TEXT PRIMARY KEY,
                    value TEXT,
                    updated_at TEXT
                )
            ''')
            
            # Indexes for performance
            conn.execute('CREATE INDEX IF NOT EXISTS idx_type ON media_files(type)')
            conn.execute('CREATE INDEX IF NOT EXISTS idx_date_added ON media_files(date_added)')
            conn.execute('CREATE INDEX IF NOT EXISTS idx_access_count ON media_files(access_count)')
            conn.execute('CREATE INDEX IF NOT EXISTS idx_persistent ON media_files(is_persistent)')
            
    def _create_backup_triggers(self):
        """Create database triggers for automatic backups"""
        with sqlite3.connect(self.db_path) as conn:
            # Trigger to update metadata on changes
            conn.execute('''
                CREATE TRIGGER IF NOT EXISTS update_metadata_on_insert
                AFTER INSERT ON media_files
                BEGIN
                    INSERT OR REPLACE INTO app_metadata (key, value, updated_at)
                    VALUES ('last_file_added', NEW.id, datetime('now'));
                END
            ''')
            
            conn.execute('''
                CREATE TRIGGER IF NOT EXISTS update_metadata_on_access
                AFTER UPDATE ON media_files
                WHEN NEW.last_accessed != OLD.last_accessed
                BEGIN
                    INSERT OR REPLACE INTO app_metadata (key, value, updated_at)
                    VALUES ('last_accessed', NEW.id, datetime('now'));
                END
            ''')
    
    def save_metadata(self, key: str, value: Any):
        """Save metadata to database"""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute('''
                INSERT OR REPLACE INTO app_metadata (key, value, updated_at)
                VALUES (?, ?, ?)
            ''', (key, str(value), datetime.now().isoformat()))
    
    def get_metadata(self, key: str) -> Optional[str]:
        """Get metadata from database"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute('SELECT value FROM app_metadata WHERE key = ?', (key,))
            row = cursor.fetchone()
            return row[0] if row else None

# Heartbeat system to prevent idle shutdown
class HeartbeatManager:
    def __init__(self, interval: int = 300):  # 5 minutes
        self.interval = interval
        self.running = False
        
    async def start_heartbeat(self):
        """Start heartbeat to keep container alive"""
        self.running = True
        heartbeat_file = Path("./data/heartbeat.txt")
        
        while self.running:
            try:
                # Update heartbeat file
                with open(heartbeat_file, 'w') as f:
                    f.write(f"alive:{datetime.now().isoformat()}")
                
                # Log to keep container active
                print(f"Heartbeat: {datetime.now().strftime('%H:%M:%S')}")
                
                await asyncio.sleep(self.interval)
                
            except Exception as e:
                print(f"Heartbeat error: {e}")
                await asyncio.sleep(60)
    
    def stop_heartbeat(self):
        """Stop heartbeat"""
        self.running = False

# Auto-save functionality
class AutoSaveManager:
    def __init__(self, persistence_manager: PersistenceManager, interval: int = 600):  # 10 minutes
        self.persistence = persistence_manager
        self.interval = interval
        self.data_to_save = {}
        
    def register_data(self, key: str, data: Any):
        """Register data for auto-saving"""
        self.data_to_save[key] = data
        
    async def start_auto_save(self):
        """Start auto-save loop"""
        while True:
            try:
                if self.data_to_save:
                    # Save current state
                    state = {
                        'timestamp': datetime.now().isoformat(),
                        'data': self.data_to_save.copy()
                    }
                    self.persistence.save_app_state(state)
                
                await asyncio.sleep(self.interval)
                
            except Exception as e:
                print(f"Auto-save error: {e}")
                await asyncio.sleep(60)
