import { describe, expect, it, vi } from "vitest"

import { createBrowserSession } from "./browser-session"

const makeBrowser = () => ({ close: vi.fn(async () => {}) })

const liveSignal = () => new AbortController().signal

describe("createBrowserSession", () => {
  // A workflow of only send-email steps never needs a browser, and must not
  // pay for one.
  it("opens nothing until a step asks for the browser", async () => {
    const open = vi.fn(async () => makeBrowser())
    const session = createBrowserSession({ open, signal: liveSignal() })

    await session.release()

    expect(open).not.toHaveBeenCalled()
  })

  it("opens the browser once and hands every step the same one", async () => {
    const browser = makeBrowser()
    const open = vi.fn(async () => browser)
    const session = createBrowserSession({ open, signal: liveSignal() })

    const [first, second] = await Promise.all([session.get(), session.get()])

    expect(open).toHaveBeenCalledTimes(1)
    expect(first).toBe(browser)
    expect(second).toBe(browser)
  })

  it("closes the browser once, however many times it is released", async () => {
    const browser = makeBrowser()
    const session = createBrowserSession({
      open: async () => browser,
      signal: liveSignal(),
    })

    await session.get()
    await session.release()
    await session.release()

    expect(browser.close).toHaveBeenCalledTimes(1)
  })

  // Trigger.dev kills the worker soon after a cancel, before the run's
  // finally gets to release anything.
  it("closes the browser as soon as the run is cancelled", async () => {
    const browser = makeBrowser()
    const controller = new AbortController()
    const session = createBrowserSession({
      open: async () => browser,
      signal: controller.signal,
    })

    await session.get()
    controller.abort()

    await vi.waitFor(() => expect(browser.close).toHaveBeenCalledTimes(1))
  })

  // The case the end-to-end test hit: Stop landed while the session was still
  // being created, and the session then stayed open until its timeout.
  it("closes a browser that finishes opening after the run was cancelled", async () => {
    const browser = makeBrowser()
    const controller = new AbortController()
    let finishOpening!: () => void
    const session = createBrowserSession({
      open: () =>
        new Promise<typeof browser>((resolve) => {
          finishOpening = () => resolve(browser)
        }),
      signal: controller.signal,
    })

    const step = session.get()
    controller.abort()
    finishOpening()

    await expect(step).rejects.toThrow("The run was cancelled")
    expect(browser.close).toHaveBeenCalledTimes(1)
  })

  it("refuses to open a browser once the run is cancelled", async () => {
    const open = vi.fn(async () => makeBrowser())
    const controller = new AbortController()
    const session = createBrowserSession({ open, signal: controller.signal })

    controller.abort()

    await expect(session.get()).rejects.toThrow("The run was cancelled")
    expect(open).not.toHaveBeenCalled()
  })

  it("releases cleanly when the browser never managed to open", async () => {
    const session = createBrowserSession({
      open: async () => {
        throw new Error("Unknown error: 402")
      },
      signal: liveSignal(),
    })

    await expect(session.get()).rejects.toThrow("Unknown error: 402")
    await expect(session.release()).resolves.toBeUndefined()
  })

  // The release runs in the run's finally, on the way out of a failed step:
  // a close that threw there would replace the error the run actually hit.
  it("never lets a failed close replace the run's own error", async () => {
    const browser = {
      close: vi.fn(async () => {
        throw new Error("socket hang up")
      }),
    }
    const session = createBrowserSession({
      open: async () => browser,
      signal: liveSignal(),
    })

    await session.get()

    await expect(session.release()).resolves.toBeUndefined()
  })
})
