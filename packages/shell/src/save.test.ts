import { describe, expect, it, vi } from "vitest";
import { type SaveEnvironment, saveFile } from "./save.ts";

const FILE = new File(["backup"], "shkriuss-notes-2026-10-06.age");

/** A browser that shares what `canShare` allows, and whose share sheet ends as `shared` says. */
function browser(options: {
  readonly canShare?: boolean;
  readonly shared?: "yes" | "cancelled" | "refused";
}): SaveEnvironment & {
  readonly share: ReturnType<typeof vi.fn<(data: ShareData) => Promise<void>>>;
  readonly download: ReturnType<typeof vi.fn<(file: File) => void>>;
} {
  const share = vi.fn<(data: ShareData) => Promise<void>>(async () => {
    if (options.shared === "cancelled") {
      throw new DOMException("Share canceled.", "AbortError");
    }
    if (options.shared === "refused") {
      throw new DOMException("No user activation.", "NotAllowedError");
    }
  });
  return {
    canShare: options.canShare === undefined ? undefined : () => options.canShare === true,
    share,
    download: vi.fn<(file: File) => void>(),
  };
}

describe("saving a backup file", () => {
  it("opens the share sheet with the file where the browser can share it", async () => {
    const environment = browser({ canShare: true, shared: "yes" });
    expect(await saveFile(FILE, environment)).toBe("shared");
    expect(environment.share).toHaveBeenCalledWith({ files: [FILE] });
    expect(environment.download).not.toHaveBeenCalled();
  });

  it("says when the user closed the share sheet, and saves nothing", async () => {
    const environment = browser({ canShare: true, shared: "cancelled" });
    expect(await saveFile(FILE, environment)).toBe("cancelled");
    expect(environment.download).not.toHaveBeenCalled();
  });

  it("downloads the file when the browser refuses to share it after all", async () => {
    const environment = browser({ canShare: true, shared: "refused" });
    expect(await saveFile(FILE, environment)).toBe("downloaded");
    expect(environment.download).toHaveBeenCalledWith(FILE);
  });

  it("downloads the file when the browser cannot share files of its type", async () => {
    const environment = browser({ canShare: false });
    expect(await saveFile(FILE, environment)).toBe("downloaded");
    expect(environment.share).not.toHaveBeenCalled();
    expect(environment.download).toHaveBeenCalledWith(FILE);
  });

  it("downloads the file in a browser without the Web Share API", async () => {
    const environment = browser({});
    expect(await saveFile(FILE, { ...environment, share: undefined })).toBe("downloaded");
    expect(environment.download).toHaveBeenCalledWith(FILE);
  });
});
