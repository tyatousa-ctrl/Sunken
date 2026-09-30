/** How often a running game asks the server which build it has (ms). */
const CHECK_EVERY = 60_000

/**
 * Notice a newer deploy. The Quest browser keeps tabs alive for days, so a page can go on running an
 * old build long after the server has a new one. Every minute this asks for /version.json (never
 * cached); if the server's build differs from the one running here, `onNewer` is called once.
 */
export function watchForNewBuild(current: string, onNewer: (build: string) => void): void {
  let told = false
  const check = async () => {
    if (told) return
    try {
      const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
      if (!res.ok) return
      const { build } = (await res.json()) as { build?: string }
      if (build && build !== current) {
        told = true
        onNewer(build)
      }
    } catch {
      // Offline or the dev server: try again next time.
    }
  }
  void check()
  setInterval(check, CHECK_EVERY)
  // Coming back to a tab that sat in the background: check straight away.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check()
  })
}
