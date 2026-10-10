import { VoiceReporter } from "@/components/voice/VoiceReporter";

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-100 py-12">
      <div className="text-center mb-8">
        <h1 className="text-4xl font-extrabold text-gray-900">SafaiKavach</h1>
        <p className="text-gray-600 mt-2">AI Municipal Dispatch Engine</p>
      </div>
      <VoiceReporter />
    </main>
  );
}
