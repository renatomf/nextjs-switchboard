// All the session needs of a browser: a way to let it go. Stagehand fits, and
// so does a test double.
type Closable = { close(): Promise<void> }

// The run's one browser: opened on the first step that asks for it and shared
// by every step after, so the recording spans the whole flow. Released exactly
// once, by the run's finally or the moment the run is cancelled, whichever
// comes first. The cancel cannot wait for the finally: Trigger.dev kills the
// worker soon after, and a session nobody closes stays open, and billed, until
// Browserbase times it out.
// How long beforeClose gets before the browser is closed regardless. The
// session bills by the second, so nothing is allowed to hold it open: whatever
// the callback was reading is worth less than the session it would keep alive.
const BEFORE_CLOSE_TIMEOUT_MS = 10_000

export function createBrowserSession<Browser extends Closable>({
  open,
  signal,
  beforeClose,
}: {
  open: () => Promise<Browser>
  // Aborted by Trigger.dev when the run is cancelled.
  signal: AbortSignal
  // A last look at the browser before it goes, for something only it can
  // answer — the models' token counts, which live on the Stagehand instance.
  // It gets BEFORE_CLOSE_TIMEOUT_MS and its failure is swallowed: this runs in
  // the run's finally, where a throw would replace the error the run actually
  // hit, and the accounting is never worth a broken run.
  beforeClose?: (browser: Browser) => Promise<void>
}) {
  let opening: Promise<Browser> | undefined
  let releasing: Promise<void> | undefined

  const isOver = () => signal.aborted || releasing !== undefined
  const whyOver = () =>
    new Error(
      signal.aborted
        ? "The run was cancelled"
        : "The run's browser was already released"
    )

  // Best-effort, like Stagehand's own close. It runs in the run's finally,
  // where a throw would replace the error the run actually hit.
  const closeQuietly = async (browser: Browser) => {
    if (beforeClose) {
      let timer: ReturnType<typeof setTimeout> | undefined

      // Whichever comes first. The callback swallows its own failure, so the
      // race only ever settles; the timer is the guard against it hanging.
      await Promise.race([
        beforeClose(browser).catch(() => {}),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, BEFORE_CLOSE_TIMEOUT_MS)
        }),
      ])

      clearTimeout(timer)
    }

    await browser.close().catch(() => {})
  }

  const get = () => {
    if (isOver()) return Promise.reject(whyOver())

    // The promise is what is shared, not the browser, so two steps asking at
    // once still open a single session.
    opening ??= open().then(async (browser) => {
      // A cancel can land while the session is still being created. Nothing
      // else holds this browser yet, so closing it falls to here.
      if (isOver()) {
        await closeQuietly(browser)
        throw whyOver()
      }
      return browser
    })

    return opening
  }

  const release = () => {
    releasing ??= (async () => {
      // A browser that failed to open, or that the check above already
      // closed, leaves nothing to release.
      const browser = await opening?.catch(() => undefined)
      if (browser) await closeQuietly(browser)
    })()

    return releasing
  }

  signal.addEventListener("abort", () => void release(), { once: true })

  return { get, release }
}
