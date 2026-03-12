const fs = require('fs');
let code = fs.readFileSync('/home/diegopalhano/projects/mission-control/server.js', 'utf8');

code = code.replace(/execSync\('systemctl start jess-v2', \{ stdio: 'pipe' \}\);/g, "require('child_process').exec('cd /home/diegopalhano/projects/jess-bot && nohup node jess-v3.js >> /tmp/jess-v3.log 2>&1 &');");
code = code.replace(/execSync\('systemctl stop jess-v2', \{ stdio: 'pipe' \}\);/g, "require('child_process').execSync('pkill -f jess-v3.js || true');");

fs.writeFileSync('/home/diegopalhano/projects/mission-control/server.js', code);
console.log('server.js cmds patched');
