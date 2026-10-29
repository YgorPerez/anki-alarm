/** Saves bytes as a file through the browser's download. */
export function download(name: string, bytes: Uint8Array) {
  const url = URL.createObjectURL(
    new Blob([new Uint8Array(bytes)], { type: "application/octet-stream" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  // The click has handed the blob to the download; the URL can go.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
