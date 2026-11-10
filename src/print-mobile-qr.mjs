import { get } from 'node:http';
import { setTimeout } from 'node:timers/promises';

const origin = new URL(process.env.IDLEBOT_ORIGIN);
const authorization = `Basic ${Buffer.from(`idlebot:${process.env.IDLEBOT_PASSWORD}`).toString('base64')}`;

function requestQr() {
  return new Promise((resolve, reject) => {
    const request = get({ hostname: '127.0.0.1', port: 4096, path: '/mobile-qr.svg',
      headers: { host: origin.host, authorization } }, async (response) => {
      try {
        let svg = '';
        for await (const chunk of response) svg += chunk;
        if (response.statusCode === 503) return resolve(null);
        if (response.statusCode !== 200 || !svg.startsWith('<svg')) throw new Error('QR indisponível no painel.');
        resolve(svg);
      } catch (error) { reject(error); }
    });
    request.setTimeout(5000, () => request.destroy(new Error('O painel não respondeu.')));
    request.on('error', reject);
  });
}

const deadline = Date.now() + 75_000;
let qr;
do {
  qr = await requestQr();
  if (qr) break;
  await setTimeout(2000);
} while (Date.now() < deadline);
if (!qr) throw new Error('O monitor do celular ainda está conectando. Abra QR do celular no painel para acompanhar.');
process.stdout.write(qr);
