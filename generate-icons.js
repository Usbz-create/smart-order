#!/usr/bin/env node
/**
 * generate-icons.js
 * Generates placeholder PWA icons for Smart Order.
 * Run once: node generate-icons.js
 * Then replace /public/icons/*.png with your real branded icons.
 *
 * Requires: npm install canvas
 */

const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const ICONS_DIR = path.join(__dirname, 'public', 'icons');
fs.mkdirSync(ICONS_DIR, { recursive: true });

function makeIcon(size, maskable = false) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  if (maskable) {
    // Maskable: fill entire canvas (safe zone is center 80%)
    ctx.fillStyle = '#1e2d50';
    ctx.fillRect(0, 0, size, size);
  } else {
    // Regular: rounded rect
    ctx.fillStyle = '#1e2d50';
    const r = size * 0.2;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(size - r, 0);
    ctx.quadraticCurveTo(size, 0, size, r);
    ctx.lineTo(size, size - r);
    ctx.quadraticCurveTo(size, size, size - r, size);
    ctx.lineTo(r, size);
    ctx.quadraticCurveTo(0, size, 0, size - r);
    ctx.lineTo(0, r);
    ctx.quadraticCurveTo(0, 0, r, 0);
    ctx.closePath();
    ctx.fill();
  }

  // Draw emoji in center
  const fontSize = size * 0.45;
  ctx.font = `${fontSize}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🍽️', size / 2, size / 2 + fontSize * 0.05);

  return canvas.toBuffer('image/png');
}

const icons = [
  { name: 'icon-192.png',          size: 192, maskable: false },
  { name: 'icon-512.png',          size: 512, maskable: false },
  { name: 'icon-maskable-192.png', size: 192, maskable: true  },
  { name: 'icon-maskable-512.png', size: 512, maskable: true  },
];

icons.forEach(({ name, size, maskable }) => {
  const buf = makeIcon(size, maskable);
  fs.writeFileSync(path.join(ICONS_DIR, name), buf);
  console.log(`✓ Created ${name}`);
});

console.log('\nIcons saved to public/icons/');
console.log('Replace them with your real branded icons before launch.');
