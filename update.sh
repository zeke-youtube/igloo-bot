#!/usr/bin/env bash
set -e

git pull
docker-compose --profile tunnel up -d --build
