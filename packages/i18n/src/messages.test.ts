import { describe, expect, expectTypeOf, it } from "vitest";
import { createFormat } from "./format.ts";
import { defineMessages } from "./messages.ts";

const messages = defineMessages((format) => ({
  title: () => "Notes",
  count: (count: number) => format.plural(count, { one: "# note", other: "# notes" }),
  made: (made: Date) => `Made on ${format.date(made)}`,
}));

describe("defineMessages (ADR 0012)", () => {
  it("gives the messages for the UI's formats", () => {
    const m = messages(createFormat("de-DE", { timeZone: "Europe/Berlin" }));
    expect(m.title()).toBe("Notes");
    expect(m.count(1234)).toBe("1.234 notes");
    expect(m.made(new Date(Date.UTC(2026, 9, 5, 12, 30)))).toBe("Made on 5 Oct 2026");
  });

  it("gives the same frozen messages for the same formats", () => {
    const format = createFormat("en-US");
    const m = messages(format);
    expect(messages(format)).toBe(m);
    expect(Object.isFrozen(m)).toBe(true);
    expect(messages(createFormat("en-US"))).not.toBe(m);
  });

  it("types messages by their inputs", () => {
    const m = messages(createFormat("en-US"));
    expectTypeOf(m.count).parameters.toEqualTypeOf<[count: number]>();
    expectTypeOf(m.count).returns.toBeString();
    // @ts-expect-error A message takes the inputs it declares.
    m.count("3");
    // @ts-expect-error A message gives a string.
    defineMessages(() => ({ wrong: () => 3 }));
  });
});
