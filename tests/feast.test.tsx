import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'thanksgiving',
  component: 'Pane',
  requestId: 'thanksgiving-den',
  props: {
    title: 'Thanksgiving',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

test('the feast shrinks as the context fills', async ($, on) => {
  on('command.register', () => ({ value: { command: 'thanksgiving' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [] } }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('theme.set', () => ({ value: { isDrawn: true, requestId: 'b' } }))
  on('clock.every', () => ({ value: undefined }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /100% of the feast left/ })) !== undefined).toBe(true)
    await ui.unmount()
  }

  await $.session.measure({ context: { window: 200000, tokens: 120000, percent: 60 }, rateLimits: [], changed: ['context'] })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /40% of the feast left/ })) !== undefined).toBe(true)
  await ui.unmount()
})
