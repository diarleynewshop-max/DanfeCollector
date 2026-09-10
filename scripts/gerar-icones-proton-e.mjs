import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';

const brandDir = path.join(process.cwd(), 'public', 'brand');
const markSvg = path.join(brandDir, 'proton-e-mark.svg');
const svgBuffer = await fs.readFile(markSvg);

const targets = [
  { file: path.join(brandDir, 'proton-e-mark-32.png'), size: 32 },
  { file: path.join(brandDir, 'proton-e-mark-192.png'), size: 192 },
  { file: path.join(brandDir, 'proton-e-mark-512.png'), size: 512 },
  { file: path.join(brandDir, 'proton-e-apple-touch.png'), size: 180 },
];

for (const { file, size } of targets) {
  await sharp(svgBuffer, { density: 384 }).resize(size, size).png().toFile(file);
  console.log('gerado', file);
}

// favicon.ico com um único frame PNG de 48x48 (formato ICO moderno aceita PNG embutido)
const icoPngSize = 48;
const icoPng = await sharp(svgBuffer, { density: 384 }).resize(icoPngSize, icoPngSize).png().toBuffer();

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type = icon
header.writeUInt16LE(1, 4); // 1 image

const entry = Buffer.alloc(16);
entry.writeUInt8(icoPngSize, 0); // width
entry.writeUInt8(icoPngSize, 1); // height
entry.writeUInt8(0, 2); // palette
entry.writeUInt8(0, 3); // reserved
entry.writeUInt16LE(1, 4); // color planes
entry.writeUInt16LE(32, 6); // bits per pixel
entry.writeUInt32LE(icoPng.length, 8); // image size
entry.writeUInt32LE(6 + 16, 12); // offset

const ico = Buffer.concat([header, entry, icoPng]);
await fs.writeFile(path.join(process.cwd(), 'public', 'favicon.ico'), ico);
console.log('gerado public/favicon.ico');
