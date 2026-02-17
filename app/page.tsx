"use client";

import { useState } from "react";
import { ConnectButton, useAccesly } from "accesly";
import { createClient } from "@supabase/supabase-js";
import { TransactionBuilder, Networks, Operation, Asset, Account } from "@stellar/stellar-sdk";

// Supabase client
const supabase = createClient(
  "https://gbdlfmkenfldrjnzxqst.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdiZGxmbWtlbmZsZHJqbnp4cXN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA0OTU3MTgsImV4cCI6MjA4NjA3MTcxOH0.ymikUupRQrvbtzc7jEF3_ljUT4pmfc0JYG7Raqj9-sU"
);

// Normaliza texto hablado (arroba -> @, punto -> .)
function normalizeSpokenText(text: string): string {
  return text
    .replace(/\s+arroba\s+/gi, '@')
    .replace(/\s+punto\s+/gi, '.')
    .replace(/\s+at\s+/gi, '@')
    .replace(/\s+dot\s+/gi, '.')
    .replace(/\s+/g, ' ')
    .trim();
}

// Extrae intent de transferencia del texto
function extractTransferIntent(text: string) {
  const normalized = normalizeSpokenText(text.toLowerCase());
  
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

// Busca stellar address por email en Supabase
async function getAddressByEmail(email: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("wallets")
    .select("stellar_address")
    .eq("email", email)
    .single();
  
  if (error || !data) return null;
  return data.stellar_address;
}

export default function Home() {
  const { wallet, balance, signAndSubmit, loading } = useAccesly();
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [status, setStatus] = useState("");
  const [txHistory, setTxHistory] = useState<{text: string, hash?: string}[]>([]);

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
      const normalizedText = normalizeSpokenText(text);
      setTranscript(normalizedText);
      setListening(false);
      await processCommand(normalizedText);
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

    if (intent.type === "transfer" && wallet) {
      try {
        // 1. Buscar dirección del destinatario en Supabase
        setStatus(`🔍 Buscando ${intent.toEmail}...`);
        const destinationAddress = await getAddressByEmail(intent.toEmail);
        
        if (!destinationAddress) {
          setStatus(`❌ No encontré wallet para ${intent.toEmail}`);
          return;
        }

        setStatus(`💸 Enviando ${intent.amount} XLM a ${intent.toEmail}...`);

        // 2. Obtener cuenta del remitente desde Horizon
        const res = await fetch(
          `https://horizon-testnet.stellar.org/accounts/${wallet.stellarAddress}`
        );
        const accountData = await res.json();
        const account = new Account(wallet.stellarAddress!, accountData.sequence);

        // 3. Construir transacción
        const tx = new TransactionBuilder(account, {
          fee: "100",
          networkPassphrase: Networks.TESTNET,
        })
          .addOperation(
            Operation.payment({
              destination: destinationAddress,
              asset: Asset.native(),
              amount: intent.amount.toString(),
            })
          )
          .addMemo(new (await import("@stellar/stellar-sdk")).Memo("text", `Goyo: ${intent.toEmail}`))
          .setTimeout(60)
          .build();

        // 4. Firmar y enviar con Accesly
        const result = await signAndSubmit(tx.toXDR());
        const txHash = result?.txHash || "unknown";

        setTxHistory(prev => [
          { text: `✅ ${intent.amount} XLM → ${intent.toEmail}`, hash: txHash },
          ...prev
        ]);
        setStatus(`✅ Enviado! TX: ${txHash.slice(0, 8)}...`);

      } catch (error: any) {
        console.error(error);
        setStatus(`❌ Error: ${error.message}`);
      }
    } else if (intent.type === "transfer" && !wallet) {
      setStatus("⚠️ Conecta tu wallet primero");
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
            <p className="text-xs text-zinc-500 truncate">{wallet.stellarAddress}</p>
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
                <p className="text-lg">&quot;{transcript}&quot;</p>
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
                    <p>{tx.text}</p>
                    {tx.hash && (
                      <a 
                        href={`https://stellar.expert/explorer/testnet/tx/${tx.hash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 text-xs hover:underline"
                      >
                        Ver en Explorer →
                      </a>
                    )}
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
              Di: &quot;envía 50 lumens a juan arroba test punto com&quot;
            </p>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="mt-16 text-center text-zinc-600 text-sm">
        <p>Stellar Testnet • Accesly + Supabase</p>
      </footer>
    </div>
  );
}
