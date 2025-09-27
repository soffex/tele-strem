# 🔧 Troubleshooting Guide

Common issues and solutions for the Telegram Stremio Addon.

---

## 🚨 Common Issues

### 1. "No streams found" in Stremio

#### **Symptoms:**
- Addon installed successfully
- Movies/series found but no streams available
- Empty stream list

#### **Solutions:**

**Check IMDB IDs in your channels:**
```bash
# Your Telegram posts should include IMDB IDs like:
Movie Title (2023)
IMDB: tt1234567
Quality: 1080p
```

**Verify bot permissions:**
1. Ensure ALL bots are **admins** in channels
2. Bots need "Read All Messages" permission
3. Test with @userinfobot in your channels

**Check addon health:**
```bash
curl https://your-app.onrender.com/health

# Expected response:
{
  "status": "ok",
  "channels": 3,
  "bots": 5,
  "cache_size": 25
}
```

**Test bot tokens:**
```bash
# Test each bot token
curl -X GET "https://api.telegram.org/bot<BOT_TOKEN>/getMe"

# Should return bot info, not error
```

---

### 2. Rate Limit Errors

#### **Symptoms:**
- "Too Many Requests" errors
- Slow or failing searches
- Bot usage at maximum in `/health`

#### **Solutions:**

**Add more bot tokens:**
```bash
# Instead of 1-2 bots, use 3-5
TELEGRAM_BOT_TOKENS=token1,token2,token3,token4,token5
```

**Increase delays:**
```bash
RATE_LIMIT_DELAY=1500              # Increase from 1000ms
MAX_REQUESTS_PER_BOT_PER_MINUTE=15 # Decrease from 20
RETRY_DELAY=3000                   # Increase retry delay
```

**Monitor bot usage:**
```bash
# Check current usage
curl https://your-app.onrender.com/health

# Look for bot_stats section
```

---

### 3. Bot Permission Denied

#### **Symptoms:**
- "Chat not found" errors
- "Bot was blocked by the user"
- Empty message responses

#### **Solutions:**

**Verify bot admin status:**
1. Go to each channel → Manage Channel → Administrators
2. Ensure ALL bots are listed as admins
3. Check permissions include "Read Messages"

**Fix bot privacy settings:**
```bash
# Send to @BotFather:
/setprivacy
# Select your bot
# Choose: Disable
```

**Test channel access:**
```bash
# Get channel info with bot
curl -X GET "https://api.telegram.org/bot<BOT_TOKEN>/getChat?chat_id=@yourchannel"

# Should return channel information
```

**Check channel IDs:**
- Public channels: Use `@channelname` format
- Private channels: Use numeric ID like `-1001234567890`
- Get IDs with @userinfobot

---

### 4. Deployment Failures

#### **Symptoms:**
- Build fails during deployment
- Application crashes on start
- Health endpoint not responding

#### **Solutions:**

**Check Node.js version:**
```bash
# Ensure Node.js 16+ or 18+
node --version

# Update if needed:
nvm use 18  # or install latest LTS
```

**Fix dependency issues:**
```bash
# Clear cache and reinstall
rm -rf node_modules package-lock.json
npm cache clean --force
npm install
```

**Check environment variables:**
```bash
# Verify all required variables are set:
echo $TELEGRAM_BOT_TOKENS
echo $TELEGRAM_CHANNELS

# For cloud platforms, check dashboard settings
```

**Review logs:**
```bash
# Render: Check logs in dashboard
# Vercel: vercel logs
# Fly.io: flyctl logs
# Local: npm run dev (check console)
```

---

### 5. Slow Performance

#### **Symptoms:**
- Long search times (>30 seconds)
- Timeouts in Stremio
- High memory usage

#### **Solutions:**

**Optimize bot configuration:**
```bash
# Use more bots for parallel processing
TELEGRAM_BOT_TOKENS=bot1,bot2,bot3,bot4,bot5

# Reduce delays for faster processing
RATE_LIMIT_DELAY=800
```

**Adjust cache settings:**
```bash
# Increase cache duration
CACHE_TTL=7200000  # 2 hours instead of 1

# Check cache effectiveness at /health
```

**Limit search scope:**
```bash
# In code, you can modify searchChannel function to:
# - Limit message count per channel
# - Skip very old messages
# - Cache channel message lists
```

**Platform-specific optimizations:**
- **Render**: Upgrade to paid plan for no sleep
- **Vercel**: Consider switching to Render for long-running processes  
- **Fly.io**: Scale to multiple VMs

---

### 6. Stremio Integration Issues

#### **Symptoms:**
- Addon not appearing in Stremio
- "Failed to install addon" error
- Manifest URL not working

#### **Solutions:**

**Check manifest URL:**
```bash
# Test manifest endpoint
curl https://your-app.onrender.com/manifest.json

# Should return valid JSON:
{
  "id": "org.telegram.streams",
  "version": "1.0.0",
  "name": "Telegram Streams",
  ...
}
```

**Verify HTTPS:**
- Stremio requires HTTPS for remote addons
- Use deployment platforms with SSL (Render, Vercel, etc.)
- For local testing, use localhost (HTTP is allowed)

**Check CORS headers:**
```bash
# Test CORS from browser console:
fetch('https://your-app.onrender.com/manifest.json')
  .then(r => r.json())
  .then(console.log)
```

**Reinstall addon:**
1. Remove addon from Stremio
2. Clear browser cache
3. Reinstall with fresh URL

---

### 7. Memory/Resource Issues

#### **Symptoms:**
- Application crashes with "out of memory"
- Slow response times
- Platform resource limits hit

#### **Solutions:**

**Optimize caching:**
```bash
# Reduce cache size
CACHE_TTL=1800000  # 30 minutes instead of 1 hour

# Implement cache size limits in code
```

**Limit concurrent operations:**
```bash
# Reduce parallel bot operations
# Add delays between channel searches
# Implement request queuing
```

**Platform-specific fixes:**
```bash
# Render: Check resource usage in dashboard
# Vercel: Consider function timeout limits
# Fly.io: Scale VM memory
```

---

## 🛠️ Debugging Tools

### 1. Health Endpoint Analysis

```bash
curl https://your-app.onrender.com/health | jq '.'
```

**Interpreting results:**
```json
{
  "status": "ok",           // Should be "ok"
  "channels": 3,            // Number of configured channels
  "cache_size": 127,        // Number of cached items
  "bots": 5,               // Number of bot tokens
  "bot_stats": {
    "bot_1": {
      "requests_this_minute": 15,  // Current usage
      "limit": 20,                 // Maximum per minute
      "reset_time": "..."          // When counter resets
    }
  }
}
```

**Red flags:**
- `status: "error"` - Configuration issue
- `bots: 0` - No bot tokens configured
- `channels: 0` - No channels configured
- `requests_this_minute` near `limit` - Rate limiting

### 2. Configuration Page

Visit: `https://your-app.onrender.com/configure`

**Check for:**
- ✅ Bot tokens configured
- ✅ Channels listed correctly  
- ✅ Bot usage statistics
- ✅ No error messages

### 3. Manual Bot Testing

```bash
# Test bot token validity
curl -X GET "https://api.telegram.org/bot<BOT_TOKEN>/getMe"

# Test channel access
curl -X GET "https://api.telegram.org/bot<BOT_TOKEN>/getChat?chat_id=@yourchannel"

# Get recent messages (limited)
curl -X GET "https://api.telegram.org/bot<BOT_TOKEN>/getUpdates"
```

### 4. Log Analysis

**Look for these patterns:**

**Good logs:**
```
🚀 Telegram Streams Addon running on port 3000
📺 Configured channels: 3  
🤖 Bot tokens: 5
Using bot 1/5 (12/20 requests)
Returning cached results
```

**Problem logs:**
```
Rate limit hit, waiting 30s before retry
Error getting Telegram file URL: 429 Too Many Requests
Bot permission denied for channel @channel
Cache miss for tt1234567-movie
```

---

## 🔍 Advanced Diagnostics

### Test Individual Components

**1. Bot Token Validation:**
```javascript
// Test in browser console or Node.js
const testBot = async (token) => {
  const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
  const data = await response.json();
  console.log(data.ok ? 'Bot OK' : 'Bot Error:', data);
};

testBot('YOUR_BOT_TOKEN');
```

**2. Channel Access Test:**
```javascript
const testChannel = async (token, channel) => {
  const response = await fetch(
    `https://api.telegram.org/bot${token}/getChat?chat_id=${channel}`
  );
  const data = await response.json();
  console.log(data.ok ? 'Channel OK' : 'Channel Error:', data);
};

testChannel('YOUR_BOT_TOKEN', '@yourchannel');
```

**3. Search Simulation:**
```bash
# Test addon stream search
curl -X GET "https://your-app.onrender.com/stream/movie/tt0468569.json"

# Should return stream array or empty array
```

### Performance Monitoring

**Monitor key metrics:**
- Response time to `/health`
- Cache hit rate
- Bot usage distribution  
- Memory usage (if available)
- Error rate in logs

**Set up alerts:**
- Uptime monitoring (UptimeRobot, Pingdom)
- Error tracking (Sentry, LogRocket)
- Performance monitoring (New Relic, DataDog)

---

## 📞 Getting Help

### Before Asking for Help:

1. **Check the basics:**
   - [ ] All bot tokens valid
   - [ ] Bots are channel admins
   - [ ] Environment variables set correctly
   - [ ] Health endpoint returns "ok"

2. **Gather diagnostic info:**
   - Health endpoint response
   - Configuration page screenshot
   - Recent error logs
   - Stremio addon URL

3. **Test with minimal setup:**
   - Use 1 bot and 1 channel
   - Test with known IMDB ID
   - Check with simple content

### Where to Get Help:

1. **GitHub Issues**: [Create detailed issue](https://github.com/YOUR_USERNAME/telegram-stremio-addon/issues)
2. **Community Forums**: Stremio Discord/Reddit
3. **Documentation**: Re-read setup guide
4. **Platform Support**: 
   - Render support for deployment issues
   - Telegram support for API issues

### Issue Template:

```markdown
**Problem Description:**
Brief description of the issue

**Environment:**
- Platform: Render/Vercel/Local
- Bot count: 3
- Channel count: 2

**Health Endpoint Response:**
```json
{paste health response}
```

**Error Logs:**
```
{paste relevant logs}
```

**Steps to Reproduce:**
1. 
2.
3.

**Expected vs Actual Behavior:**
Expected: ...
Actual: ...
```

---

## ✅ Prevention Checklist

**Regular Maintenance:**
- [ ] Monitor health endpoint weekly
- [ ] Check bot usage patterns
- [ ] Update dependencies monthly  
- [ ] Review error logs
- [ ] Test streaming functionality

**Best Practices:**
- [ ] Use 3-5 bot tokens minimum
- [ ] Format channel posts consistently
- [ ] Monitor platform resource usage
- [ ] Keep environment variables secure
- [ ] Document your configuration

**Monitoring Setup:**
- [ ] Uptime monitoring configured
- [ ] Error alerts set up
- [ ] Performance tracking enabled
- [ ] Regular backup schedule
- [ ] Update process documented

With proper setup and monitoring, your Telegram Stremio addon should run smoothly with minimal issues! 🚀
