#!/bin/bash
# Infinite Startup Script
# This script starts both the Next.js frontend and Node.js backend.

# Navigate to project directory
cd /home/rey/project/infinite

# Set Node path (NVM version used)
export PATH=/home/rey/.nvm/versions/node/v24.14.0/bin:/home/rey/project/infinite/node_modules/.bin:$PATH

# Ensure Prisma client is generated
npx prisma generate

# Start services
# Next.js is bound to 0.0.0.0 to allow access via Tailscale IP
./node_modules/.bin/concurrently \
  "./node_modules/.bin/next dev -H 0.0.0.0" \
  "./node_modules/.bin/tsx watch server/index.ts"
