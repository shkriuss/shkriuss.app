import { createHash } from "node:crypto";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { BuildData, Header } from "./protocol.ts";
import { BUILD_DATA_PLACEHOLDER, fileUrl, precacheList, serviceWorkerScript } from "./script.ts";

const hash = (text: string): string => createHash("sha256").update(text).digest("hex");

/** A build's manifest, as `sha256sums.txt` lists it: path → SHA-256. */
const MANIFEST = new Map([
  ["/assets/index-AbCd1234.js", hash("index")],
  ["/index.html", hash("<!doctype html>")],
  ["/licenses.txt", hash("licenses")],
  ["/sw.js", hash("service worker")],
]);

/** `MANIFEST` with the security.txt of a commit, which expires 180 days after it. */
function withSecurityTxt(expires: string): Map<string, string> {
  return new Map(MANIFEST).set("/.well-known/security.txt", hash(`Expires: ${expires}`));
}

/** The security headers that the host sends with every file of the build. */
const HEADERS: readonly Header[] = [
  ["Content-Security-Policy", "default-src 'none'; script-src 'self'"],
  ["X-Content-Type-Options", "nosniff"],
];

/** A bundled service worker as Rolldown writes it, with the placeholder once. */
const CODE = `(function(){start(self,${BUILD_DATA_PLACEHOLDER})})();`;

/** The data that `script` contains, read back as JSON. */
function dataOf(script: string): unknown {
  const [before = "", after = ""] = CODE.split(BUILD_DATA_PLACEHOLDER);
  expect(script.startsWith(before) && script.endsWith(after)).toBe(true);
  return JSON.parse(script.slice(before.length, script.length - after.length));
}

describe("fileUrl (§2.1)", () => {
  it.each([
    ["/index.html", "/"],
    ["/help/index.html", "/help/"],
    ["/about.html", "/about"],
    ["/help/faq.html", "/help/faq"],
    ["/assets/index-AbCd1234.js", "/assets/index-AbCd1234.js"],
    ["/licenses.txt", "/licenses.txt"],
    ["/index.htm", "/index.htm"],
  ])("serves %s at %s, as Cloudflare does", (path, url) => {
    expect(fileUrl(path)).toBe(url);
  });
});

describe("precacheList (§2.1)", () => {
  it("lists every file but /sw.js by the URL it is served at, sorted", () => {
    expect(precacheList(MANIFEST)).toStrictEqual([
      { url: "/", sha256: hash("<!doctype html>") },
      { url: "/assets/index-AbCd1234.js", sha256: hash("index") },
      { url: "/licenses.txt", sha256: hash("licenses") },
    ]);
  });

  it("leaves out sha256sums.txt, which a manifest never lists, and sorts by URL", () => {
    const list = precacheList(
      new Map([
        ["/sha256sums.txt", hash("sums")],
        ["/z.txt", hash("z")],
        ["/index.html", hash("shell")],
        ["/a/index.html", hash("a")],
      ]),
    );
    expect(list.map((file) => file.url)).toStrictEqual(["/", "/a/", "/z.txt"]);
  });

  it("leaves out security.txt, which changes with every commit", () => {
    expect(precacheList(withSecurityTxt("2027-04-06T11:34:17.000Z"))).toStrictEqual(
      precacheList(MANIFEST),
    );
  });

  it("refuses a build without /index.html, which answers navigations offline", () => {
    expect(() => precacheList(new Map([["/about.html", hash("about")]]))).toThrow(
      /no \/index\.html/,
    );
  });

  it("refuses two files served at one URL", () => {
    const manifest = new Map([
      ["/index.html", hash("shell")],
      ["/about", hash("a file without an extension")],
      ["/about.html", hash("about")],
    ]);
    expect(() => precacheList(manifest)).toThrow("two files that are served at /about");
  });

  it.each([
    ["uppercase", hash("x").toUpperCase()],
    ["too short", hash("x").slice(1)],
    ["base64", "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU="],
  ])("refuses a hash that is not a SHA-256 in hex: %s", (_case, sha256) => {
    const manifest = new Map([
      ["/index.html", hash("shell")],
      ["/x.js", sha256],
    ]);
    expect(() => precacheList(manifest)).toThrow("The hash of /x.js");
  });
});

describe("serviceWorkerScript (§2.2, §2.3)", () => {
  it("puts the version id, the precache list, the headers and the replaced versions in place of the placeholder", () => {
    const { script, data } = serviceWorkerScript(CODE, MANIFEST, HEADERS, ["0123456789abcdef"]);
    expect(data.files).toStrictEqual(precacheList(MANIFEST));
    expect(data.headers).toStrictEqual(HEADERS);
    expect(data.replaces).toStrictEqual(["0123456789abcdef"]);
    expect(data.version).toMatch(/^[0-9a-f]{16}$/);
    expect(dataOf(script)).toStrictEqual(data);
    expect(script).not.toContain(BUILD_DATA_PLACEHOLDER);
  });

  it("derives the version id from the script with sixteen zeros as its id", () => {
    const { script, data } = serviceWorkerScript(CODE, MANIFEST, HEADERS);
    const unversioned = script.replace(
      `"version":"${data.version}"`,
      `"version":"${"0".repeat(16)}"`,
    );
    expect(hash(unversioned).slice(0, 16)).toBe(data.version);
  });

  it("gives the same script for the same build", () => {
    expect(serviceWorkerScript(CODE, MANIFEST, HEADERS)).toStrictEqual(
      serviceWorkerScript(CODE, MANIFEST, HEADERS),
    );
    const reordered = new Map([...MANIFEST].toReversed());
    expect(serviceWorkerScript(CODE, reordered, HEADERS).script).toBe(
      serviceWorkerScript(CODE, MANIFEST, HEADERS).script,
    );
  });

  it("gives a new version id for any change to a file, the headers, the code or the replaced versions", () => {
    const { version } = serviceWorkerScript(CODE, MANIFEST, HEADERS).data;
    const changedFile = new Map(MANIFEST).set("/licenses.txt", hash("licenses, changed"));
    const others = [
      serviceWorkerScript(CODE, changedFile, HEADERS).data.version,
      serviceWorkerScript(CODE.replace("start", "begin"), MANIFEST, HEADERS).data.version,
      serviceWorkerScript(CODE, MANIFEST, HEADERS, ["0123456789abcdef"]).data.version,
      serviceWorkerScript(CODE, MANIFEST, [...HEADERS, ["X-Frame-Options", "DENY"]]).data.version,
    ];
    expect(new Set([version, ...others]).size).toBe(5);
  });

  it("ignores /sw.js itself, whose hash changes with the script", () => {
    const changedServiceWorker = new Map(MANIFEST).set("/sw.js", hash("another service worker"));
    expect(serviceWorkerScript(CODE, changedServiceWorker, HEADERS).script).toBe(
      serviceWorkerScript(CODE, MANIFEST, HEADERS).script,
    );
  });

  it("is the same for builds of two commits that change no file of the app", () => {
    expect(
      serviceWorkerScript(CODE, withSecurityTxt("2027-04-06T11:34:17.000Z"), HEADERS).script,
    ).toBe(serviceWorkerScript(CODE, withSecurityTxt("2027-04-07T09:12:00.000Z"), HEADERS).script);
  });

  it.each([
    ["no placeholder", "(function(){})();", 0],
    ["two placeholders", `${CODE}${CODE}`, 2],
  ])("refuses code with %s", (_case, code, times) => {
    expect(() => serviceWorkerScript(code, MANIFEST, HEADERS)).toThrow(`not ${times} times`);
  });

  it.each([["0123456789ABCDEF"], ["0123"], ["the broken one"]])(
    "refuses %s as a replaced version",
    (version) => {
      expect(() => serviceWorkerScript(CODE, MANIFEST, HEADERS, [version])).toThrow(
        "is not a version id",
      );
    },
  );

  it.each<[string, Header]>([
    ["a name with a space", ["Content Security-Policy", "default-src 'none'"]],
    ["an empty name", ["", "nosniff"]],
    ["a value of two lines", ["Content-Security-Policy", "default-src 'none'\nscript-src *"]],
    ["a value with a null character", ["X-Content-Type-Options", "nosniff\0"]],
  ])("refuses a header with %s, which the service worker could not set", (_case, header) => {
    expect(() => serviceWorkerScript(CODE, MANIFEST, [header])).toThrow("is not a header");
  });

  it("accepts a tab in a header's value, as HTTP does", () => {
    const header: Header = ["Content-Security-Policy", "default-src 'none';\tscript-src 'self'"];
    expect(serviceWorkerScript(CODE, MANIFEST, [header]).data.headers).toStrictEqual([header]);
  });

  it("keeps every file of any build, each at one URL, and its data readable", () => {
    const segment = fc.stringMatching(/^[a-z0-9_-]{1,8}$/);
    const path = fc
      .array(segment, { minLength: 1, maxLength: 3 })
      .chain((parts) =>
        fc
          .constantFrom(".js", ".css", ".txt", ".html", ".svg")
          .map((extension) => `/${parts.join("/")}${extension}`),
      );
    // Every path has an extension, so no two are served at one URL, and none is /sw.js.
    const served = path.filter((file) => file !== "/sw.js" && file !== "/sha256sums.txt");
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.tuple(served, fc.string()), {
          selector: ([file]) => file,
          maxLength: 30,
        }),
        (entries) => {
          const manifest = new Map(entries.map(([file, content]) => [file, hash(content)]));
          manifest.set("/index.html", hash("shell"));
          const { script, data }: { script: string; data: BuildData } = serviceWorkerScript(
            CODE,
            manifest,
            HEADERS,
          );
          expect(dataOf(script)).toStrictEqual(data);
          const urls = data.files.map((file) => file.url);
          expect(urls).toStrictEqual(urls.toSorted());
          expect(new Set(urls).size).toBe(manifest.size);
          for (const [file, sha256] of manifest) {
            expect(data.files).toContainEqual({ url: fileUrl(file), sha256 });
          }
        },
      ),
    );
  });
});
