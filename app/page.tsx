"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import dynamic from "next/dynamic";
import { ConnectButton, useAccesly } from "accesly";
import { createClient } from "@supabase/supabase-js";
import { TransactionBuilder, Networks, Operation, Asset, Account, Memo } from "@stellar/stellar-sdk";

// Cargar Three.js solo en cliente
const GoyoOrb = dynamic(() => import("./GoyoOrb"), { 
  ssr: false,
  loading: () => <div className="w-full h-64 bg-zinc-900 rounded-xl animate-pulse" />
});

const supabase = createClient(
  "https://gbdlfmkenfldrjnzxqst.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdiZGxmbWtlbmZsZHJqbnp4cXN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA0OTU3MTgsImV4cCI6MjA4NjA3MTcxOH0.ymikUupRQrvbtzc7jEF3_ljUT4pmfc0JYG7Raqj9-sU"
);

let isConversationActive = false;
let recognition: any = null;

function speak(text: string, onEnd?: () => void) {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'es-MX';
    utterance.rate = 1.1;
    if (onEnd) utterance.onend = onEnd;
    window.speechSynthesis.speak(utterance);
  } else if (onEnd) {
    onEnd();
  }
}

function fuzzyMatch(query: string, target: string): number {
  const q = query.toLowerCase().replace(/[^a-z0-9]/g, '');
  const t = target.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (t.includes(q) || q.includes(t)) return 1;
  let matches = 0;
  for (let i = 0; i < q.length; i++) {
    if (t.includes(q[i])) matches++;
  }
  return matches / Math.max(q.length, 1);
}

function normalizeSpokenText(text: string): string {
  return text
    .replace(/\s+arroba\s+/gi, '@')
    .replace(/\s+punto\s+/gi, '.')
    .replace(/\s+at\s+/gi, '@')
    .replace(/\s+dot\s+/gi, '.')
    .replace(/\s+/g, ' ')
    .trim();
}

interface Contact {
  email: string;
  stellar_address: string;
}

type OrbState = "idle" | "listening" | "speaking" | "processing";

export default function Home() {
  const { wallet, balance, signAndSubmit, loading } = useAccesly();
  const [orbState, setOrbState] = useState<OrbState>("idle");
  const [conversationMode, setConversationMode] = useState(false);
  const [lastMessage, setLastMessage] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [pendingTransfer, setPendingTransfer] = useState<{amount: number, toEmail: string, toAddress: string} | null>(null);
  const [pendingAmount, setPendingAmount] = useState<number | null>(null);
  
  const pendingTransferRef = useRef(pendingTransfer);
  const pendingAmountRef = useRef(pendingAmount);
  const contactsRef = useRef(contacts);

  useEffect(() => { pendingTransferRef.current = pendingTransfer; }, [pendingTransfer]);
  useEffect(() => { pendingAmountRef.current = pendingAmount; }, [pendingAmount]);
  useEffect(() => { contactsRef.current = contacts; }, [contacts]);

  useEffect(() => {
    async function loadContacts() {
      const { data } = await supabase
        .from("wallets")
        .select("email, stellar_address")
        .limit(50);
      if (data && data.length > 0) setContacts(data);
    }
    loadContacts();
  }, []);

  const findContact = (query: string): Contact | null => {
    const q = query.toLowerCase().replace(/[^a-z0-9@.]/g, '');
    const currentContacts = contactsRef.current;
    
    let found = currentContacts.find(c => c.email.toLowerCase() === q);
    if (found) return found;
    found = currentContacts.find(c => c.email.split('@')[0].toLowerCase() === q);
    if (found) return found;

    let bestMatch: Contact | null = null;
    let bestScore = 0;
    for (const contact of currentContacts) {
      const score = fuzzyMatch(q, contact.email.split('@')[0]);
      if (score > bestScore && score > 0.5) {
        bestScore = score;
        bestMatch = contact;
      }
    }
    return bestMatch;
  };

  const startListening = () => {
    if (!("webkitSpeechRecognition" in window) && !("SpeechRecognition" in window)) return;

    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.lang = "es-MX";
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => setOrbState("listening");
    recognition.onresult = async (event: any) => {
      const text = event.results[0][0].transcript;
      await processConversation(text);
    };
    recognition.onerror = () => {
      setOrbState("idle");
      if (isConversationActive) setTimeout(() => startListening(), 500);
    };
    recognition.onend = () => {
      if (orbState === "listening") setOrbState("idle");
    };
    recognition.start();
  };

  const startConversation = () => {
    isConversationActive = true;
    setConversationMode(true);
    const names = contacts.slice(0, 3).map(c => c.email.split('@')[0]).join(', ');
    const greeting = `¡Hola! Soy Goyo. Puedo enviar a ${names} y más. ¿Qué necesitas?`;
    setLastMessage(greeting);
    setOrbState("speaking");
    speak(greeting, () => {
      setOrbState("idle");
      if (isConversationActive) startListening();
    });
  };

  const stopConversation = () => {
    isConversationActive = false;
    setConversationMode(false);
    setOrbState("idle");
    window.speechSynthesis.cancel();
    if (recognition) try { recognition.stop(); } catch {}
  };

  const respondAndListen = (text: string) => {
    setLastMessage(text);
    setOrbState("speaking");
    speak(text, () => {
      setOrbState("idle");
      if (isConversationActive) setTimeout(() => startListening(), 300);
    });
  };

  const processConversation = async (userText: string) => {
    const normalized = normalizeSpokenText(userText);
    setLastMessage(`Tú: "${normalized}"`);
    setOrbState("processing");

    if (/^(para|detente|stop|adiós|adios|bye|chao|termina)/i.test(normalized)) {
      stopConversation();
      setLastMessage("¡Hasta luego!");
      setOrbState("speaking");
      speak("¡Hasta luego!", () => setOrbState("idle"));
      return;
    }

    const currentPending = pendingTransferRef.current;
    const currentAmount = pendingAmountRef.current;

    if (currentPending && /^(sí|si|yes|ok|confirma|dale|va|hazlo|claro|adelante)/i.test(normalized)) {
      await executeTransfer();
      return;
    }

    if (currentPending && /^(no|cancela|olvídalo|mejor no|nel)/i.test(normalized)) {
      setPendingTransfer(null);
      respondAndListen("Cancelado. ¿Qué más?");
      return;
    }

    if (currentAmount && !normalized.match(/\d+/)) {
      const contact = findContact(normalized);
      if (contact) {
        setPendingTransfer({ amount: currentAmount, toEmail: contact.email, toAddress: contact.stellar_address });
        setPendingAmount(null);
        respondAndListen(`¿Envío ${currentAmount} lumens a ${contact.email.split('@')[0]}? Di sí o no.`);
        return;
      }
    }

    if (/lista|contactos|quién|quiénes/i.test(normalized)) {
      const names = contactsRef.current.slice(0, 5).map(c => c.email.split('@')[0]).join(', ');
      respondAndListen(`Tengo: ${names}. ¿A quién?`);
      return;
    }

    const amountMatch = normalized.match(/(\d+(?:\.\d+)?)/);
    const amount = amountMatch ? parseFloat(amountMatch[1]) : null;

    const words = normalized.split(/\s+/);
    let foundContact: Contact | null = null;
    for (const word of words) {
      if (word.length > 2 && !/^\d+$/.test(word) && !['envía', 'envia', 'manda', 'lumens', 'lumen', 'xlm', 'a'].includes(word.toLowerCase())) {
        const contact = findContact(word);
        if (contact) { foundContact = contact; break; }
      }
    }

    if (amount && foundContact) {
      setPendingTransfer({ amount, toEmail: foundContact.email, toAddress: foundContact.stellar_address });
      respondAndListen(`¿${amount} lumens a ${foundContact.email.split('@')[0]}? Di sí.`);
      return;
    }

    if (amount && !foundContact) {
      setPendingAmount(amount);
      const names = contactsRef.current.slice(0, 3).map(c => c.email.split('@')[0]).join(', ');
      respondAndListen(`${amount} lumens, ¿a quién? Tengo ${names}...`);
      return;
    }

    if (foundContact && !amount) {
      respondAndListen(`${foundContact.email.split('@')[0]}, ¿cuántos lumens?`);
      return;
    }

    const firstName = contactsRef.current[0]?.email.split('@')[0] || 'alguien';
    respondAndListen(`Di: 50 lumens a ${firstName}`);
  };

  const executeTransfer = async () => {
    const transfer = pendingTransferRef.current;
    if (!transfer || !wallet) return;

    try {
      setOrbState("processing");
      speak("Enviando...");

      const res = await fetch(`https://horizon-testnet.stellar.org/accounts/${wallet.stellarAddress}`);
      const accountData = await res.json();
      const account = new Account(wallet.stellarAddress!, accountData.sequence);

      const tx = new TransactionBuilder(account, {
        fee: "100",
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(Operation.payment({
          destination: transfer.toAddress,
          asset: Asset.native(),
          amount: transfer.amount.toString(),
        }))
        .addMemo(Memo.text("Goyo"))
        .setTimeout(60)
        .build();

      await signAndSubmit(tx.toXDR());
      setPendingTransfer(null);
      respondAndListen(`¡Listo! Envié ${transfer.amount} lumens a ${transfer.toEmail.split('@')[0]}. ¿Algo más?`);

    } catch (error: any) {
      setPendingTransfer(null);
      respondAndListen(`Error: ${error.message}. ¿Otra vez?`);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-black via-zinc-900 to-black text-white flex flex-col">
      {/* Header */}
      <div className="p-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-pink-500 bg-clip-text text-transparent">
          GOYO 2.0
        </h1>
        <ConnectButton />
      </div>

      {/* Balance */}
      {wallet && (
        <div className="text-center text-zinc-400 text-sm">
          {balance || "0"} XLM
        </div>
      )}

      {/* Orbe 3D */}
      <div className="flex-1 flex flex-col items-center justify-center px-4">
        {wallet ? (
          <>
            <Suspense fallback={<div className="w-full h-64 bg-zinc-900 rounded-xl" />}>
              <GoyoOrb state={orbState} />
            </Suspense>
            
            {/* Último mensaje */}
            <div className="mt-4 text-center max-w-sm">
              <p className="text-lg text-zinc-300">{lastMessage}</p>
            </div>
          </>
        ) : (
          <div className="text-center">
            <div className="w-32 h-32 rounded-full bg-zinc-800 mx-auto mb-4 flex items-center justify-center">
              <span className="text-5xl">🎙️</span>
            </div>
            <p className="text-zinc-500">Conecta tu wallet para empezar</p>
          </div>
        )}
      </div>

      {/* Contactos rápidos */}
      {wallet && contacts.length > 0 && !conversationMode && (
        <div className="px-4 pb-2">
          <div className="flex gap-2 overflow-x-auto pb-2 justify-center">
            {contacts.slice(0, 4).map(contact => (
              <button
                key={contact.email}
                onClick={() => {
                  startConversation();
                  setTimeout(() => processConversation(`10 lumens a ${contact.email.split('@')[0]}`), 1500);
                }}
                className="bg-zinc-800/50 backdrop-blur px-4 py-2 rounded-full text-sm border border-zinc-700 hover:border-purple-500 transition"
              >
                {contact.email.split('@')[0]}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Botón principal */}
      {wallet && (
        <div className="p-4 pb-8">
          {!conversationMode ? (
            <button
              onClick={startConversation}
              disabled={loading || contacts.length === 0}
              className="w-full py-5 rounded-2xl text-lg font-bold bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 active:scale-95 transition-all shadow-lg shadow-purple-500/25"
            >
              🎤 Iniciar conversación
            </button>
          ) : (
            <button
              onClick={stopConversation}
              className="w-full py-5 rounded-2xl text-lg font-bold bg-red-600 hover:bg-red-500 active:scale-95 transition-all"
            >
              ⏹️ Terminar
            </button>
          )}
        </div>
      )}
    </div>
  );
}
