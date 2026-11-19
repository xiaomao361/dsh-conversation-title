import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import semver from 'semver'

test('host upgrades satisfy the declared minimum without an exact version pin', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  // DSH evaluates engines.dsh with includePrerelease enabled.
  const accepts = version => semver.satisfies(version, manifest.engines.dsh, { includePrerelease: true })
  for (const version of ['0.2.2-rc.3', '0.2.2-rc.5', '0.2.2', '0.2.3-rc.1', '0.3.0-rc.1', '0.3.0']) {
    assert.equal(accepts(version), true, version)
  }
  for (const version of ['0.2.2-rc.2', '0.2.1']) assert.equal(accepts(version), false, version)
})
