export type Game = { home: number; away: number; scrimmage: number; offenseHome: boolean }

declare module 'claude-code' {
  interface PluginState {
    thanksgiving: {
      /** Context window fill, 0 to 100. */
      percent: number
      /** Animation tick for the fireplace and the TV. */
      frame: number
      /** The football game on TV. */
      game: Shaped<Game>
    }
  }
}
