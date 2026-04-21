import type { ReactNode } from "react";
import { Providers } from "./providers";
import OtelInit from "./otel-init";
import "@copilotkit/react-core/v2/styles.css";

export const metadata = {
  title: "CopilotKit v2 useAgent PoC",
  description:
    "Standalone PoC validating @copilotkit/react-core/v2 useAgent against the agent-lab BFF SSE passthrough.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
          background: "#0b1020",
          color: "#e7ecf5",
        }}
      >
        <OtelInit />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
