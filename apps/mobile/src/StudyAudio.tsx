import { studyAudio, type Preset, type ReadAloudInput, type Locale } from "@app/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { WebView } from "react-native-webview";
import { Button } from "./controls.tsx";
import { editingCopy } from "./editing-copy.ts";
import { mediaBaseUrl, mediaUrl } from "./media.ts";

const FINISHED = "audio-finished";

export function StudyAudio({
  input,
  side,
  preset,
  locale,
  onPlaying,
  onFinished,
}: {
  input: Omit<ReadAloudInput, "language">;
  side: "front" | "back";
  preset: Preset;
  locale: Locale;
  /** A replay started. */
  onPlaying?: () => void;
  /** The side's audio ended, or it had none. */
  onFinished?: () => void;
}) {
  const [replay, setReplay] = useState(0);
  const urls = studyAudio(input, side, preset, replay > 0).map(mediaUrl);
  const html = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src file: data:; script-src 'unsafe-inline'"><script>const urls=${JSON.stringify(urls).replace(/</g, "\\u003c")};let i=0;function next(){if(i>=urls.length){window.ReactNativeWebView.postMessage(${JSON.stringify(FINISHED)});return}const a=new Audio(urls[i++]);a.onended=next;a.onerror=next;a.play().catch(next)}next()</script>`;
  const baseUrl = mediaBaseUrl();
  const source = useMemo(() => ({ html, baseUrl }), [html, baseUrl]);
  const finished = useRef(onFinished);
  useEffect(() => {
    finished.current = onFinished;
  });
  // Which run had nothing to play: a replay of a silent side finishes again.
  const silentRun = urls.length === 0 ? replay : undefined;
  useEffect(() => {
    if (silentRun !== undefined) finished.current?.();
  }, [silentRun]);
  return (
    <>
      <Button
        label={editingCopy(locale)("replayAudio")}
        onPress={() => {
          onPlaying?.();
          setReplay((n) => n + 1);
        }}
      />
      <View style={{ height: 0, overflow: "hidden" }} accessible={false}>
        <WebView
          testID="study-audio"
          key={`${replay}-${html}`}
          source={source}
          javaScriptEnabled
          allowFileAccess
          mediaPlaybackRequiresUserAction={false}
          originWhitelist={["about:*", "file://*"]}
          onShouldStartLoadWithRequest={(r) => r.url === "about:blank" || r.url === mediaBaseUrl()}
          onMessage={({ nativeEvent }) => {
            if (nativeEvent.data === FINISHED) onFinished?.();
          }}
        />
      </View>
    </>
  );
}
