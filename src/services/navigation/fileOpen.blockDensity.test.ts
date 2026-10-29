// @vitest-environment node
/**
 * #1570 — the open path honors the block-density route end to end.
 *
 * The router decides; this file proves the decision reaches the tab before it
 * mounts: a block-dense sub-1-MiB markdown file is marked forced-source, and a
 * sparse file of the same size stays in WYSIWYG.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fileBytes } from "@/test/fileBytes";

const mockReadTextFile = vi.fn();
vi.mock("@tauri-apps/plugin-fs", () => ({
  readFile: (...args: unknown[]) => fileBytes(mockReadTextFile(...args)),
}));

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { openFileInNewTabCore } from "./fileOpen";
import { useDocumentStore, useLargeFileSessionStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { rebootstrapFormats } from "@/lib/formats/registryBootstrap";

const WINDOW = "main";

describe("openFileInNewTabCore — block-density routing (#1570)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rebootstrapFormats();
    useTabStore.getState().removeWindow(WINDOW);
    Object.keys(useDocumentStore.getState().documents).forEach((id) =>
      useDocumentStore.getState().removeDocument(id)
    );
    useLargeFileSessionStore.setState({ forcedSourceTabs: {} });
  });

  const openWith = async (path: string, blocks: number) => {
    mockReadTextFile.mockResolvedValue("# content");
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_file_size_bytes") return Promise.resolve(400 * 1024);
      if (cmd === "count_markdown_blocks") return Promise.resolve(blocks);
      return Promise.resolve();
    });

    await openFileInNewTabCore(WINDOW, path);

    const tabId = useTabStore.getState().getTabsByWindow(WINDOW).at(-1)!.id;
    return { tabId, forced: useLargeFileSessionStore.getState().isForcedSource(tabId) };
  };

  it("marks a block-dense sub-1-MiB markdown file as forced-source", async () => {
    const { forced } = await openWith("/docs/book.md", 3_773);
    expect(forced).toBe(true);
    expect(mockReadTextFile).toHaveBeenCalledWith("/docs/book.md");
  });

  it("leaves a sparse sub-1-MiB markdown file in WYSIWYG", async () => {
    const { forced } = await openWith("/docs/chapter.md", 300);
    expect(forced).toBe(false);
  });
});
