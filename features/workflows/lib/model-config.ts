// The model the run's AI steps use, and the key it needs, chosen by
// STAGEHAND_MODEL ("provider/model"). Pure: the task hands it process.env.

// The variable that holds the key for each provider's models.
//
// Google only, on purpose. This project runs on free tiers and has no credit
// anywhere else, so a provider it cannot pay for has no business being
// reachable: leaving one wired up means a stray STAGEHAND_MODEL starts
// spending. A provider that is not in here is refused by name, before a
// session opens. Adding one back is this line plus its key.
const KEY_BY_PROVIDER: Record<string, string> = {
  google: "GEMINI_API_KEY",
}

// Providers that run on this machine. Browserbase's hosted Stagehand API calls
// the model from its own servers, which cannot reach them, so their inference
// stays in the worker, and they take no key. That also means they only work
// where the worker runs next to them, which is `trigger dev`, not a deploy.
const LOCAL_PROVIDERS = new Set(["ollama"])

// A free model, because nothing here is meant to spend money by default, and
// now because it is the only hosted provider wired up at all.
//
// Flash 3.8 rather than 3.5: newer, and 3.5 was seen overloaded here ("This
// model is currently experiencing high demand"), with the Agent giving up
// after 209s — close to the Browserbase session's five-minute limit.
//
// Claude remains one STAGEHAND_MODEL away for anyone who does have credit.
export const DEFAULT_MODEL = "google/gemini-3.8-flash"

export function resolveModel(env: Record<string, string | undefined>) {
  const modelName = env.STAGEHAND_MODEL || DEFAULT_MODEL
  const provider = modelName.split("/")[0]

  if (LOCAL_PROVIDERS.has(provider)) {
    return { model: modelName, disableAPI: true }
  }

  const keyVariable = KEY_BY_PROVIDER[provider]

  if (!keyVariable) {
    throw new Error(
      `No API key is set up for "${provider}" models (STAGEHAND_MODEL=${modelName})`
    )
  }

  const apiKey = env[keyVariable]

  // Checked here because without its key a model only fails mid-run, with
  // "API key not valid".
  if (!apiKey) {
    throw new Error(`${keyVariable} is not set, and ${modelName} needs it`)
  }

  return { model: { modelName, apiKey }, disableAPI: false }
}
