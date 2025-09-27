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

# Ad
