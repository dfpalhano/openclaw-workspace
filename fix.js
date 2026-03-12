const fs = require('fs');
let c = fs.readFileSync('/home/diegopalhano/projects/jess-bot/jess-v3.js', 'utf8');
c = c.replace('callbackServer = http.createServer((req, res) => {', 'callbackServer = http.createServer(async (req, res) => {');
fs.writeFileSync('/home/diegopalhano/projects/jess-bot/jess-v3.js', c);
