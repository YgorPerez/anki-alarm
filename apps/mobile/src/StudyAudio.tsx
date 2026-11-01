import { studyAudio, type Preset, type ReadAloudInput, type Locale } from "@app/core";
import { useMemo, useState } from "react";
import { View } from "react-native";
import { WebView } from "react-native-webview";
import { Button } from "./controls.tsx";
import { editingCopy } from "./editing-copy.ts";
import { mediaBaseUrl, mediaUrl } from "./media.ts";

export function StudyAudio({
  input,
  side,
  preset,
  locale,
}: {
  input: Omit<ReadAloudInput, "language">;
  side: "front" | "back";
  preset: Preset;
  locale: Locale;
}) {
  const [replay, setReplay] = useState(0);
  const urls = studyAudio(input, side, preset, replay > 0).map(mediaUrl);
  const html = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src file: data:; script-src 'unsafe-inline'"><script>const urls=${JSON.stringify(urls).replace(/</g, "\\u003c")};let i=0;function next(){if(i>=urls.length)return;const a=new Audio(urls[i++]);a.onended=next;a.onerror=next;a.play().catch(next)}next()</script>`;
  const baseUrl = mediaBaseUrl();
  const source = useMemo(() => ({ html, baseUrl }), [html, baseUrl]);
  return (
    <>
      <Button label={editingCopy(locale)("replayAudio")} onPress={() => setReplay((n) => n + 1)} />
      <View style={{ height: 0, overflow: "hidden" }} accessible={false}>
        <WebView
          key={`${replay}-${html}`}
          source={source}
          javaScriptEnabled
          allowFileAccess
          mediaPlaybackRequiresUserAction={false}
          originWhitelist={["about:*", "file://*"]}
          onShouldStartLoadWithRequest={(r) => r.url === "about:blank" || r.url === mediaBaseUrl()}
        />
      </View>
    </>
  );
}
