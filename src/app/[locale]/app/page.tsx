import { TelegramAuthGate } from "@/components/telegram/auth-gate";

export default function MiniAppPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <TelegramAuthGate />
    </main>
  );
}
