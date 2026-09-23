import { describe, expect, it } from "vitest"

import { DEFAULT_MODEL, resolveModel } from "./model-config"

describe("resolveModel", () => {
  // The default has to be a model that costs nothing to run. A paid default
  // spends money the moment someone forgets the variable, and this project
  // has no credit for one — every run would fail, and fail late.
  it("runs Gemini with GEMINI_API_KEY when no model is set", () => {
    expect(resolveModel({ GEMINI_API_KEY: "g-key" })).toEqual({
      model: { modelName: DEFAULT_MODEL, apiKey: "g-key" },
      disableAPI: false,
    })
    expect(DEFAULT_MODEL).toMatch(/^google\//)
  })

  it("treats an empty STAGEHAND_MODEL as unset", () => {
    expect(
      resolveModel({ STAGEHAND_MODEL: "", GEMINI_API_KEY: "g-key" })
    ).toMatchObject({ model: { modelName: DEFAULT_MODEL } })
  })

  it("hands a Gemini model the Gemini key", () => {
    expect(
      resolveModel({
        STAGEHAND_MODEL: "google/gemini-3.5-flash",
        GEMINI_API_KEY: "g-key",
        CLAUDE_API_KEY: "c-key",
      })
    ).toEqual({
      model: { modelName: "google/gemini-3.5-flash", apiKey: "g-key" },
      disableAPI: false,
    })
  })

  // Browserbase's hosted Stagehand API calls the model from its own servers,
  // which cannot reach an Ollama on this machine: inference has to stay in the
  // worker, and a local model takes no key.
  it("runs an Ollama model in the worker, with no key", () => {
    expect(resolveModel({ STAGEHAND_MODEL: "ollama/qwen3:8b" })).toEqual({
      model: "ollama/qwen3:8b",
      disableAPI: true,
    })
  })

  // Without its key, a model only fails mid-run with "API key not valid".
  it("names the missing key instead of starting without it", () => {
    expect(() => resolveModel({})).toThrow("GEMINI_API_KEY is not set")
    expect(() =>
      resolveModel({ STAGEHAND_MODEL: "anthropic/claude-opus-4-8" })
    ).toThrow("CLAUDE_API_KEY is not set")
  })

  it("refuses a provider it has no key for", () => {
    expect(() =>
      resolveModel({ STAGEHAND_MODEL: "openai/gpt-5", OPENAI_API_KEY: "o" })
    ).toThrow('No API key is set up for "openai" models')
  })
})
