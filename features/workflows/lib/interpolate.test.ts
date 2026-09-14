import { describe, expect, it } from "vitest"

import { interpolate } from "./interpolate"

// What earlier nodes returned, keyed by node id, the way the run builds it up.
const outputs = {
  n1: { title: "Example Domain", url: "https://example.com" },
  n2: {
    items: [{ name: "first" }, { name: "second" }],
    count: 0,
    ok: false,
    missing: null,
  },
}

describe("interpolate", () => {
  it("leaves text without placeholders untouched", () => {
    expect(interpolate("Click the sign in button", outputs)).toBe(
      "Click the sign in button"
    )
  })

  it("replaces a placeholder with the value at its path", () => {
    expect(interpolate("Title: {{ n1.title }}", outputs)).toBe(
      "Title: Example Domain"
    )
  })

  it("ignores whitespace inside the braces", () => {
    expect(interpolate("{{n1.title}}", outputs)).toBe("Example Domain")
    expect(interpolate("{{   n1.title   }}", outputs)).toBe("Example Domain")
  })

  it("walks into arrays with bracket paths", () => {
    expect(interpolate("{{ n2.items[1].name }}", outputs)).toBe("second")
  })

  it("resolves several placeholders in one field independently", () => {
    expect(interpolate("{{ n1.title }} at {{ n1.url }}", outputs)).toBe(
      "Example Domain at https://example.com"
    )
  })

  it("renders 0 and false as text instead of blanking them", () => {
    expect(interpolate("{{ n2.count }} / {{ n2.ok }}", outputs)).toBe(
      "0 / false"
    )
  })

  it("blanks a placeholder that resolves to nothing", () => {
    expect(interpolate("[{{ unknown.title }}]", outputs)).toBe("[]")
    expect(interpolate("[{{ n1.nope }}]", outputs)).toBe("[]")
    expect(interpolate("[{{ n2.missing }}]", outputs)).toBe("[]")
  })

  it("drops objects and arrays in as JSON", () => {
    expect(interpolate("{{ n2.items[0] }}", outputs)).toBe('{"name":"first"}')
  })

  // Outputs are often text scraped from a page someone else controls. If a
  // value were interpolated again, a page could plant "{{ ... }}" and read out
  // what other nodes produced.
  it("does not re-interpolate a value that itself holds a placeholder", () => {
    const planted = { ...outputs, n3: { text: "{{ n1.url }}" } }

    expect(interpolate("{{ n3.text }}", planted)).toBe("{{ n1.url }}")
  })

  it("leaves an unclosed placeholder as literal text", () => {
    expect(interpolate("{{ n1.title", outputs)).toBe("{{ n1.title")
  })

  // Characterization test, see "Achados" in docs/roadmap.md.
  describe("current gaps", () => {
    it("does not URL-encode a value dropped into a URL", () => {
      const query = { q: { text: "a b&page=2" } }

      expect(
        interpolate("https://example.com/search?q={{ q.text }}", query)
      ).toBe("https://example.com/search?q=a b&page=2")
    })
  })
})
