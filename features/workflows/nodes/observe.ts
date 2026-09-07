import type { Stagehand } from "@browserbasehq/stagehand"

// Finds the elements on the page that an instruction could act on, without
// touching any of them. Useful on its own to inspect a page, and as the planning
// half of the observe-then-act pattern: a later node can take a selector from
// here and act on it deterministically.
export async function observe({
  stagehand,
  instruction,
}: {
  stagehand: Stagehand
  instruction: string
}) {
  const results = await stagehand.observe(instruction)

  // Candidates also carry method and arguments, dropped here so what a
  // downstream node sees stays small and stable.
  const matches = results.map(({ selector, description }) => ({
    selector,
    description,
  }))

  return { matches }
}
