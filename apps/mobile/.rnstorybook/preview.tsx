import type { Preview } from "@storybook/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
const client = new QueryClient();
const preview: Preview = {
  decorators: [
    (Story) => (
      <SafeAreaProvider>
        <QueryClientProvider client={client}>
          <Story />
        </QueryClientProvider>
      </SafeAreaProvider>
    ),
  ],
};
export default preview;
