import { cpSync, mkdirSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(projectRoot, 'node_modules', 'web-ifc')
const destination = join(projectRoot, 'public', 'wasm')

mkdirSync(destination, { recursive: true })

const wasmFiles = readdirSync(source).filter((file) => file.endsWith('.wasm'))

if (wasmFiles.length === 0) {
  throw new Error(`No web-ifc WASM files found in ${source}`)
}

for (const file of wasmFiles) {
  cpSync(join(source, file), join(destination, file))
}

console.log(`Copied ${wasmFiles.length} web-ifc WASM files to public/wasm/`)
