import React, { useEffect, useRef, useState } from 'react';
import { Bot, ExternalLink, Send, ShieldAlert, X } from 'lucide-react';
import { api } from '../api';

export function Chatbot({ onClose }) {
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([{
    role: 'assistant',
    text: 'Hi, I’m Nova. Ask me about cycle phases, energy, nutrition, contraception, pregnancy basics, PCOS, or thyroid labs. I’ll answer from approved sources and show where the information came from.'
  }]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef(null);
  const prompts = [
    'How does TSH relate to thyroid labs?',
    'When is pregnancy more likely in my cycle?',
    'How should I think about contraception if I want to avoid pregnancy?'
  ];

  useEffect(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), [messages]);

  const send = async (event) => {
    event.preventDefault();
    const question = input.trim();
    if (!question || sending) return;
    setInput('');
    setError('');
    setMessages((current) => [...current, { role: 'user', text: question }]);
    setSending(true);
    try {
      const result = await api('/chat', { method: 'POST', body: JSON.stringify({ question, conversationId }) });
      setConversationId(result.conversationId);
      setMessages((current) => [...current, { role: 'assistant', text: result.answer, citations: result.citations, urgent: result.urgent }]);
    } catch (error) {
      setError(error.message || 'Nova could not answer right now.');
      setMessages((current) => [...current, { role: 'assistant', text: error.message || 'I could not reach my approved knowledge sources. Please try again.' }]);
    } finally {
      setSending(false);
    }
  };

  const usePrompt = (text) => {
    setInput(text);
    setError('');
  };

  return <aside className="chat-window" aria-label="Nova health guide">
    <header className="chat-header">
      <span className="bot-avatar"><Bot size={18} /></span>
      <div><strong>Nova guide</strong><small>Grounded in approved sources</small></div>
      <button onClick={onClose} aria-label="Close chat"><X size={18} /></button>
    </header>
    <div className="chat-messages" aria-live="polite">
      <div className="chat-prompts">
        {prompts.map((prompt) => <button type="button" key={prompt} className="chat-prompt" onClick={() => usePrompt(prompt)}>{prompt}</button>)}
      </div>
      {messages.map((message, index) => <div className={`bubble ${message.role} ${message.urgent ? 'urgent' : ''}`} key={`${message.role}-${index}`}>
        {message.urgent && <ShieldAlert size={16} />}
        <p>{message.text}</p>
        {message.citations?.length > 0 && <div className="citations"><small>Sources</small>{message.citations.map((citation) => <a key={citation.url} href={citation.url} target="_blank" rel="noreferrer">{citation.article || citation.title}<ExternalLink size={11} /></a>)}</div>}
      </div>)}
      {sending && <div className="bubble assistant typing" aria-label="Nova is finding sources"><i /><i /><i /></div>}
      <div ref={endRef} />
    </div>
    <form className="chat-form" onSubmit={send}>
      <label className="sr-only" htmlFor="nova-question">Ask Nova a question</label>
      <input id="nova-question" value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask a health question..." maxLength={1200} />
      <button aria-label="Send question" disabled={sending || !input.trim()}><Send size={16} /></button>
    </form>
    {error && <small className="chat-error">{error}</small>}
    <small className="chat-disclaimer">Educational only. Nova cannot diagnose or handle emergencies.</small>
  </aside>;
}
