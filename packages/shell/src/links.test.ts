import { LICENSES_FILE, SOURCE_URL as EDGE_SOURCE_URL, securityTxt } from "@shkriuss/edge";
import { describe, expect, it } from "vitest";
import { LICENSES_PATH, REPORT_URL, SECURITY_URL, SOURCE_URL } from "./links.ts";

describe("the links of About", () => {
  it("point to the file of licenses that every build has", () => {
    expect(LICENSES_PATH).toBe(`/${LICENSES_FILE}`);
  });

  it("point to the public repository and its security policy", () => {
    expect(SOURCE_URL).toBe("https://github.com/shkriuss/shkriuss.app");
    expect(SECURITY_URL).toBe("https://github.com/shkriuss/shkriuss.app/security/policy");
  });
});

describe("the links to report a problem", () => {
  it("are the ones that every site's security.txt gives", () => {
    const text = securityTxt(new Date(0));
    expect(text).toContain(`Contact: ${REPORT_URL}\n`);
    expect(text).toContain(`Policy: ${SECURITY_URL}\n`);
    expect(SOURCE_URL).toBe(EDGE_SOURCE_URL);
  });
});
