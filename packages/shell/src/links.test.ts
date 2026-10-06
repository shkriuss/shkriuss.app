import { LICENSES_FILE } from "@shkriuss/edge";
import { describe, expect, it } from "vitest";
import { LICENSES_PATH, SECURITY_URL, SOURCE_URL } from "./links.ts";

describe("the links of About", () => {
  it("point to the file of licenses that every build has", () => {
    expect(LICENSES_PATH).toBe(`/${LICENSES_FILE}`);
  });

  it("point to the public repository and its security policy", () => {
    expect(SOURCE_URL).toBe("https://github.com/shkriuss/shkriuss.app");
    expect(SECURITY_URL).toBe("https://github.com/shkriuss/shkriuss.app/security/policy");
  });
});
