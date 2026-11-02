import { useStudyAudio, type StudyAudioProps } from "@app/editing-ui/use-study-audio";
import { useEffect, useMemo } from "react";
import { View } from "react-native";
import { WebView } from "react-native-webview";
import { Button } from "./controls.tsx";
import { editingCopy } from "./editing-copy.ts";
import { mediaBaseUrl, mediaUrl } from "./media.ts";

const FINISHED = "audio-finished";

export function StudyAudio(props: StudyAudioProps) {
  const { clips, canReplay, replay, finished, startReplay } = useStudyAudio(props);
  const urls = clips.map(mediaUrl);
  const html = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src file: data:; script-src 'unsafe-inline'"><script>const urls=${JSON.stringify(urls).replace(/</g, "\\u003c")};let i=0;function next(){if(i>=urls.length){window.ReactNativeWebView.postMessage(${JSON.stringify(FINISHED)});return}const a=new Audio(urls[i++]);a.onended=next;a.onerror=next;a.play().catch(next)}next()</script>`;
  const baseUrl = mediaBaseUrl();
  const source = useMemo(() => ({ html, baseUrl }), [html, baseUrl]);
  // Which run had nothing to play: a replay of a silent side finishes again.
  const silentRun = urls.length === 0 ? replay : undefined;
  useEffect(() => {
    if (silentRun !== undefined) finished.current?.();
  }, [silentRun, finished]);
  return (
    <>
      {canReplay && (
        <Button label={editingCopy(props.locale)("replayAudio")} onPress={startReplay} />
      )}
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
            if (nativeEvent.data === FINISHED) props.onFinished?.();
          }}
        />
      </View>
    </>
  );
}
