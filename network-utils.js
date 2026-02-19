const os = require('os');

function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Skip internal and non-IPv4 addresses
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push({
          address: iface.address,
          interface: name
        });
      }
    }
  }

  return ips;
}

function getLocalIP() {
  const ips = getLocalIPs();
  return ips.length > 0 ? ips[0].address : '127.0.0.1';
}

module.exports = {
  getLocalIPs,
  getLocalIP
};