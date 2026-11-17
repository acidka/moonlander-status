import { test, expect, mock } from 'claude-code/testing'

test('keys follow Claude from idle through a tool call back to idle', async ($, on) => {
  mock.env(on, { HOME: '/home/me' })
  const writes: string[] = []
  on('fs.write', async ($, e) => {
    expect(e.path).toBe('/home/me/.cache/claude-moonlander/state')
    writes.push(e.text.trim())
    return { value: undefined }
  })
  mock.clock(on)
  on('fs.read', async ($, e) => {
    expect(e.path).toBe('/home/me/.cache/claude-moonlander/state.status')
    return { value: `connected ${Math.floor(Date.now() / 1000)}\n` }
  })
  on('command.register', async () => ({ value: {} }))
  on('ui.status', async () => ({ value: undefined }))
  on('ui.log', async () => ({ value: undefined }))
  on('tool.call', async () => ({ result: 'ok' }))
  on('tool.check', async () => ({ decision: 'ask' as const })) // no approver: nobody asked
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  on('turn.start', async ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', async ($, e) => ({ text: e.answer }))

  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  expect(writes).toEqual(['0 255 40 solid 1'])

  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.turn.complete({
    turnId: 't1', answer: 'done', durationMs: 5, isAborted: false, reason: 'answer',
  })

  expect(writes).toEqual([
    '0 255 40 solid 1',     // idle
    '217 90 30 breathe 2',  // thinking
    '0 90 255 solid 3',     // tool
    '217 90 30 breathe 2',  // thinking again
    '0 255 40 solid 1',     // idle
  ])

  const said = await $.command.run({
    command: 'moonlander', args: '', origin: { kind: 'human' },
    presentation: { isFullscreen: false, columns: 120 },
  } as never)
  expect(JSON.stringify(said)).toContain('Moonlander connected')
})

// Permission dialog: tool.check's ask on a real call, settled by a person on
// the main loop.
for (const [label, extra, blinks] of [
  ['the main loop', { tool_use_id: 'u1' }, true],
  ['a subagent', { tool_use_id: 'u1', agentId: 'sub' }, false],
  ['a query (no tool_use_id)', {}, false],
] as const) {
  test(`a permission ask in ${label} ${blinks ? 'blinks' : 'leaves'} the keys`, async ($, on) => {
    mock.env(on, { HOME: '/home/me' })
    const writes: string[] = []
    on('fs.write', async ($, e) => { writes.push(e.text.trim()); return { value: undefined } })
    mock.clock(on)
    on('fs.read', async () => ({ value: `connected ${Math.floor(Date.now() / 1000)}\n` }))
    on('command.register', async () => ({ value: {} }))
    on('ui.status', async () => ({ value: undefined }))
    on('session.start', async ($, e) => ({ cwd: e.cwd }))
    on('tool.check', async () => ({ decision: 'ask' as const }))

    await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
    await $.tool.check({ tool: 'Bash', input: { command: 'rm x' }, approver: 'person', ...extra } as never)
    expect(writes.at(-1) === '255 200 0 blink 4').toBe(blinks)
  })
}
