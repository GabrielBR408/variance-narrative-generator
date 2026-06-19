// Generate the PWA / Apple-touch icon PNGs from the ChiefEO icon master.
// Run with: node scripts/generate-icons.mjs
//
// Prefers an existing raster master at public/icons/chiefeo-icon.png; falls back
// to the vector master (chiefeo-icon.svg) so the icons can always be rebuilt
// crisply at any size. Uses sharp for rasterizing/resizing.
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))
const iconsDir = join(here, '..', 'public', 'icons')

const pngMaster = join(iconsDir, 'chiefeo-icon.png')
const svgMaster = join(iconsDir, 'chiefeo-icon.svg')

const source = existsSync(pngMaster) ? pngMaster : svgMaster
const input = readFileSync(source)

// width × output filename
const targets = [
  [192, 'icon-192.png'],
  [512, 'icon-512.png'],
  [180, 'icon-180.png']
]

for (const [size, name] of targets) {
  await sharp(input)
    .resize(size, size, { fit: 'cover' })
    .png()
    .toFile(join(iconsDir, name))
  console.log(`wrote public/icons/${name} (${size}x${size}) from ${source.endsWith('.svg') ? 'svg' : 'png'} master`)
}

// Also emit a 512px raster master (chiefeo-icon.png) when only the SVG exists,
// so the project carries a raster copy of the mark as required.
if (source === svgMaster) {
  await sharp(input).resize(512, 512, { fit: 'cover' }).png().toFile(pngMaster)
  console.log('wrote public/icons/chiefeo-icon.png (512x512) from svg master')
}
