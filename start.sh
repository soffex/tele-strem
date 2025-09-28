#!/bin/bash
# Startup script for persistent Telegram Stremio Addon

echo "=== Telegram Stremio Addon Startup ==="
echo "Starting at: $(date)"

# Ensure all required directories exist
mkdir -p /app/sessions /app/cache /app/data

# Set proper permissions
chmod -R 755 /app/sessions /app/cache /app/data

# Create keepalive mechanism
echo "$$" > /app/data/app.pid
echo "$(date)" > /app/data/startup.log

# Function to handle signals for graceful shutdown
cleanup() {
    echo "Received shutdown signal - saving state..."
    echo "$(date): Shutdown initiated" >> /app/data/startup.log
    
    # Give the Python app time to save state
    sleep 5
    
    # Remove PID file
    rm -f /app/data/app.pid
    
    echo "Cleanup completed"
    exit 0
}

# Set up signal handlers
trap cleanup SIGTERM SIGINT

# Start keepalive background process
(
    while [ -f /app/data/app.pid ]; do
        echo "$(date): Keepalive heartbeat" >> /app/data/heartbeat.log
        # Prevent log from growing too large
        if [ -f /app/data/heartbeat.log ]; then
            tail -n 100 /app/data/heartbeat.log > /app/data/heartbeat.log.tmp
            mv /app/data/heartbeat.log.tmp /app/data/heartbeat.log
        fi
        sleep 300  # 5 minutes
    done
) &

KEEPALIVE_PID=$!

# Function to restart app if it crashes
restart_app() {
    echo "$(date): Application crashed, restarting..." >> /app/data/startup.log
    sleep 10  # Wait before restart
}

# Main application loop with auto-restart
while [ -f /app/data/app.pid ]; do
    echo "Starting Python application..."
    echo "$(date): App start attempt" >> /app/data/startup.log
    
    # Start the main application
    python /app/main.py
    
    # If we reach here, the app exited
    APP_EXIT_CODE=$?
    echo "Application exited with code: $APP_EXIT_CODE"
    
    if [ $APP_EXIT_CODE -eq 0 ]; then
        # Clean exit
        echo "$(date): Clean application exit" >> /app/data/startup.log
        break
    else
        # Unexpected exit - restart
        echo "$(date): Unexpected exit (code: $APP_EXIT_CODE)" >> /app/data/startup.log
        restart_app
    fi
done

# Clean up keepalive process
kill $KEEPALIVE_PID 2>/dev/null

echo "=== Startup script completed ==="
