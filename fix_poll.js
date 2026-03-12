const fs = require('fs');
let c = fs.readFileSync('/home/diegopalhano/projects/jess-bot/jess-v3.js', 'utf8');

c = c.replace("log('─── Poll cycle: pushing convos to MC inbox ───');", "log('─── Poll cycle: pushing convos to MC inbox ───');\n      await checkRelayJam();");

fs.writeFileSync('/home/diegopalhano/projects/jess-bot/jess-v3.js', c);
