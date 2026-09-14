// The model the run's AI steps use, and the key it needs, chosen by
// STAGEHAND_MODEL ("provider/model"). Pure: the task hands it process.env.

// The variable that holds the key for each provider's models.
const KEY_BY_PROVIDER: Record<string, string> = {
  google: "GEMINI_API_KEY",
  anthropic: "CLAUDE_API_KEY",
}

// Providers that run on this machine. Browserbase's hosted Stagehand API calls
// the model from its own servers, which cannot reach them, so their inference
// stays in the worker, and they take no key. That also means they only work
// where the worker runs next to them, which is `trigger dev`, not a deploy.
const LOCAL_PROVIDERS = new Set(["ollama"])

// Gemini, on a key of the org's own. It is one of the models Stagehand's agent
// lists; a keyless Gemini is what failed every agent step from 2026-09-08.
export const DEFAULT_MODEL = "google/gemini-3.5-flash"

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
