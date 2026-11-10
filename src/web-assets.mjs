import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { qrcode } from 'qrcode-generator';

export function qrSvg(link) {
  const code = qrcode(0, 'M');
  code.addData(link);
  code.make();
  return code.createSvgTag(8);
}

export async function serveAsset(response, path, files, screens) {
  const file = files.get(path);
  if (file) {
    const data = await readFile(new URL(`../web/${file[0]}`, import.meta.url));
    response.writeHead(200, { 'Content-Type': file[1] }).end(data);
    return true;
  }
  if (screens && /^\/novnc\/(?:core|vendor)\/(?:[\w-]+\/)*[\w.-]+\.js$/.test(path)) {
    const data = await readFile(join('/usr/share/novnc', path.slice('/novnc/'.length)));
    response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'private, max-age=3600' }).end(data);
    return true;
  }
  return false;
}
