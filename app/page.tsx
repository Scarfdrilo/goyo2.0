"use client";

import { useState, useEffect, useRef } from "react";
import { ConnectButton, useAccesly } from "accesly";
import { createClient } from "@supabase/supabase-js";
import { TransactionBuilder, Networks, Operation, Asset, Account, Memo } from "@stellar/stellar-sdk";

const supabase = createClient(
  "https://gbdlfmkenfldrjnzxqst.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdiZGxmbWtlbmZsZHJqbnp4cXN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA0OTU3MTgsImV4cCI6MjA4NjA3MTcxOH0.ymikUupRQrvbtzc7jEF3_ljUT4pmfc0JYG7Raqj9-sU"
);

// Estado global para controlar el flujo
let isConversationActive = false;
let recognition: any = null;

function speak(text: string, onEnd?: () => void) {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'es-MX';
    utterance.rate = 1.1;
    if (onEnd) {
      utterance.onend = onEnd;
    }
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

export default function Home() {
  const { wallet, balance, signAndSubmit, loading } = useAccesly();
  const [listening, setListening] = useState(false);
  const [conversationMode, setConversationMode] = useState(false);
  const [status, setStatus] = useState("");
  const [conversation, setConversation] = useState<{role: 'user' | 'goyo', text: string}[]>([]);
  const [pendingTransfer, setPendingTransfer] = useState<{amount: number, toEmail: string, toAddress: string} | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [pendingAmount, setPendingAmount] = useState<number | null>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const pendingTransferRef = useRef(pendingTransfer);
  const pendingAmountRef = useRef(pendingAmount);
  const contactsRef = useRef(contacts);

  // Mantener refs actualizados
  useEffect(() => { pendingTransferRef.current = pendingTransfer; }, [pendingTransfer]);
  useEffect(() => { pendingAmountRef.current = pendingAmount; }, [pendingAmount]);
  useEffect(() => { contactsRef.current = contacts; }, [contacts]);

  useEffect(() => {
    async function loadContacts() {
      const { data } = await supabase
        .from("wallets")
        .select("email, stellar_address")
        .limit(50);
      if (data && data.length > 0) {
        setContacts(data);
      }
    }
    loadContacts();
  }, []);

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [conversation]);

  const addMessage = (role: 'user' | 'goyo', text: string) => {
    setConversation(prev => [...prev, { role, text }]);
  };

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
      const username = contact.email.split('@')[0];
      const score = fuzzyMatch(q, username);
      if (score > bestScore && score > 0.5) {
        bestScore = score;
        bestMatch = contact;
      }
    }
    
    return bestMatch;
  };

  const startListening = () => {
    if (!("webkitSpeechRecognition" in window) && !("SpeechRecognition" in window)) {
      return;
    }

    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.lang = "es-MX";
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => {
      setListening(true);
      setStatus("🎤");
    };

    recognition.onresult = async (event: any) => {
      const text = event.results[0][0].transcript;
      setListening(false);
      setStatus("");
      await processConversation(text);
    };

    recognition.onerror = () => {
      setListening(false);
      setStatus("");
      // Reintentar si está en modo conversación
      if (isConversationActive) {
        setTimeout(() => startListening(), 500);
      }
    };

    recognition.onend = () => {
      setListening(false);
      setStatus("");
    };

    recognition.start();
  };

  const startConversation = () => {
    isConversationActive = true;
    setConversationMode(true);
    const names = contacts.slice(0, 3).map(c => c.email.split('@')[0]).join(', ');
    const greeting = `¡Hola! Soy Goyo. Puedo enviar a ${names} y más. ¿Qué necesitas?`;
    addMessage('goyo', greeting);
    speak(greeting, () => {
      if (isConversationActive) startListening();
    });
  };

  const stopConversation = () => {
    isConversationActive = false;
    setConversationMode(false);
    setListening(false);
    window.speechSynthesis.cancel();
    if (recognition) {
      try { recognition.stop(); } catch {}
    }
    setStatus("");
  };

  const respondAndListen = (text: string) => {
    addMessage('goyo', text);
    speak(text, () => {
      if (isConversationActive) {
        setTimeout(() => startListening(), 300);
      }
    });
  };

  const processConversation = async (userText: string) => {
    const normalized = normalizeSpokenText(userText);
    addMessage('user', normalized);

    // Detectar "para" o "detente" o "adiós"
    if (/^(para|detente|stop|adiós|adios|bye|chao|termina)/i.test(normalized)) {
      stopConversation();
      addMessage('goyo', "¡Hasta luego!");
      speak("¡Hasta luego!");
      return;
    }

    const currentPending = pendingTransferRef.current;
    const currentAmount = pendingAmountRef.current;

    // Confirmación
    if (currentPending && /^(sí|si|yes|ok|confirma|dale|va|hazlo|claro|adelante|afirmativo)/i.test(normalized)) {
      await executeTransfer();
      return;
    }

    // Cancelación
    if (currentPending && /^(no|cancela|olvídalo|mejor no|nel|negativo)/i.test(normalized)) {
      setPendingTransfer(null);
      respondAndListen("Cancelado. ¿Qué más?");
      return;
    }

    // Si hay monto pendiente y dice un nombre
    if (currentAmount && !normalized.match(/\d+/)) {
      const contact = findContact(normalized);
      if (contact) {
        setPendingTransfer({ amount: currentAmount, toEmail: contact.email, toAddress: contact.stellar_address });
        setPendingAmount(null);
        respondAndListen(`¿Envío ${currentAmount} lumens a ${contact.email.split('@')[0]}? Di sí o no.`);
        return;
      }
    }

    // Listar contactos
    if (/lista|contactos|quién|quiénes|opciones/i.test(normalized)) {
      const names = contactsRef.current.slice(0, 6).map(c => c.email.split('@')[0]).join(', ');
      respondAndListen(`Tengo: ${names}. ¿A quién le envío?`);
      return;
    }

    // Detectar monto
    const amountMatch = normalized.match(/(\d+(?:\.\d+)?)/);
    const amount = amountMatch ? parseFloat(amountMatch[1]) : null;

    // Buscar nombre
    const words = normalized.split(/\s+/);
    let foundContact: Contact | null = null;
    
    for (const word of words) {
      if (word.length > 2 && !/^\d+$/.test(word) && !['envía', 'envia', 'manda', 'lumens', 'lumen', 'xlm', 'a', 'para'].includes(word.toLowerCase())) {
        const contact = findContact(word);
        if (contact) {
          foundContact = contact;
          break;
        }
      }
    }

    // Monto y contacto
    if (amount && foundContact) {
      setPendingTransfer({ amount, toEmail: foundContact.email, toAddress: foundContact.stellar_address });
      respondAndListen(`¿${amount} lumens a ${foundContact.email.split('@')[0]}? Di sí para enviar.`);
      return;
    }

    // Solo monto
    if (amount && !foundContact) {
      setPendingAmount(amount);
      const names = contactsRef.current.slice(0, 3).map(c => c.email.split('@')[0]).join(', ');
      respondAndListen(`${amount} lumens, ¿a quién? Tengo ${names}...`);
      return;
    }

    // Solo nombre
    if (foundContact && !amount) {
      respondAndListen(`${foundContact.email.split('@')[0]}, ¿cuántos lumens?`);
      return;
    }

    // No entendió
    const firstName = contactsRef.current[0]?.email.split('@')[0] || 'alguien';
    respondAndListen(`Di algo como: 50 lumens a ${firstName}. O di lista para ver contactos.`);
  };

  const executeTransfer = async () => {
    const transfer = pendingTransferRef.current;
    if (!transfer || !wallet) return;

    try {
      setStatus("💸");
      speak("Enviando...");

      const res = await fetch(
        `https://horizon-testnet.stellar.org/accounts/${wallet.stellarAddress}`
      );
      const accountData = await res.json();
      const account = new Account(wallet.stellarAddress!, accountData.sequence);

      const tx = new TransactionBuilder(account, {
        fee: "100",
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(
          Operation.payment({
            destination: transfer.toAddress,
            asset: Asset.native(),
            amount: transfer.amount.toString(),
          })
        )
        .addMemo(Memo.text("Goyo"))
        .setTimeout(60)
        .build();

      await signAndSubmit(tx.toXDR());

      setPendingTransfer(null);
      setStatus("✅");
      respondAndListen(`¡Listo! Envié ${transfer.amount} lumens a ${transfer.toEmail.split('@')[0]}. ¿Algo más?`);

    } catch (error: any) {
      setStatus("");
      setPendingTransfer(null);
      respondAndListen(`Error: ${error.message}. ¿Intentamos de nuevo?`);
    }
  };

  return (
    <div className="h-screen bg-black text-white flex flex-col">
      {/* Header */}
      <div className="p-3 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold">🎙️ Goyo</h1>
          {conversationMode && (
            <span className="text-xs bg-green-600 px-2 py-1 rounded-full animate-pulse">
              LIVE
            </span>
          )}
        </div>
        <ConnectButton />
      </div>

      {wallet && (
        <div className="px-3 py-2 text-sm text-zinc-400 border-b border-zinc-800">
          {balance || "0"} XLM
        </div>
      )}

      {/* Chat */}
      <div ref={chatRef} className="flex-1 overflow-y-auto p-3 space-y-3 pb-32">
        {!wallet && (
          <div className="text-center text-zinc-500 py-8">
            <p className="text-lg mb-2">👆 Conecta tu wallet</p>
          </div>
        )}
        
        {conversation.map((msg, i) => (
          <div 
            key={i} 
            className={`p-3 rounded-2xl max-w-[85%] ${
              msg.role === 'user' 
                ? 'bg-blue-600 ml-auto' 
                : 'bg-zinc-800'
            }`}
          >
            {msg.role === 'goyo' && <p className="text-xs text-zinc-400 mb-1">🤖 Goyo</p>}
            <p className="text-sm">{msg.text}</p>
          </div>
        ))}

        {listening && (
          <div className="text-center">
            <span className="inline-block w-4 h-4 bg-red-500 rounded-full animate-pulse"></span>
            <p className="text-xs text-zinc-500 mt-1">Escuchando...</p>
          </div>
        )}
      </div>

      {/* Contactos rápidos */}
      {wallet && contacts.length > 0 && !conversationMode && (
        <div className="px-3 pb-2 border-t border-zinc-800 pt-2">
          <div className="flex gap-2 overflow-x-auto">
            {contacts.slice(0, 5).map(contact => (
              <button
                key={contact.email}
                onClick={() => {
                  if (!conversationMode) startConversation();
                  setTimeout(() => processConversation(`10 lumens a ${contact.email.split('@')[0]}`), 1000);
                }}
                className="bg-zinc-800 px-3 py-2 rounded-full text-xs whitespace-nowrap"
              >
                {contact.email.split('@')[0]}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Botón principal */}
      {wallet && (
        <div className="p-3 border-t border-zinc-800 bg-black">
          {!conversationMode ? (
            <button
              onClick={startConversation}
              disabled={loading || contacts.length === 0}
              className="w-full py-5 rounded-2xl text-lg font-bold bg-green-600 active:scale-95 transition-transform"
            >
              🎤 Iniciar conversación
            </button>
          ) : (
            <button
              onClick={stopConversation}
              className="w-full py-5 rounded-2xl text-lg font-bold bg-red-600 active:scale-95 transition-transform"
            >
              ⏹️ Terminar conversación
            </button>
          )}
        </div>
      )}
    </div>
  );
}
