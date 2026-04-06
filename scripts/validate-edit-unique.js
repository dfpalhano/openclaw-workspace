#!/usr/bin/env node
/**
 * Validate edit uniqueness before applying
 * Part of capability-evolver repair strategy
 */

const fs = require('fs');
const path = require('path');

function countOccurrences(content, pattern) {
    if (!content || !pattern) return 0;
    const escapedPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escapedPattern, 'g');
    const matches = content.match(regex);
    return matches ? matches.length : 0;
}

function main() {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        console.error('Usage: node validate-edit-unique.js <file> <pattern>');
        console.error('Example: node validate-edit-unique.js openclaw.json \'"model": "ollama/minimax-m2.5"\'');
        process.exit(1);
    }

    const filePath = args[0];
    const pattern = args[1];

    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const occurrences = countOccurrences(content, pattern);
        
        console.log(`File: ${filePath}`);
        console.log(`Pattern: ${pattern}`);
        console.log(`Occurrences: ${occurrences}`);
        
        if (occurrences === 1) {
            console.log('✅ Pattern is unique - safe to edit');
            process.exit(0);
        } else if (occurrences === 0) {
            console.log('⚠️  Pattern not found');
            process.exit(2);
        } else {
            console.log(`❌ Pattern appears ${occurrences} times - not unique`);
            console.log('Suggestion: Use more context to make pattern unique');
            process.exit(3);
        }
    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { countOccurrences };