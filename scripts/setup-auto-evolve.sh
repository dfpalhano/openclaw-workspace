#!/bin/bash
# Setup auto-evolution via cron
# capability-evolver compatible automation

CRON_JOB="0 9 * * * cd /home/diegopalhano/.openclaw/workspace && bash scripts/quick-evolve.sh >> logs/evolution.log 2>&1"

echo "Auto-evolution cron job:"
echo "$CRON_JOB"
echo ""
echo "To install:"
echo "1. crontab -e"
echo "2. Add: $CRON_JOB"
echo "3. Save and exit"
echo ""
echo "Will run daily at 9:00 AM"
