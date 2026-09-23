#!/bin/sh
while true; do
    echo "🐧 Checking GitHub..."

    git fetch origin main

    LOCAL=$(git rev-parse HEAD)
    REMOTE=$(git rev-parse origin/main)

    if [ "$LOCAL" != "$REMOTE" ]; then
        echo "🚀 New IglooBot commit detected!"

        git reset --hard origin/main

        echo "❄️ Running update.sh..."
        ./update.sh
    else
        echo "✅ Already up to date."
    fi

    echo "💤 Checking again in 5 seconds..."
    sleep 5
done