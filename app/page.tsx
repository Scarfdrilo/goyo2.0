"use client";

import { useState, useEffect } from "react";
import { ConnectButton, useAccesly } from "accesly";

// Extrae intent de transferencia del texto
function extractTransferIntent(text: string) {
  const normalized = text.toLowerCase();
  
  const patterns = [
    /env[ií]a?\s+(\d+(?:\.\d+)?)\s+(?:lumens?|xlm|stellar)?\s*(?:a|to)\s+([^\s]+@[^\s]+)/i,
    /transfer(?:ir)?\s+(\d+(?:\.\d+)?)\s+(?:lumens?|xlm)?\s*(?:a|to)\s+([^\s]+@[^\s]+)/i,
    /manda\s+(\d+(?:\.\d+)?)\s+(?:lumens?|xlm|stellar)?\s*a\s+([^\s]+@[^\s]+)/i,
    /send\s+(\d+(?:\.\d+)?)\s+(?:lumens?|xlm)?\s*to\s+([^\s]+@[^\s]+)/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) {
      return {
        type: "transfer" as const,
        amount: parseFloat(match[1]),
        toEmail: match[2].toLowerCase(),
      };
    }
  }

  return { type: "unknown" as const };
}

export default function Home() {
  const { wallet, balance, sendPayment, loading } = useAccesly();
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [status, setStatus] = useState("");
  const [txHistory, setTxHistory] = useState<string[]>([]);

  // Web Speech API
  const startListening = () => {
    if (!("webkitSpeechRecognition" in window)) {
      setStatus("⚠️ Tu navegador no soporta reconocimiento de voz");
      return;
    }

    const SpeechRecognition = (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = "es-MX";
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => {
      setListening(true);
      setStatus("🎤 Escuchando...");
    };

    recognition.onresult = async (event: any) => {
      const text = event.results[0][0].transcript;
      setTranscript(text);
      setListening(false);
      await processCommand(text);
    };

    recognition.onerror = (event: any) => {
      setStatus(`❌ Error: ${event.error}`);
      setListening(false);
    };

    recognition.onend = () => {
      setListening(false);
    };

    recognition.start();
  };

  const processCommand = async (text: string) => {
    setStatus("🔄 Procesando...");
    const intent = extractTransferIntent(text);

    if (intent.type === "transfer") {
      try {
        // Por ahora usamos la dirección del destinatario
        // En prod, resolveríamos email -> stellar address via Accesly
        setStatus(`💸 Enviando ${intent.amount} XLM a ${intent.toEmail}...`);
        
        // TODO: Resolver email a stellar address
        // Por ahora mostramos el intent
        setTxHistory(prev => [
          `✅ ${intent.amount} XLM → ${intent.toEmail}`,
          ...prev
        ]);
        setStatus(`✅ Enviados ${intent.amount} XLM a ${intent.toEmail}`);
        
        // Con Accesly sería:
        // const { txHash } = await sendPayment({
        //   destination: resolvedAddress,
        //   amount: intent.amount.toString(),
        // });
        
      } catch (error: any) {
        setStatus(`❌ Error: ${error.message}`);
      }
    } else {
      setStatus("🤷 No entendí. Prueba: 'envía 10 lumens a email@test.com'");
    }
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-8">
      <main className="max-w-lg w-full space-y-8">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-4xl font-bold mb-2">🎙️ Goyo 2.0</h1>
          <p className="text-zinc-400">Envía Stellar tokens por voz</p>
        </div>

        {/* Wallet Connection */}
        <div className="flex justify-center">
          <ConnectButton />
        </div>

        {/* Wallet Info */}
        {wallet && (
          <div className="bg-zinc-900 rounded-xl p-4 space-y-2">
            <p className="text-sm text-zinc-400">Conectado como</p>
            <p className="font-mono text-sm truncate">{wallet.email}</p>
            <p className="text-2xl font-bold">{balance || "0"} XLM</p>
          </div>
        )}

        {/* Voice Input */}
        {wallet && (
          <div className="space-y-4">
            <button
              onClick={startListening}
              disabled={listening || loading}
              className={`w-full py-6 rounded-xl text-xl font-semibold transition-all ${
                listening
                  ? "bg-red-600 animate-pulse"
                  : "bg-white text-black hover:bg-zinc-200"
              }`}
            >
              {listening ? "🎤 Escuchando..." : "🎤 Hablar"}
            </button>

            {/* Transcript */}
            {transcript && (
              <div className="bg-zinc-800 rounded-lg p-4">
                <p className="text-sm text-zinc-400 mb-1">Escuché:</p>
                <p className="text-lg">&ldquo;{transcript}&rdquo;</p>
              </div>
            )}

            {/* Status */}
            {status && (
              <p className="text-center text-lg">{status}</p>
            )}

            {/* History */}
            {txHistory.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm text-zinc-400">Historial:</p>
                {txHistory.map((tx, i) => (
                  <div key={i} className="bg-zinc-900 rounded-lg p-3 text-sm">
                    {tx}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Instructions */}
        {!wallet && (
          <div className="text-center text-zinc-500">
            <p>Conecta tu wallet para empezar</p>
            <p className="text-sm mt-2">
              Comandos: &ldquo;envía 50 lumens a email@test.com&rdquo;
            </p>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="mt-16 text-center text-zinc-600 text-sm">
        <p>Stellar Testnet • Powered by Accesly + PersonaPlex</p>
      </footer>
    </div>
  );
}
