// Keep-alive script to prevent Render free tier from sleeping
// Run this separately or integrate into your main app

const axios = require('axios');

const ADDON_URL = process.env.ADDON_URL || 'https://your-app-name.onrender.com';
const PING_INTERVAL = 14 * 60 * 1000; // 14 minutes (before 15-minute sleep)

console.log(`🔄 Starting keep-alive for ${ADDON_URL}`);
console.log(`⏰ Pinging every ${PING_INTERVAL / 1000 / 60} minutes`);

const pingService = async () => {
    try {
        const response = await axios.get(`${ADDON_URL}/ping`, {
            timeout: 30000 // 30 second timeout
        });
        
        console.log(`✅ Ping successful at ${new Date().toISOString()}`);
        console.log(`📊 Response: ${response.data?.status || 'unknown'}`);
    } catch (error) {
        console.error(`❌ Ping failed at ${new Date().toISOString()}:`, error.message);
        
        // If service is sleeping, try to wake it up by hitting multiple endpoints
        if (error.code === 'ECONNRESET' || error.response?.status === 502) {
            console.log('🔌 Service appears to be sleeping, attempting to wake up...');
            
            try {
                await axios.get(`${ADDON_URL}/health`, { timeout: 60000 });
                console.log('✅ Service woke up successfully');
            } catch (wakeError) {
                console.error('❌ Failed to wake up service:', wakeError.message);
            }
        }
    }
};

// Initial ping
pingService();

// Set up interval
setInterval(pingService, PING_INTERVAL);

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Keep-alive script stopped');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Keep-alive script terminated');
    process.exit(0);
});

console.log('🚀 Keep-alive script started. Press Ctrl+C to stop.');
