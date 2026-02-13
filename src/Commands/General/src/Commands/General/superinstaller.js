const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch'); // If not installed, add to package.json later or use global fetch if Node 18+

module.exports = {
  name: 'superinstaller',
  alias: ['i', 'install', 'addplugin'],
  category: 'general',
  desc: 'Install any plugin from a raw URL (.i <url>)',
  async execute(sock, m, args, prefix) {
    try {
      const url = args[0];
      if (!url) return sock.sendMessage(m.key.remoteJid, { text: `Usage: ${prefix}i <raw-url-to-plugin.js>` }, { quoted: m });

      if (!url.startsWith('http')) return sock.sendMessage(m.key.remoteJid, { text: 'Provide a valid URL starting with http/https' }, { quoted: m });

      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to fetch: ${response.statusText}`);

      const pluginCode = await response.text();

      // Decide save path - put in General for now (change if needed)
      const pluginDir = path.join(__dirname, '..', '..', 'Commands', 'General'); // relative from this file
      const fileName = path.basename(url) || 'customplugin.js';
      const filePath = path.join(pluginDir, fileName);

      // Save the file
      fs.writeFileSync(filePath, pluginCode);
      
      sock.sendMessage(m.key.remoteJid, { 
        text: `✅ Plugin installed successfully!\nSaved as: ${fileName}\n\nRestart the bot to load it (or if hot-reload exists, it may load now).` 
      }, { quoted: m });

    } catch (err) {
      console.error(err);
      sock.sendMessage(m.key.remoteJid, { text: `Error installing: ${err.message}` }, { quoted: m });
    }
  }
};
