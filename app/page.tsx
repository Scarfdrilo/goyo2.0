"use client";

import { useState, useEffect } from "react";
import { ConnectButton, useAccesly } from "accesly";
import { createClient } from "@supabase/supabase-js";
import { TransactionBuilder, Networks, Operation, Asset, Account, Memo } from "@stellar/stellar-sdk";

// Supabase client
const supabase = createClient(
  "https://gbdlfmkenfldrjnzxqst.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdiZGxmbWtlbmZsZHJqbnp4cXN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA0OTU3MTgsImV4cCI6MjA4NjA3MTcxOH0.ymikUupRQrvbtzc7jEF3_ljUT4pmfc0JYG7Raqj9-sU"
);

// TTS - Hablar
function speak(text: string) {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'es-MX';
    utterance.rate = 1.1;
    window.speechSynthesis.speak(utterance);
  }
}

// Normaliza texto hablado
function normalizeSpokenText(text: string): string {
  return text
    .replace(/\s+arroba\s+/gi, '@')
    .replace(/\s+punto\s+/gi, '.')
    .replace(/\s+at\s+/gi, '@')
    .replace(/\s+dot\s+/gi, '.')
    .replace(/\s+/g, ' ')
    .trim();
}

// Busca stellar address por email
async function getAddressByEmail(email: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("wallets")
    .select("stellar_address")
    .eq("email", email)
    .single();
  if (error || !data) return null;
  return data.stellar_address;
}

// Busca emails similares
async function searchEmails(query: string): Promise<string[]> {
  const { data } = await supabase
    .from("wallets")
    .select("email")
    .ilike("email", `%${query}%`)
    .limit(5);
  return data?.map(d => d.email) || [];
}

// Obtiene todos los emails
async function getAllEmails(): Promise<string[]> {
  const { data } = await supabase
    .from("wallets")
    .select("email")
    .limit(20);
  return data?.map(d => d.email) || [];
}

export default function Home() {
  const { wallet, balance, signAndSubmit, loading } = useAccesly();
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [status, setStatus] = useState("");
  const [conversation, setConversation] = useState<{role: 'user' | 'goyo', text: string}[]>([]);
  const [pendingTransfer, setPendingTransfer] = useState<{amount: number, toEmail: string, toAddress: string} | null>(null);
  const [availableEmails, setAvailableEmails] = useState<string[]>([]);

  // Cargar emails al inicio
  useEffect(() => {
    getAllEmails().then(setAvailableEmails);
  }, []);

  // Saludo inicial
  useEffect(() => {
    if (wallet && conversation.length === 0) {
      const greeting = `¡Hola! Soy Goyo, tu asistente de pagos. Puedes decirme cosas como: envía 10 lumens a un correo. ¿A quién quieres enviar?`;
      addMessage('goyo', greeting);
      speak(greeting);
    }
  }, [wallet]);

  const addMessage = (role: 'user' | 'goyo', text: string) => {
    setConversation(prev => [...prev, { role, text }]);
  };

  const startListening = () => {
    if (!("webkitSpeechRecognition" in window)) {
      speak("Tu navegador no soporta voz");
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
      setListening(false);
      await processConversation(text);
    };

    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognition.start();
  };

  const processConversation = async (userText: string) => {
    const normalized = normalizeSpokenText(userText);
    addMessage('user', normalized);
    setTranscript(normalized);

    // Detectar confirmación
    if (pendingTransfer && /^(sí|si|yes|ok|confirma|dale|va|hazlo)/i.test(normalized)) {
      await executeTransfer();
      return;
    }

    // Detectar cancelación
    if (pendingTransfer && /^(no|cancela|olvídalo|mejor no)/i.test(normalized)) {
      setPendingTransfer(null);
      const msg = "Ok, cancelado. ¿Qué más necesitas?";
      addMessage('goyo', msg);
      speak(msg);
      return;
    }

    // Detectar "listar contactos"
    if (/lista|contactos|correos|emails|quién|a quién/i.test(normalized)) {
      const names = availableEmails.slice(0, 5).map(e => e.split('@')[0]).join(', ');
      const msg = `Tengo estos contactos: ${names}. ¿A cuál quieres enviar?`;
      addMessage('goyo', msg);
      speak(msg);
      return;
    }

    // Detectar transferencia
    const transferMatch = normalized.match(/(?:env[ií]a?|manda|transfer)\s+(\d+(?:\.\d+)?)\s*(?:lumens?|xlm)?\s*(?:a\s+)?([^\s]+@[^\s]+)?/i);
    
    if (transferMatch) {
      const amount = parseFloat(transferMatch[1]);
      let toEmail = transferMatch[2]?.toLowerCase();

      // Si no hay email, preguntar
      if (!toEmail) {
        const msg = `¿${amount} lumens a quién? Dime el correo o el nombre.`;
        addMessage('goyo', msg);
        speak(msg);
        return;
      }

      // Buscar en DB
      setStatus("🔍 Buscando...");
      let address = await getAddressByEmail(toEmail);

      // Si no encontró, buscar similar
      if (!address) {
        const similar = await searchEmails(toEmail.split('@')[0]);
        if (similar.length > 0) {
          toEmail = similar[0];
          address = await getAddressByEmail(toEmail);
        }
      }

      if (!address) {
        const msg = `No encontré a ${toEmail} en la base de datos. ¿Quieres intentar con otro correo?`;
        addMessage('goyo', msg);
        speak(msg);
        return;
      }

      // Pedir confirmación
      setPendingTransfer({ amount, toEmail, toAddress: address });
      const shortAddr = address.slice(0, 8);
      const msg = `Voy a enviar ${amount} lumens a ${toEmail}. Su wallet es ${shortAddr}... ¿Confirmas?`;
      addMessage('goyo', msg);
      speak(msg);
      return;
    }

    // Detectar solo nombre/email
    const emailMatch = normalized.match(/([^\s]+@[^\s]+)/i);
    const nameMatch = normalized.match(/(?:a\s+)?(\w+)/i);
    
    if (emailMatch || nameMatch) {
      const query = emailMatch ? emailMatch[1] : nameMatch![1];
      const results = await searchEmails(query);
      
      if (results.length > 0) {
        const msg = `Encontré a ${results[0]}. ¿Cuántos lumens quieres enviarle?`;
        addMessage('goyo', msg);
        speak(msg);
        return;
      }
    }

    // No entendió
    const msg = "No entendí. Puedes decir: envía 50 lumens a correo@ejemplo.com, o pregúntame quiénes están en la lista.";
    addMessage('goyo', msg);
    speak(msg);
  };

  const executeTransfer = async () => {
    if (!pendingTransfer || !wallet) return;

    try {
      setStatus("💸 Enviando...");
      speak("Enviando...");

      // Obtener cuenta
      const res = await fetch(
        `https://horizon-testnet.stellar.org/accounts/${wallet.stellarAddress}`
      );
      const accountData = await res.json();
      const account = new Account(wallet.stellarAddress!, accountData.sequence);

      // Construir TX
      const tx = new TransactionBuilder(account, {
        fee: "100",
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(
          Operation.payment({
            destination: pendingTransfer.toAddress,
            asset: Asset.native(),
            amount: pendingTransfer.amount.toString(),
          })
        )
        .addMemo(Memo.text("Goyo"))
        .setTimeout(60)
        .build();

      // Firmar y enviar
      const result = await signAndSubmit(tx.toXDR());
      const txHash = result?.txHash || "completado";

      const msg = `¡Listo! Envié ${pendingTransfer.amount} lumens a ${pendingTransfer.toEmail}. La transacción fue exitosa. ¿Algo más?`;
      addMessage('goyo', msg);
      speak(msg);
      setStatus(`✅ TX: ${txHash.slice(0, 8)}...`);
      setPendingTransfer(null);

    } catch (error: any) {
      const msg = `Hubo un error: ${error.message}. ¿Quieres intentar de nuevo?`;
      addMessage('goyo', msg);
      speak(msg);
      setPendingTransfer(null);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col p-4">
      {/* Header */}
      <div className="text-center py-4">
        <h1 className="text-2xl font-bold">🎙️ Goyo 2.0</h1>
        <ConnectButton />
      </div>

      {/* Wallet Info */}
      {wallet && (
        <div className="bg-zinc-900 rounded-lg p-3 mb-4 text-sm">
          <p className="text-zinc-400">{wallet.email}</p>
          <p className="text-xl font-bold">{balance || "0"} XLM</p>
        </div>
      )}

      {/* Conversation */}
      <div className="flex-1 overflow-y-auto space-y-3 mb-4">
        {conversation.map((msg, i) => (
          <div 
            key={i} 
            className={`p-3 rounded-lg max-w-[85%] ${
              msg.role === 'user' 
                ? 'bg-blue-600 ml-auto' 
                : 'bg-zinc-800'
            }`}
          >
            <p className="text-xs text-zinc-400 mb-1">
              {msg.role === 'user' ? 'Tú' : '🤖 Goyo'}
            </p>
            <p>{msg.text}</p>
          </div>
        ))}
      </div>

      {/* Status */}
      {status && (
        <p className="text-center text-sm text-zinc-400 mb-2">{status}</p>
      )}

      {/* Voice Button */}
      {wallet && (
        <button
          onClick={startListening}
          disabled={listening || loading}
          className={`w-full py-6 rounded-xl text-xl font-bold transition-all ${
            listening
              ? "bg-red-600 animate-pulse"
              : "bg-white text-black"
          }`}
        >
          {listening ? "🎤 Escuchando..." : "🎤 Hablar con Goyo"}
        </button>
      )}

      {/* Quick actions */}
      {wallet && availableEmails.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {availableEmails.slice(0, 4).map(email => (
            <button
              key={email}
              onClick={() => processConversation(`envía 10 lumens a ${email}`)}
              className="bg-zinc-800 px-3 py-2 rounded-lg text-xs"
            >
              {email.split('@')[0]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
