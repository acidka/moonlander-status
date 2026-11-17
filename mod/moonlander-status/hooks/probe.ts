import type { EngineInterface, Register } from 'claude-code'

// TEMPORARY: logs the signals that might tell a real permission dialog from
// an ask the auto-mode classifier settles, to
// ~/.cache/claude-moonlander/probe.log. Remove once a signal is chosen.

let logFile: string | undefined
const lines: string[] = []
const last = new Map<string, string>()

export async function log($: EngineInterface, text: string) {
  if (logFile === undefined) return
  lines.push(`${new Date().toISOString().slice(11, 23)} ${text}`)
  if (lines.length > 600) lines.splice(0, lines.length - 600)
  try { await $.fs.write(logFile, lines.join('\n') + '\n') } catch { /* probe only */ }
}

// Logs only when a key's value changes, so renders don't flood the file.
async function logChange($: EngineInterface, key: string, value: string) {
  if (last.get(key) === value) return
  last.set(key, value)
  await log($, `${key} ${value}`)
}

export async function init($: EngineInterface) {
  logFile = `${(await $.env.get('HOME')) ?? '/tmp'}/.cache/claude-moonlander/probe.log`
  await log($, '--- session start')
}

export const register: Register = on => {
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    await logChange($, `hint.${e.surface}`, JSON.stringify(e.props))
    return next(e)
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    await logChange($, `modes.${e.surface}`, JSON.stringify(e.props))
    return next(e)
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const p = e.props as { tool: string, isRunning: boolean, isErrored: boolean }
    await logChange($, `row.${e.requestId}`, `${p.tool} running=${p.isRunning} errored=${p.isErrored}`)
    return next(e)
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const p = e.props as { mode: string, message: string | null }
    await logChange($, `spinner.${e.surface}`, `${p.mode} ${p.message ?? ''}`)
    return next(e)
  })
}
