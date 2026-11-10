import { serializeShareBundle, shareBundleFilename, type ShareBundle } from "./access/share";

/**
 * Hand a share file to the device's share sheet. If that is not available,
 * the browser downloads it. The file is built here and is not uploaded.
 */
export async function deliverShareFile(bundle: ShareBundle): Promise<void> {
  const text = serializeShareBundle(bundle);
  const name = shareBundleFilename(bundle.source.ownerName);
  const file = new File([text], name, { type: "application/json" });
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  if (nav && typeof nav.canShare === "function" && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: `${bundle.source.ownerName} family` });
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
