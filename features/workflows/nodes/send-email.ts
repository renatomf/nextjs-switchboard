import { getResend } from "@/lib/resend"

// Resend's sandbox sender. It only delivers to the address on the Resend
// account, so swapping in a verified domain is what this needs before it can
// mail anyone else.
const FROM = "onboarding@resend.dev"

// The one node that touches no browser — it never asks the run for a Stagehand,
// so a workflow of only send-email steps opens no Browserbase session at all.
export async function sendEmail({
  to,
  subject,
  body,
  idempotencyKey,
}: {
  to: string
  subject: string
  body: string
  // The same for every attempt of the step. A send can go out and its answer
  // be lost on the way back; the step then tries again, and Resend, seeing
  // the key it already has, hands back that email instead of sending another.
  idempotencyKey: string
}) {
  // The Resend SDK reports API failures in `error` instead of throwing, so a
  // plain await would sail past a rejected send and leave the step green with no
  // mail delivered. Throwing here is what marks the run failed.
  const { data, error } = await getResend().emails.send(
    { from: FROM, to, subject, text: body },
    { idempotencyKey }
  )

  if (error) {
    // The status rides on the error: it is what tells a rate limit, worth
    // another attempt, from a rejected address, which is not.
    throw Object.assign(new Error(`Resend failed to send: ${error.message}`), {
      statusCode: error.statusCode ?? undefined,
    })
  }

  return { id: data.id }
}
