/// <reference types="vite/client" />

import type { SquidbotApi } from "../../shared/api";

declare global {
  interface Window {
    squidbot: SquidbotApi;
  }
}
