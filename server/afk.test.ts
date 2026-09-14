import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { AFK_TIMEOUT_MS, AFK_TIMEOUT_MESSAGE } from '../shared/protocol.ts'

describe('AFK timeout policy', () => {
  it('uses a one hour timeout and a consistent inactivity message', () => {
    assert.equal(AFK_TIMEOUT_MS, 3_600_000)
    assert.equal(AFK_TIMEOUT_MESSAGE, 'You were disconnected for inactivity.')
  })
})
