"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import dynamic from "next/dynamic";
import { ConnectButton, useAccesly } from "accesly";
import { createClient } from "@supabase/supabase-js";
import { TransactionBuilder, Networks, Operation, Asset, Account, Memo } from "@stellar/stellar-sdk";

const GoyoBlob = dynamic(() => import("./GoyoBlob"), { 
  ssr: false,
  loading: () => <div className="w-full h-80" />
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

type BlobState = "idle" | "listening" | "speaking" | "processing";

export default function Home() {
  const { wallet, balance, signAndSubmit, loading } = useAccesly();
  const [blobState, setBlobState] = useState<BlobState>("idle");
  const [conversationMode, setConversationMode] = useState(false);
  const [lastMessage, setLastMessage] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [pendingTransfer, setPendingTransfer] = useState<{amount: number, toEmail: string, toAddress: string} | null>(null);
  const [pendingAmount, setPendingAmount] = useState<number | null>(null);
  const [buttonPressed, setButtonPressed] = useState(false);
  
  const pendingTransferRef = useRef(pendingTransfer);
  const pendingAmountRef = useRef(pendingAmount);
  const contactsRef = useRef(contacts);

  useEffect(() => { pendingTransferRef.current = pendingTransfer; }, [pendingTransfer]);
  useEffect(() => { pendingAmountRef.current = pendingAmount; }, [pendingAmount]);
  useEffect(() => { contactsRef.current = contacts; }, [contacts]);

  useEffect(() => {
    async function loadContacts() {
      const { data } = await supabase.from("wallets").select("email, stellar_address").limit(50);
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
    recognition.onstart = () => setBlobState("listening");
    recognition.onresult = async (event: any) => {
      await processConversation(event.results[0][0].transcript);
    };
    recognition.onerror = () => {
      setBlobState("idle");
      if (isConversationActive) setTimeout(() => startListening(), 500);
    };
    recognition.onend = () => {
      if (blobState === "listening") setBlobState("idle");
    };
    recognition.start();
  };

  const startConversation = () => {
    isConversationActive = true;
    setConversationMode(true);
    const names = contacts.slice(0, 3).map(c => c.email.split('@')[0]).join(', ');
    const greeting = `Hola, soy Goyo. Puedo enviar a ${names} y mas. Que necesitas?`;
    setLastMessage(greeting);
    setBlobState("speaking");
    speak(greeting, () => {
      setBlobState("idle");
      if (isConversationActive) startListening();
    });
  };

  const stopConversation = () => {
    isConversationActive = false;
    setConversationMode(false);
    setBlobState("idle");
    window.speechSynthesis.cancel();
    if (recognition) try { recognition.stop(); } catch {}
  };

  const respondAndListen = (text: string) => {
    setLastMessage(text);
    setBlobState("speaking");
    speak(text, () => {
      setBlobState("idle");
      if (isConversationActive) setTimeout(() => startListening(), 300);
    });
  };

  const processConversation = async (userText: string) => {
    const normalized = normalizeSpokenText(userText);
    setLastMessage(`"${normalized}"`);
    setBlobState("processing");

    if (/^(para|detente|stop|adiós|adios|bye|chao|termina)/i.test(normalized)) {
      stopConversation();
      setLastMessage("Hasta luego");
      setBlobState("speaking");
      speak("Hasta luego", () => setBlobState("idle"));
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
      respondAndListen("Cancelado. Que mas?");
      return;
    }

    if (currentAmount && !normalized.match(/\d+/)) {
      const contact = findContact(normalized);
      if (contact) {
        setPendingTransfer({ amount: currentAmount, toEmail: contact.email, toAddress: contact.stellar_address });
        setPendingAmount(null);
        respondAndListen(`Envio ${currentAmount} lumens a ${contact.email.split('@')[0]}? Di si o no.`);
        return;
      }
    }

    if (/lista|contactos|quién|quiénes/i.test(normalized)) {
      const names = contactsRef.current.slice(0, 5).map(c => c.email.split('@')[0]).join(', ');
      respondAndListen(`Tengo: ${names}. A quien?`);
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
      respondAndListen(`${amount} lumens a ${foundContact.email.split('@')[0]}? Di si.`);
      return;
    }

    if (amount && !foundContact) {
      setPendingAmount(amount);
      const names = contactsRef.current.slice(0, 3).map(c => c.email.split('@')[0]).join(', ');
      respondAndListen(`${amount} lumens, a quien? Tengo ${names}...`);
      return;
    }

    if (foundContact && !amount) {
      respondAndListen(`${foundContact.email.split('@')[0]}, cuantos lumens?`);
      return;
    }

    const firstName = contactsRef.current[0]?.email.split('@')[0] || 'alguien';
    respondAndListen(`Di: 50 lumens a ${firstName}`);
  };

  const executeTransfer = async () => {
    const transfer = pendingTransferRef.current;
    if (!transfer || !wallet) return;
    try {
      setBlobState("processing");
      speak("Enviando...");
      const res = await fetch(`https://horizon-testnet.stellar.org/accounts/${wallet.stellarAddress}`);
      const accountData = await res.json();
      const account = new Account(wallet.stellarAddress!, accountData.sequence);
      const tx = new TransactionBuilder(account, { fee: "100", networkPassphrase: Networks.TESTNET })
        .addOperation(Operation.payment({ destination: transfer.toAddress, asset: Asset.native(), amount: transfer.amount.toString() }))
        .addMemo(Memo.text("Goyo"))
        .setTimeout(60)
        .build();
      await signAndSubmit(tx.toXDR());
      setPendingTransfer(null);
      respondAndListen(`Listo! Envie ${transfer.amount} lumens a ${transfer.toEmail.split('@')[0]}. Algo mas?`);
    } catch (error: any) {
      setPendingTransfer(null);
      respondAndListen(`Error: ${error.message}. Otra vez?`);
    }
  };

  const handleButtonPress = () => {
    setButtonPressed(true);
    setTimeout(() => setButtonPressed(false), 200);
    if (!conversationMode) {
      startConversation();
    } else {
      stopConversation();
    }
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      {/* Header minimalista */}
      <div className="p-4 flex items-center justify-between">
        <span className="text-lg font-light tracking-wider">goyo</span>
        <ConnectButton />
      </div>

      {/* Balance */}
      {wallet && (
        <div className="text-center text-zinc-500 text-sm">
          {balance || "0"} xlm
        </div>
      )}

      {/* Centro - Blob y botón */}
      <div className="flex-1 flex flex-col items-center justify-center">
        {wallet ? (
          <>
            {/* Blob 3D */}
            <Suspense fallback={<div className="w-full h-80" />}>
              <GoyoBlob state={blobState} />
            </Suspense>

            {/* Botón gomita central */}
            <button
              onClick={handleButtonPress}
              disabled={loading || contacts.length === 0}
              className={`
                mt-4 px-12 py-6 rounded-full text-lg font-light tracking-wide
                transition-all duration-200 ease-out
                ${buttonPressed ? 'scale-90' : 'scale-100 hover:scale-105'}
                ${conversationMode 
                  ? 'bg-red-500/80 text-white' 
                  : 'bg-green-500/80 text-black'
                }
                active:scale-90
                shadow-lg
                ${conversationMode ? 'shadow-red-500/30' : 'shadow-green-500/30'}
              `}
              style={{
                backdropFilter: 'blur(10px)',
              }}
            >
              {conversationMode ? 'terminar' : 'hablar'}
            </button>

            {/* Estado */}
            <p className="mt-6 text-xs text-zinc-600 tracking-wider">
              {blobState === "listening" ? "escuchando" :
               blobState === "speaking" ? "hablando" :
               blobState === "processing" ? "procesando" :
               conversationMode ? "esperando" : ""}
            </p>

            {/* Mensaje */}
            {lastMessage && (
              <p className="mt-4 text-center text-zinc-400 text-sm max-w-xs px-4">
                {lastMessage}
              </p>
            )}
          </>
        ) : (
          <div className="text-center">
            <div className="w-24 h-24 rounded-full bg-green-500/20 mx-auto mb-6" />
            <p className="text-zinc-600 text-sm">conecta tu wallet</p>
          </div>
        )}
      </div>

      {/* Contactos rápidos */}
      {wallet && contacts.length > 0 && !conversationMode && (
        <div className="p-4 pb-8">
          <div className="flex gap-2 overflow-x-auto justify-center">
            {contacts.slice(0, 4).map(contact => (
              <button
                key={contact.email}
                onClick={() => {
                  startConversation();
                  setTimeout(() => processConversation(`10 lumens a ${contact.email.split('@')[0]}`), 1500);
                }}
                className="px-4 py-2 rounded-full text-xs text-zinc-500 border border-zinc-800 hover:border-green-500/50 transition"
              >
                {contact.email.split('@')[0]}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
