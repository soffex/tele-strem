# Hybrid Pyrogram Stremio Addon

A hybrid architecture Stremio addon that streams personal media files from Telegram channels using Pyrogram (MTProto) with intelligent caching and rate limit management.

## Features

- **Direct Telegram Streaming**: Bypasses 20MB Bot API limits using MTProto
- **Smart Caching**: Automatically caches frequently accessed files
- **Rate Limit Management**: Handles concurrent streams without hitting Telegram limits
- **SQLite Database**: Persistent storage of file metadata
- **Background Cleanup**: Automatic cache management
- **Docker Ready**: Easy deployment with docker-compose

## Prerequisites

1. **VPS with Docker and Docker Compose installed**
2. **Telegram API credentials** from https://my.telegram.org
3. **Phone number** for Telegram authentication
4. **Channel IDs** of your personal media channels

## Quick Start

### 1. Get Telegram API Credentials

1. Go to https://my.telegram.org
2. Login with your phone number
3. Go to "API Development Tools"
4. Create a new application:
   - App title: "Personal Media Addon"
   - Short name: "media_addon"
   - Platform: "Desktop"
5. Save your `api_id` and `api_hash`

### 2. Find Your Channel IDs

For private channels, you need the numerical ID:

1. Add @userinfobot to your channel
2. Send any message in the channel
3. The bot will reply with the channel ID (like `-1001234567890`)
4. Remove the bot after getting the ID

### 3. Clone and Setup

```bash
# SSH into your VPS
ssh user@your-vps-ip

# Create project directory
mkdir ~/stremio-telegram-addon
cd ~/stremio-telegram-addon

# Clone your repository or copy files manually
git clone https://github.com/yourusername/your-repo.git .

# Create environment file
cp .env.example .env
nano .env
```

### 4. Configure Environment

Edit `.env` file with your credentials:

```env
API_ID=12345678
API_HASH=your_api_hash_here
PHONE_NUMBER=+1234567890
MONITORED_CHANNELS=-1001234567890,-1001111222333
```

### 5. Deploy

```bash
# Create data directories
mkdir -p data/sessions data/cache data/database

# Build and start the container
docker-compose up -d

# Check logs for first-time authentication
docker-compose logs -f stremio-addon
```

## First-Time Authentication

When you first run the container, Pyrogram will ask for authentication:

```bash
# Watch the logs
docker-compose logs -f stremio-addon

# If you see authentication prompts, run interactively:
docker-compose down
docker-compose run --rm stremio-addon python main.py

# Follow the prompts:
# 1. Confirm your phone number
# 2. Enter the verification code sent to your phone
# 3. Enter 2FA password if you have one
# 4. Once authenticated, press Ctrl+C and restart normally

docker-compose up -d
```

## Verification

1. **Check service health:**
   ```bash
   curl http://your-vps-ip:8080/health
   ```

2. **Check manifest:**
   ```bash
   curl http://your-vps-ip:8080/manifest.json
   ```

3. **View logs:**
   ```bash
   docker-compose logs stremio-addon
   ```

## Configure Stremio

1. Open Stremio
2. Go to Addons section
3. Click "Install from URL"
4. Enter: `http://your-vps-ip:8080/manifest.json`
5. Click Install

## Configuration Options

### Performance Settings

Adjust these in your `.env` file based on your VPS specs:

```env
# Chunk size for streaming (default: 1MB)
CHUNK_SIZE=1048576

# Maximum cache size (default: 5GB)
MAX_CACHE_SIZE=5368709120

# Cache cleanup interval (default: 1 hour)
CACHE_CLEANUP_INTERVAL=3600

# Maximum concurrent downloads (default: 3)
MAX_CONCURRENT_DOWNLOADS=3

# Rate limit delay (default: 1.0 seconds)
RATE_LIMIT_DELAY=1.0
```

### Resource Limits

Modify `docker-compose.yml` for your VPS:

```yaml
deploy:
  resources:
    limits:
      memory: 4G      # Adjust based on your RAM
      cpus: '2.0'     # Adjust based on your CPU
    reservations:
      memory: 1G
      cpus: '0.5'
```

## Directory Structure

```
~/stremio-telegram-addon/
├── main.py                 # Main application
├── requirements.txt        # Python dependencies
├── Dockerfile             # Container definition
├── docker-compose.yml     # Container orchestration
├── .env                   # Environment variables
├── .env.example          # Environment template
├── .dockerignore         # Docker build exclusions
└── data/
    ├── sessions/         # Telegram session files
    ├── cache/           # File cache
    └── database/        # SQLite database
```

## Troubleshooting

### Authentication Issues

```bash
# Check logs for authentication errors
docker-compose logs stremio-addon

# Clear session and re-authenticate
sudo rm -rf data/sessions/*
docker-compose restart stremio-addon
```

### Memory Issues

```bash
# Check container memory usage
docker stats stremio-addon

# Adjust memory limits in docker-compose.yml
```

### Network Issues

```bash
# Check if port is accessible
curl http://localhost:8080/health

# Check firewall (Ubuntu/Debian)
sudo ufw allow 8080

# Check if container is running
docker-compose ps
```

### Cache Issues

```bash
# Check cache size
du -sh data/cache/

# Clear cache manually
sudo rm -rf data/cache/*
docker-compose restart stremio-addon
```

## Monitoring

### View Logs

```bash
# Recent logs
docker-compose logs --tail=100 stremio-addon

# Live logs
docker-compose logs -f stremio-addon
```

### System Status

```bash
# Health check
curl http://your-vps-ip:8080/health

# Container stats
docker stats stremio-addon
```

## Maintenance

### Updates

```bash
# Pull latest code
git pull

# Rebuild and restart
docker-compose build --no-cache
docker-compose up -d
```

### Backup

```bash
# Backup important data
tar -czf telegram-addon-backup.tar.gz data/
```

### Database Maintenance

The SQLite database automatically manages itself, but you can:

```bash
# View database size
ls -lh data/database/media.db

# Access database (if needed)
docker-compose exec stremio-addon sqlite3 /app/data/media.db
```

## Performance Tips

1. **SSD Storage**: Use SSD for better I/O performance
2. **Memory**: Allocate at least 2GB RAM for the container
3. **Network**: Ensure good bandwidth between VPS and Telegram servers
4. **Cache Size**: Adjust based on your available disk space
5. **Concurrent Downloads**: Start with 3, increase if your VPS can handle it

## Security

1. **Firewall**: Only open port 8080 if you need external access
2. **HTTPS**: Use a reverse proxy (nginx) with SSL for production
3. **Access Control**: Consider adding authentication to the addon
4. **Monitoring**: Set up log monitoring and alerts

## Architecture

The addon uses a hybrid architecture:

- **Single Pyrogram client** for metadata operations and file detection
- **Smart caching system** for frequently accessed files
- **Rate limiting** to respect Telegram's API limits
- **SQLite database** for persistent storage
- **Background tasks** for cache cleanup

This design provides the best balance of performance, reliability, and resource usage while staying within Telegram's rate limits.

## Support

If you encounter issues:

1. Check the logs first: `docker-compose logs stremio-addon`
2. Verify your API credentials and channel IDs
3. Ensure your VPS has sufficient resources
4. Check network connectivity to Telegram servers
5. Review the troubleshooting section above
