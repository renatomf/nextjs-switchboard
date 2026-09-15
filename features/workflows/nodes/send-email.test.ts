import { beforeEach, describe, expect, it, vi } from "vitest"

import { sendEmail } from "./send-email"

const { send } = vi.hoisted(() => ({ send: vi.fn() }))

vi.mock("@/lib/resend", () => ({ getResend: () => ({ emails: { send } }) }))

const email = {
  to: "someone@example.com",
  subject: "Report",
  body: "Done.",
  idempotencyKey: "run_1:email",
}

describe("sendEmail", () => {
  beforeEach(() => {
    send.mockResolvedValue({ data: { id: "email_1" }, error: null })
  })

  it("sends the email and returns its id", async () => {
    await expect(sendEmail(email)).resolves.toEqual({ id: "email_1" })
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "someone@example.com",
        subject: "Report",
        text: "Done.",
      }),
      expect.anything()
    )
  })

  // The step can be tried again after a send whose answer was lost. With the
  // same key, Resend hands back the first email instead of sending another.
  it("sends it under the step's idempotency key", async () => {
    await sendEmail(email)

    expect(send).toHaveBeenCalledWith(expect.anything(), {
      idempotencyKey: "run_1:email",
    })
  })

  // Resend answers a failure instead of throwing it. The status goes on the
  // error, so whether to try again can be decided from it.
  it("fails with Resend's message and status", async () => {
    send.mockResolvedValue({
      data: null,
      error: {
        name: "rate_limit_exceeded",
        message: "Too many requests",
        statusCode: 429,
      },
    })

    await expect(sendEmail(email)).rejects.toMatchObject({
      message: "Resend failed to send: Too many requests",
      statusCode: 429,
    })
  })
})
