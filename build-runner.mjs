#!/usr/bin/env node
import { build } from 'esbuild'
import { existsSync, readFileSync } from 'fs'

const manifest = JSON.parse(readFileSync('./manifest.json', 'utf8'))
const pluginId = manifest.id
const entry = './src/runner.ts'

if (!existsSync(entry)) {
  console.log('No runner.ts — skipping')
  process.exit(0)
}

await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: `dist/${pluginId}-runner.js`,
  external: [
    'node:*','fs','path','os','http','https','net','crypto',
    'child_process','worker_threads','stream','events','util',
    'url','buffer','readline','tty','assert','zlib',
    '@voiden/executors','@voiden/sdk','electron',
  ],
  minify: true,
})
console.log(`Built dist/${pluginId}-runner.js`)
