let shared: AudioContext | undefined
let users = 0
let closing: Promise<void> | undefined

export async function acquireAudio() {
  if (closing) await closing
  if (!shared || shared.state === 'closed') shared = new AudioContext()
  const context = shared
  users++
  let released = false
  return {
    context,
    async release() {
      if (released) return
      released = true
      if (--users > 0) return
      shared = undefined
      if (context.state === 'closed') return
      const done = context.close().catch(() => {})
      closing = done
      await done
      if (closing === done) closing = undefined
    },
  }
}

