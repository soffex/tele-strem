# 🚀 Complete Deployment Guide

This guide covers all deployment methods for the Telegram Stremio Addon.

---

## 🏆 Render.com Deployment (Recommended - FREE)

### Why Render?
- ✅ **750 hours/month FREE** (25+ days continuous)
- ✅ **Auto-deploy from GitHub** - push to deploy
- ✅ **Built-in SSL certificates**
- ✅ **Easy environment variables**
- ✅ **Automatic restarts and health checks**
- ✅ **No credit card required**

### Step-by-Step Deployment:

#### 1. Prepare Your Repository
```bash
# Fork this repository on GitHub
# Clone your fork locally
git clone https://github.com/YOUR_USERNAME/telegram-stremio-addon.git
cd telegram-stremio-addon
```

#### 2. Sign Up for Render
1. Go to [render.com](https://render.com)
2. Sign up with your GitHub account
3. Authorize Render to access your repositories

#### 3. Create Web Service
1. Click **"New +"** → **"Web Service"**
2. Select **"Build and deploy from a Git repository"**
3. Connect your forked repository
4. Configure service:
   - **Name**: `telegram-stremio-addon`
   - **Region**: Choose closest to you
   - **Branch**: `main`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`

#### 4. Set Environment Variables
In the "Environment" section, add:

```bash
TELEGRAM_BOT_TOKENS=1234567890:ABC...,0987654321:DEF...,5555666677:GHI...
TELEGRAM_CHANNELS=@movies_channel,@series_channel,-1001234567890
NODE_ENV=production
RATE_LIMIT_DELAY=1000
MAX_REQUESTS_PER_BOT_PER_MINUTE=20
```

#### 5. Deploy!
1. Click **"Create Web Service"**
2. Wait for deployment (2-5 minutes)
3. Get your URL: `https://your-app-name.onrender.com`

#### 6. Test Your Deployment
```bash
# Check health
curl https://your-app-name.onrender.com/health

# Expected response:
{
  "status": "ok",
  "channels": 3,
  "bots": 5,
  "cache_size": 0
}
```

#### 7. Auto-Deploy Setup
Render automatically deploys when you push to GitHub:
```bash
# Make changes locally
git add .
git commit -m "Update configuration"
git push origin main
# Render auto-deploys! 🎉
```

---

## 🔄 Vercel Deployment (Great for Serverless)

### Why Vercel?
- ✅ **1 million requests/month FREE**
- ✅ **Instant global deployment**
- ✅ **Excellent for API endpoints**
- ✅ **Zero configuration**

### Deployment Steps:

#### 1. Install Vercel CLI
```bash
npm install -g vercel
```

#### 2. Deploy
```bash
# In your project directory
vercel

# Follow prompts:
# Set up and deploy? Yes
# Which scope? Your username
# Link to existing project? No
# Project name? telegram-stremio-addon
# In which directory is your code located? ./
```

#### 3. Set Environment Variables
```bash
# Add environment variables
vercel env add TELEGRAM_BOT_TOKENS production
# Enter your bot tokens when prompted

vercel env add TELEGRAM_CHANNELS production  
# Enter your channels when prompted

# Redeploy with new variables
vercel --prod
```

#### Alternative: Vercel Dashboard
1. Go to [vercel.com/dashboard](https://vercel.com/dashboard)
2. Click your project
3. Go to "Settings" → "Environment Variables"
4. Add all required variables
5. Redeploy

---

## ✈️ Fly.io Deployment (Advanced)

### Why Fly.io?
- ✅ **3 shared VMs FREE**
- ✅ **Global edge deployment**
- ✅ **Full VM control**
- ✅ **Great performance**

### Deployment Steps:

#### 1. Install Fly CLI
```bash
# macOS
brew install flyctl

# Windows
iwr https://fly.io/install.ps1 -useb | iex

# Linux
curl -L https://fly.io/install.sh | sh
```

#### 2. Login and Initialize
```bash
# Login
flyctl auth login

# Initialize app
flyctl launch
# Follow prompts, don't deploy yet
```

#### 3. Set Environment Variables
```bash
flyctl secrets set TELEGRAM_BOT_TOKENS="token1,token2,token3"
flyctl secrets set TELEGRAM_CHANNELS="@channel1,@channel2"
flyctl secrets set NODE_ENV="production"
```

#### 4. Deploy
```bash
flyctl deploy
```

#### 5. Scale (Optional)
```bash
# Scale to 2 VMs for better reliability
flyctl scale count 2
```

---

## 🐳 Docker Deployment

### Local Docker
```bash
# Build image
docker build -t telegram-stremio-addon .

# Run container
docker run -d \
  -p 3000:3000 \
  -e TELEGRAM_BOT_TOKENS="token1,token2" \
  -e TELEGRAM_CHANNELS="@channel1,@channel2" \
  --name telegram-stremio \
  --restart unless-stopped \
  telegram-stremio-addon

# Check logs
docker logs telegram-stremio
```

### Docker Compose
```bash
# Create .env file with your tokens
cp .env.example .env
nano .env

# Start services
docker-compose up -d

# View logs
docker-compose logs -f

# Update and restart
git pull
docker-compose build
docker-compose up -d
```

### Docker Hub Deployment
```bash
# Build and push
docker build -t yourusername/telegram-stremio-addon .
docker push yourusername/telegram-stremio-addon

# Deploy anywhere
docker run -d \
  -p 3000:3000 \
  -e TELEGRAM_BOT_TOKENS="..." \
  -e TELEGRAM_CHANNELS="..." \
  yourusername/telegram-stremio-addon
```

---

## 🖥️ VPS Deployment (Production)

### Recommended VPS Providers:
- **DigitalOcean** - $5/month droplet
- **Linode** - $5/month nanode  
- **Vultr** - $3.50/month instance
- **Hetzner** - €3.29/month CX11

### VPS Setup:

#### 1. Initial Server Setup
```bash
# Connect to your VPS
ssh root@your-server-ip

# Update system
apt update && apt upgrade -y

# Install Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
apt-get install -y nodejs

# Install additional tools
apt install git nginx certbot python3-certbot-nginx -y

# Create application user
adduser appuser
usermod -aG sudo appuser
su - appuser
```

#### 2. Deploy Application
```bash
# Clone repository
git clone https://github.com/YOUR_USERNAME/telegram-stremio-addon.git
cd telegram-stremio-addon

# Install dependencies
npm install

# Create environment file
nano .env
# Add your configuration

# Install PM2 for process management
sudo npm install -g pm2

# Create PM2 ecosystem file
cat > ecosystem.config.js << EOF
module.exports = {
  apps: [{
    name: 'telegram-stremio',
    script: 'index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '512M',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    }
  }]
}
EOF

# Start application
pm2 start ecosystem.config.js
pm2 startup
pm2 save
```

#### 3. Configure Nginx
```bash
# Create Nginx config
sudo nano /etc/nginx/sites-available/telegram-stremio

# Add this configuration:
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }
    
    location /health {
        proxy_pass http://localhost:3000/health;
        access_log off;
    }
}

# Enable site
sudo ln -s /etc/nginx/sites-available/telegram-stremio /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

#### 4. Setup SSL Certificate
```bash
# Get SSL certificate
sudo certbot --nginx -d your-domain.com

# Test automatic renewal
sudo certbot renew --dry-run

# Check certificate
curl -I https://your-domain.com/health
```

#### 5. Configure Firewall
```bash
# Setup UFW firewall
sudo ufw allow ssh
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

#### 6. Setup Monitoring
```bash
# Create log rotation
sudo nano /etc/logrotate.d/telegram-stremio

# Add content:
/home/appuser/.pm2/logs/*.log {
    daily
    missingok
    rotate 7
    compress
    delaycompress
    notifempty
    copytruncate
    su appuser appuser
}

# Setup system monitoring
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:compress true
```

---

## ☁️ Alternative Free Platforms

### Railway (Limited Free Tier)
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and deploy
railway login
railway init
railway up
```
⚠️ **Note**: Railway only offers $5 one-time credit now.

### Netlify (Functions)
```bash
# Install Netlify CLI
npm install -g netlify-cli

# Create netlify.toml (already included in repo)
# Deploy
netlify deploy --prod --dir .
```

### Heroku (No longer free)
```bash
# Install Heroku CLI
# Create app
heroku create your-app-name

# Set environment variables
heroku config:set TELEGRAM_BOT_TOKENS="token1,token2"
heroku config:set TELEGRAM_CHANNELS="@channel1,@channel2"

# Deploy
git push heroku main
```
⚠️ **Note**: Heroku ended their free tier in November 2022.

---

## 📊 Deployment Comparison

| Platform | Free Tier | Setup Time | Reliability | Best For |
|----------|-----------|------------|-------------|----------|
| **Render** ⭐ | 750hrs/month | 5 minutes | 99.9% | **Production** |
| **Vercel** | 1M requests | 3 minutes | 99.9% | **API-focused** |
| **Fly.io** | 3 VMs | 10 minutes | 99.5% | **Advanced users** |
| **VPS** | Varies | 30 minutes | 99.9% | **Full control** |
| **Docker** | Host cost | 5 minutes | Depends | **Containers** |

---

## 🔧 Post-Deployment Setup

### 1. Verify Deployment
```bash
# Check health endpoint
curl https://your-app.domain.com/health

# Expected response:
{
  "status": "ok",
  "channels": 3,
  "bots": 5,
  "cache_size": 0,
  "bot_stats": {
    "bot_1": {
      "requests_this_minute": 0,
      "limit": 20
    }
  }
}
```

### 2. Test Bot Configuration
```bash
# Check configuration page
curl https://your-app.domain.com/configure

# Should show:
# - Bot tokens configured
# - Channels listed
# - Bot usage statistics
```

### 3. Install in Stremio
1. Copy your manifest URL: `https://your-app.domain.com/manifest.json`
2. Open Stremio
3. Go to Addons → Community Addons
4. Click "Add Addon" or "+"
5. Paste your manifest URL
6. Click "Install"
7. Wait for confirmation

### 4. Test Streaming
1. Search for a movie that exists in your channels
2. Click on the movie
3. Look for streams with "📺" icon (your addon)
4. Click a stream to test playback

---

## 🚨 Troubleshooting Deployments

### Common Issues:

#### Build Failures
```bash
# Check Node.js version
node --version  # Should be 16+ or 18+

# Clear npm cache
npm cache clean --force

# Delete node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
```

#### Environment Variables Not Working
```bash
# Check if variables are set
echo $TELEGRAM_BOT_TOKENS

# For Render: Check Environment tab in dashboard
# For Vercel: Check Project Settings → Environment Variables
# For Fly.io: Use `flyctl secrets list`
```

#### Health Check Failing
```bash
# Test locally
curl http://localhost:3000/health

# Check logs
# Render: View logs in dashboard
# Vercel: `vercel logs`
# Fly.io: `flyctl logs`
# VPS: `pm2 logs telegram-stremio`
```

#### Bot Permission Errors
```bash
# Test bot tokens manually
curl -X GET "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getMe"

# Should return bot information
# If error, check token with @BotFather
```

#### Rate Limit Issues
```bash
# Check bot usage at /health endpoint
curl https://your-app.domain.com/health

# If bots hitting limits:
# - Add more bot tokens
# - Increase RATE_LIMIT_DELAY
# - Decrease MAX_REQUESTS_PER_BOT_PER_MINUTE
```

### Getting Help:
1. 📊 Check application logs
2. 🔍 Test individual components
3. 📋 Review environment variables
4. 🤔 Compare with working deployments
5. 🐛 Create GitHub issue with logs

---

## 🔄 Updates and Maintenance

### Updating Your Deployment:

#### Render (Auto-deploy)
```bash
# Just push to GitHub
git add .
git commit -m "Update addon"
git push origin main
# Render automatically deploys!
```

#### Vercel
```bash
# Auto-deploy on git push, or manual:
vercel --prod
```

#### Fly.io
```bash
# Deploy updates
flyctl deploy
```

#### VPS/Docker
```bash
# Pull updates
git pull origin main

# Restart application
pm2 restart telegram-stremio

# Or with Docker
docker-compose pull
docker-compose up -d
```

### Monitoring Your Deployment:
- Set up uptime monitoring (UptimeRobot, Pingdom)
- Monitor `/health` endpoint regularly
- Check logs for errors
- Update dependencies monthly
- Backup configuration files

---

## 🎉 Success Checklist

- [ ] ✅ Repository forked and cloned
- [ ] 🤖 Multiple bots created (3-5 recommended)
- [ ] 📺 Bots added to channels as admins
- [ ] ☁️ Platform chosen and account created
- [ ] 🔧 Environment variables configured
- [ ] 🚀 Application deployed successfully
- [ ] 🏥 Health endpoint returning "ok"
- [ ] 📱 Addon installed in Stremio
- [ ] 🎬 Test streams working
- [ ] 📊 Monitoring set up

**Congratulations! Your Telegram Stremio addon is live!** 🎊

---

## 💡 Pro Tips

### Performance Optimization:
- Use **5 bot tokens** for maximum speed
- Set `RATE_LIMIT_DELAY=800` for faster requests
- Deploy in region closest to your users
- Use CDN if serving global users

### Security Best Practices:
- Never commit `.env` files to Git
- Rotate bot tokens periodically
- Use environment variables for all secrets
- Enable HTTPS/SSL in production
- Monitor for unusual activity

### Cost Optimization:
- Start with free tiers
- Monitor usage and scale accordingly
- Use auto-sleep features when possible
- Consider VPS for heavy usage (>750hrs/month)

**Happy streaming!** 🚀🎬
