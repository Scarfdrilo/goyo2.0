"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import dynamic from "next/dynamic";
import { ConnectButton, useAccesly } from "accesly";
import { TransactionBuilder, Networks, Operation, Asset, Account, Memo } from "@stellar/stellar-sdk";

const GoyoBlob = dynamic(() => import("./GoyoBlob"), { 
  ssr: false,
  loading: () => <div className="w-full h-80" />
});

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
  const [toast, setToast] = useState<{message: string, txHash?: string} | null>(null);
  
  const pendingTransferRef = useRef(pendingTransfer);
  const pendingAmountRef = useRef(pendingAmount);
  const contactsRef = useRef(contacts);

  useEffect(() => { pendingTransferRef.current = pendingTransfer; }, [pendingTransfer]);
  useEffect(() => { pendingAmountRef.current = pendingAmount; }, [pendingAmount]);
  useEffect(() => { contactsRef.current = contacts; }, [contacts]);

  useEffect(() => {
    async function loadContacts() {
      try {
        const res = await fetch("/api/contacts");
        const { contacts: data } = await res.json();
        if (data && data.length > 0) setContacts(data);
      } catch (err) {
        console.error("Failed to load contacts:", err);
      }
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
      const result = await signAndSubmit(tx.toXDR());
      const txHash = result?.txHash;
      setPendingTransfer(null);
      
      // Mostrar toast con link
      if (txHash) {
        setToast({ message: `${transfer.amount} XLM enviados`, txHash });
        setTimeout(() => setToast(null), 8000);
      }
      
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
    <div className="min-h-screen bg-black text-white flex flex-col relative">
      {/* Toast notification */}
      {toast && (
        <div className="fixed top-4 left-4 right-4 z-50 animate-slide-down">
          <a
            href={`https://stellar.expert/explorer/testnet/tx/${toast.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block bg-green-500/90 backdrop-blur-sm rounded-2xl p-4 shadow-lg shadow-green-500/20"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-black font-medium">{toast.message}</p>
                <p className="text-black/60 text-xs mt-1">toca para ver en explorer</p>
              </div>
              <svg className="w-5 h-5 text-black/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </div>
          </a>
        </div>
      )}
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

            {/* Mensaje arriba del botón */}
            {lastMessage && (
              <p className="mb-4 text-center text-zinc-400 text-sm max-w-xs px-4">
                {lastMessage}
              </p>
            )}

            {/* Estado */}
            <p className="mb-2 text-xs text-zinc-600 tracking-wider h-4">
              {blobState === "listening" ? "escuchando" :
               blobState === "speaking" ? "hablando" :
               blobState === "processing" ? "procesando" : ""}
            </p>

            {/* Botón micrófono */}
            <button
              onClick={handleButtonPress}
              disabled={loading || contacts.length === 0}
              className={`
                w-20 h-20 rounded-full flex items-center justify-center
                transition-all duration-200 ease-out
                ${buttonPressed ? 'scale-90' : 'scale-100 hover:scale-105'}
                ${conversationMode 
                  ? 'bg-red-500' 
                  : 'bg-green-500'
                }
                active:scale-90
                shadow-lg
                ${conversationMode ? 'shadow-red-500/40' : 'shadow-green-500/40'}
              `}
            >
              {conversationMode ? (
                <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              ) : (
                <svg className="w-8 h-8 text-black" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.49 3 2.89 5.35 5.91 5.78V20c0 .55.45 1 1 1s1-.45 1-1v-2.08c3.02-.43 5.42-2.78 5.91-5.78.1-.6-.39-1.14-1-1.14z"/>
                </svg>
              )}
            </button>
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
