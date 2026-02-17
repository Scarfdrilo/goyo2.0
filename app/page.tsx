"use client";

import { useState, useEffect, useRef } from "react";
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
    utterance.rate = 1.0;
    window.speechSynthesis.speak(utterance);
  }
}

// Fuzzy match - encuentra similitudes
function fuzzyMatch(query: string, target: string): number {
  const q = query.toLowerCase().replace(/[^a-z0-9]/g, '');
  const t = target.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (t.includes(q) || q.includes(t)) return 1;
  
  // Levenshtein simplificado
  let matches = 0;
  for (let i = 0; i < q.length; i++) {
    if (t.includes(q[i])) matches++;
  }
  return matches / Math.max(q.length, 1);
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

interface Contact {
  email: string;
  stellar_address: string;
}

export default function Home() {
  const { wallet, balance, signAndSubmit, loading } = useAccesly();
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [status, setStatus] = useState("");
  const [conversation, setConversation] = useState<{role: 'user' | 'goyo', text: string}[]>([]);
  const [pendingTransfer, setPendingTransfer] = useState<{amount: number, toEmail: string, toAddress: string} | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [pendingAmount, setPendingAmount] = useState<number | null>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  // Cargar contactos
  useEffect(() => {
    async function loadContacts() {
      console.log("Loading contacts...");
      const { data, error } = await supabase
        .from("wallets")
        .select("email, stellar_address")
        .limit(50);
      
      console.log("Contacts loaded:", data, error);
      if (data && data.length > 0) {
        setContacts(data);
      }
    }
    loadContacts();
  }, []);

  // Scroll al final del chat
  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [conversation]);

  // Saludo inicial
  useEffect(() => {
    if (wallet && conversation.length === 0 && contacts.length > 0) {
      const names = contacts.slice(0, 3).map(c => c.email.split('@')[0]).join(', ');
      const greeting = `¡Hola! Soy Goyo. Puedo enviar lumens a: ${names}, y más. ¿A quién le envío?`;
      addMessage('goyo', greeting);
      speak(greeting);
    }
  }, [wallet, contacts]);

  const addMessage = (role: 'user' | 'goyo', text: string) => {
    setConversation(prev => [...prev, { role, text }]);
  };

  // Buscar contacto por nombre (fuzzy)
  const findContact = (query: string): Contact | null => {
    const q = query.toLowerCase().replace(/[^a-z0-9@.]/g, '');
    
    // Primero buscar match exacto en email
    let found = contacts.find(c => c.email.toLowerCase() === q);
    if (found) return found;

    // Buscar en nombre de usuario (antes del @)
    found = contacts.find(c => c.email.split('@')[0].toLowerCase() === q);
    if (found) return found;

    // Fuzzy match
    let bestMatch: Contact | null = null;
    let bestScore = 0;
    
    for (const contact of contacts) {
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
      const msg = "Tu navegador no soporta voz. Usa los botones de abajo.";
      addMessage('goyo', msg);
      speak(msg);
      return;
    }

    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
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
      setStatus("");
      await processConversation(text);
    };

    recognition.onerror = () => {
      setListening(false);
      setStatus("");
    };
    recognition.onend = () => {
      setListening(false);
      setStatus("");
    };
    recognition.start();
  };

  const processConversation = async (userText: string) => {
    const normalized = normalizeSpokenText(userText);
    addMessage('user', normalized);
    setTranscript(normalized);

    // Confirmación
    if (pendingTransfer && /^(sí|si|yes|ok|confirma|dale|va|hazlo|claro|adelante)/i.test(normalized)) {
      await executeTransfer();
      return;
    }

    // Cancelación
    if (pendingTransfer && /^(no|cancela|olvídalo|mejor no|nel)/i.test(normalized)) {
      setPendingTransfer(null);
      const msg = "Cancelado. ¿Qué más?";
      addMessage('goyo', msg);
      speak(msg);
      return;
    }

    // Si hay monto pendiente y dice un nombre
    if (pendingAmount && !normalized.match(/\d+/)) {
      const contact = findContact(normalized);
      if (contact) {
        setPendingTransfer({ amount: pendingAmount, toEmail: contact.email, toAddress: contact.stellar_address });
        setPendingAmount(null);
        const msg = `¿Envío ${pendingAmount} lumens a ${contact.email}? Di sí para confirmar.`;
        addMessage('goyo', msg);
        speak(msg);
        return;
      }
    }

    // Listar contactos
    if (/lista|contactos|correos|emails|quién|a quién|quiénes/i.test(normalized)) {
      if (contacts.length === 0) {
        const msg = "No tengo contactos cargados. Intenta recargar la página.";
        addMessage('goyo', msg);
        speak(msg);
        return;
      }
      const names = contacts.slice(0, 6).map(c => c.email.split('@')[0]).join(', ');
      const msg = `Mis contactos son: ${names}. Dime un nombre y cuánto enviar.`;
      addMessage('goyo', msg);
      speak(msg);
      return;
    }

    // Detectar transferencia con monto
    const amountMatch = normalized.match(/(\d+(?:\.\d+)?)/);
    const amount = amountMatch ? parseFloat(amountMatch[1]) : null;

    // Buscar nombre en el texto
    const words = normalized.split(/\s+/);
    let foundContact: Contact | null = null;
    
    for (const word of words) {
      if (word.length > 2 && !/^\d+$/.test(word) && !['envía', 'envia', 'manda', 'lumens', 'lumen', 'xlm', 'a'].includes(word.toLowerCase())) {
        const contact = findContact(word);
        if (contact) {
          foundContact = contact;
          break;
        }
      }
    }

    // Tenemos monto y contacto
    if (amount && foundContact) {
      setPendingTransfer({ amount, toEmail: foundContact.email, toAddress: foundContact.stellar_address });
      const msg = `¿Envío ${amount} lumens a ${foundContact.email}? Di sí para confirmar.`;
      addMessage('goyo', msg);
      speak(msg);
      return;
    }

    // Solo monto, preguntar a quién
    if (amount && !foundContact) {
      setPendingAmount(amount);
      const names = contacts.slice(0, 4).map(c => c.email.split('@')[0]).join(', ');
      const msg = `${amount} lumens, ¿a quién? Tengo: ${names}...`;
      addMessage('goyo', msg);
      speak(msg);
      return;
    }

    // Solo nombre, preguntar cuánto
    if (foundContact && !amount) {
      const msg = `Encontré a ${foundContact.email}. ¿Cuántos lumens le envío?`;
      addMessage('goyo', msg);
      speak(msg);
      return;
    }

    // No entendió
    const names = contacts.slice(0, 3).map(c => c.email.split('@')[0]).join(', ');
    const msg = `Dime algo como: "50 lumens a ${contacts[0]?.email.split('@')[0] || 'nombre'}". O di "lista" para ver contactos.`;
    addMessage('goyo', msg);
    speak(msg);
  };

  const executeTransfer = async () => {
    if (!pendingTransfer || !wallet) return;

    try {
      setStatus("💸 Enviando...");
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
            destination: pendingTransfer.toAddress,
            asset: Asset.native(),
            amount: pendingTransfer.amount.toString(),
          })
        )
        .addMemo(Memo.text("Goyo"))
        .setTimeout(60)
        .build();

      const result = await signAndSubmit(tx.toXDR());
      const txHash = result?.txHash || "ok";

      const msg = `¡Listo! Envié ${pendingTransfer.amount} lumens a ${pendingTransfer.toEmail.split('@')[0]}. ¿Algo más?`;
      addMessage('goyo', msg);
      speak(msg);
      setStatus(`✅ Enviado`);
      setPendingTransfer(null);

    } catch (error: any) {
      const msg = `Error: ${error.message}. ¿Intentamos de nuevo?`;
      addMessage('goyo', msg);
      speak(msg);
      setStatus("");
      setPendingTransfer(null);
    }
  };

  const quickSend = (contact: Contact) => {
    processConversation(`envía 10 lumens a ${contact.email}`);
  };

  return (
    <div className="h-screen bg-black text-white flex flex-col">
      {/* Header fijo */}
      <div className="p-3 border-b border-zinc-800">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">🎙️ Goyo</h1>
          <ConnectButton />
        </div>
        {wallet && (
          <p className="text-sm text-zinc-400 mt-1">{balance || "0"} XLM</p>
        )}
      </div>

      {/* Chat scrolleable */}
      <div ref={chatRef} className="flex-1 overflow-y-auto p-3 space-y-3 pb-32">
        {!wallet && (
          <div className="text-center text-zinc-500 py-8">
            <p className="text-lg mb-2">👆 Conecta tu wallet para empezar</p>
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

        {status && (
          <p className="text-center text-sm text-zinc-400">{status}</p>
        )}
      </div>

      {/* Contactos rápidos */}
      {wallet && contacts.length > 0 && (
        <div className="px-3 pb-2">
          <p className="text-xs text-zinc-500 mb-2">Envío rápido (10 XLM):</p>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {contacts.slice(0, 6).map(contact => (
              <button
                key={contact.email}
                onClick={() => quickSend(contact)}
                className="bg-zinc-800 px-3 py-2 rounded-full text-xs whitespace-nowrap hover:bg-zinc-700"
              >
                {contact.email.split('@')[0]}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Botón fijo abajo */}
      {wallet && (
        <div className="p-3 border-t border-zinc-800 bg-black">
          <button
            onClick={startListening}
            disabled={listening || loading}
            className={`w-full py-4 rounded-2xl text-lg font-bold transition-all ${
              listening
                ? "bg-red-600 animate-pulse"
                : "bg-white text-black active:scale-95"
            }`}
          >
            {listening ? "🎤 Escuchando..." : "🎤 Hablar"}
          </button>
        </div>
      )}
    </div>
  );
}
