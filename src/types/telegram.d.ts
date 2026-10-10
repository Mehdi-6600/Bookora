export {};

declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        initData: string;
        initDataUnsafe: {
          user?: {
            id: number;
            first_name: string;
            last_name?: string;
            username?: string;
            language_code?: string;
          };
        };
        ready: () => void;
        expand: () => void;
        close: () => void;
        /**
         * Present in Telegram WebApp 6.1+. Guarded at every call site because
         * older clients and the plain browser do not define it.
         */
        openTelegramLink?: (url: string) => void;
        openLink?: (url: string, options?: { try_instant_view?: boolean }) => void;
      };
    };
  }
}
