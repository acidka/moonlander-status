import type { EngineInterface, Register } from 'claude-code'

// What the keys show for each of Claude's states: r, g, b, effect.
// The firmware draws the effect, so a color change here needs no reflash.
const STATES = {
  idle: { id: 1, rgb: [0, 255, 40], effect: 'solid' },        // your turn
  thinking: { id: 2, rgb: [217, 90, 30], effect: 'breathe' }, // Claude orange
  tool: { id: 3, rgb: [0, 90, 255], effect: 'solid' },        // running a tool
  waiting: { id: 4, rgb: [255, 200, 0], effect: 'blink' },    // needs your answer
  error: { id: 5, rgb: [255, 0, 0], effect: 'solid' },
} as const

type State = keyof typeof STATES | 'clear'

// Tools that are a question to the person rather than work.
const ASKS_PERSON = new Set(['AskUserQuestion', 'ExitPlanMode'])

let stateFile: string | undefined
let current: State | undefined
let toolsRunning = 0

// Writes the state file the watcher pushes to the keyboard; skips repeats.
async function show($: EngineInterface, state: State) {
  if (state === current || stateFile === undefined) return
  current = state
  const line = state === 'clear'
    ? 'clear'
    : `${STATES[state].rgb.join(' ')} ${STATES[state].effect} ${STATES[state].id}`
  try {
    await $.fs.write(stateFile, `${line}\n`)
  } catch (err) {
    $.ui.log(`moonlander: could not write ${stateFile}: ${String(err)}`, { to: 'debug' })
  }
}

// The keyboard is driven by a watcher outside Claude Code (a LaunchAgent,
// bin/install_agent.sh): Claude Code's sandbox cannot open the HID device.
// The watcher writes "<connected|no-keyboard> <unix time>" every 5 s.
type Health = 'connected' | 'no-keyboard' | 'not-running'

async function watcherHealth($: EngineInterface): Promise<Health> {
  if (stateFile === undefined) return 'not-running'
  try {
    const [word, at] = (await $.fs.read(`${stateFile}.status`)).trim().split(' ')
    const age = Date.now() / 1000 - Number(at)
    if (!(age < 20)) return 'not-running'
    return word === 'connected' ? 'connected' : 'no-keyboard'
  } catch {
    return 'not-running'
  }
}

const HEALTH_TEXT: Record<Health, string> = {
  'connected': 'Moonlander connected: the watcher is pushing Claude status to the keyboard.',
  'no-keyboard': 'The watcher runs, but the Moonlander is not answering (unplugged, or firmware without claude_status).',
  'not-running': 'The Moonlander watcher is not running. Install it with: ! <repo>/mod/moonlander-status/bin/install_agent.sh',
}

async function showHealth($: EngineInterface) {
  const health = await watcherHealth($)
  $.ui.status(health === 'connected' ? undefined : health === 'no-keyboard' ? '⌨ Moonlander not answering' : '⌨ Moonlander watcher not running')
  return health
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const home = (await $.env.get('HOME')) ?? '/tmp'
    stateFile = `${home}/.cache/claude-moonlander/state`
    current = undefined
    await show($, 'idle')

    await showHealth($)
    $.clock.every(30_000, () => { void showHealth($) })

    await $.command.register({
      name: 'moonlander',
      description: 'Says whether the Moonlander watcher runs and the keyboard answers.',
    })
    return started
  })

  on('command.run', { command: 'moonlander' }, async $ => ({ text: HEALTH_TEXT[await showHealth($)] }))

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      toolsRunning = 0
      await show($, 'thinking')
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    toolsRunning++
    await show($, ASKS_PERSON.has(String(e.tool)) ? 'waiting' : 'tool')
    try {
      return await next(e)
    } finally {
      toolsRunning = Math.max(0, toolsRunning - 1)
      await show($, toolsRunning > 0 ? 'tool' : 'thinking')
    }
  })

  // The permission dialog is about to open. tool.check resolves the verdict
  // right before the dialog, so the keys blink as it appears. The permission
  // mode is not read: the engine has no getter, and the classic events that
  // carry it are often passed over by security plugins above this one. So in
  // auto mode an ask the classifier then settles blinks too.
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (verdict.decision === 'ask' && e.agentId === undefined && e.approver === 'person') {
      await show($, 'waiting')
    }
    return verdict
  })

  // Fallback for a dialog tool.check did not see. Claude Code sends this
  // notification only after ~6 s without input, so it is late and not the
  // main signal.
  on('classic.Notification', async ($, e, next) => {
    if (e.notification_type === 'permission_prompt' && e.agent_id === undefined) {
      await show($, 'waiting')
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      toolsRunning = 0
      await show($, e.reason === 'error' || e.reason === 'refusal' ? 'error' : 'idle')
    }
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await show($, 'clear')
    return next(e)
  })
}
