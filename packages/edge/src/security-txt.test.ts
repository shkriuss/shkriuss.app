import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { type Git, SECURITY_TXT_DAYS, commitDate, securityTxt } from "./security-txt.ts";

const NO_GIT: Git = () => Promise.reject(new Error("not a git repository"));

describe("securityTxt", () => {
  it("says where to report a problem, and expires 180 days after the commit", () => {
    expect(SECURITY_TXT_DAYS).toBe(180);
    expect(securityTxt(new Date("2026-10-06T14:22:45Z"))).toBe(
      "Contact: https://github.com/shkriuss/shkriuss.app/security/advisories/new\n" +
        "Policy: https://github.com/shkriuss/shkriuss.app/security/policy\n" +
        "Preferred-Languages: en\n" +
        "Expires: 2027-04-04T14:22:45.000Z\n",
    );
  });
});

describe("commitDate", () => {
  it("takes SOURCE_DATE_EPOCH first, as reproducible builds set it", async () => {
    expect(await commitDate("/nowhere", { SOURCE_DATE_EPOCH: "1791104400" }, NO_GIT)).toEqual(
      new Date(1_791_104_400_000),
    );
  });

  it("refuses a SOURCE_DATE_EPOCH that is not whole seconds", async () => {
    await expect(commitDate("/nowhere", { SOURCE_DATE_EPOCH: "soon" }, NO_GIT)).rejects.toThrow(
      'SOURCE_DATE_EPOCH must be whole seconds since 1970, not "soon".',
    );
  });

  it("takes the date of the HEAD commit from git otherwise", async () => {
    const asked: string[][] = [];
    const git: Git = async (directory, args) => {
      asked.push([directory, ...args]);
      return "1791104400\n";
    };
    expect(await commitDate("/repo", { SOURCE_DATE_EPOCH: "" }, git)).toEqual(
      new Date(1_791_104_400_000),
    );
    expect(asked).toStrictEqual([["/repo", "log", "-1", "--format=%ct"]]);
  });

  it("fails without git or SOURCE_DATE_EPOCH, rather than differ from build to build", async () => {
    await expect(commitDate("/nowhere", {}, NO_GIT)).rejects.toThrow(
      "build in a git checkout, or set SOURCE_DATE_EPOCH",
    );
    await expect(commitDate("/repo", {}, async () => "yesterday\n")).rejects.toThrow(
      'git gave "yesterday" as the commit\'s date',
    );
  });

  it("reads this repository's HEAD commit with the real git", async () => {
    const seconds = execFileSync("git", ["log", "-1", "--format=%ct"], { encoding: "utf8" });
    expect(await commitDate(process.cwd(), {})).toEqual(new Date(Number(seconds.trim()) * 1000));
  });
});
