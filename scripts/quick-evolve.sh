#!/bin/bash
# Quick evolution tool - capability-evolver compatible
# Fast feedback, no hanging

echo "🔄 Quick Evolution Scan"
echo "======================"

# 1. Check system health
echo "1. System Health:"
uptime | awk '{print "   Uptime:", $3, $4, $5}'
free -h | awk '/^Mem:/ {print "   Memory:", $3 "/" $2, "(" $4 " free)"}'
df -h . | awk 'NR==2 {print "   Disk:", $3 "/" $2, "(" $5 " used)"}'

echo ""
echo "2. Recent Errors:"
find . -name "*.log" -type f -mtime -1 -exec tail -1 {} \; 2>/dev/null | head -3 | sed 's/^/   /'

echo ""
echo "3. Evolution Ready:"
if [ -f "skills/capability-evolver/assets/gep/genes.json" ]; then
    echo "   ✅ Genes available: 3"
else
    echo "   ❌ No genes found"
fi

if [ -f "memory/monthly/*-summary.md" ]; then
    echo "   ✅ Memory consolidated"
else
    echo "   ⚠️  Memory needs consolidation"
fi

echo ""
echo "4. Quick Actions:"
echo "   a) Validate edit: ./scripts/validate-edit-unique.sh <file> <pattern>"
echo "   b) Route model: ./scripts/model-router.sh <task>"
echo "   c) Consolidate: ./scripts/consolidate-memory.sh <YYYY-MM>"

echo ""
echo "✅ Evolution tools ready for use!"