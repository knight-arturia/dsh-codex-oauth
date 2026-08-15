// Assemble the published entry points: tsc emits lib/types/*, then the flat
// ESM entries (lib/index.js, lib/invariant.js) are copied beside them, the
// same layout the package's exports map declares.
import { cpSync, mkdirSync } from 'node:fs'
import { execSync } from 'node:child_process'

execSync('tsc -p tsconfig.json', { stdio: 'inherit' })
mkdirSync('lib', { recursive: true })
for (const name of ['index', 'invariant']) {
  cpSync(`lib/types/${name}.js`, `lib/${name}.js`)
}
console.log('build: lib/index.js and lib/invariant.js assembled')
