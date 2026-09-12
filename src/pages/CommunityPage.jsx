import React, { useEffect, useState } from 'react';
import { ArrowRight, BookOpen, CircleAlert, ExternalLink, Flag, Flower2, Heart, MessageCircle, Search, Send, ShieldCheck, Sparkles, Users } from 'lucide-react';
import { api } from '../api';
import { EmptyState, ErrorState, LoadingState, Modal, PageIntro } from '../components/Layout';

const defaultTopics = ['Cycle care', 'Mood & energy', 'Thyroid & labs', 'Contraception', 'Pregnancy', 'PCOS'];

export function CommunityPage({ user, profile, onNotify }) {
  const [section, setSection] = useState('community');
  const [posts, setPosts] = useState([]);
  const [topics, setTopics] = useState([]);
  const [activeTopic, setActiveTopic] = useState('All');
  const [search, setSearch] = useState('');
  const [knowledge, setKnowledge] = useState([]);
  const [knowledgeTopics, setKnowledgeTopics] = useState([]);
  const [expandedArticle, setExpandedArticle] = useState(null);
  const [form, setForm] = useState({ body: '', topic: 'Cycle care', anonymous: profile.anonymousByDefault });
  const [replying, setReplying] = useState(null);
  const [reporting, setReporting] = useState(null);
  const [moderationOpen, setModerationOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [error, setError] = useState('');

  const loadPosts = async (topic = activeTopic, query = search) => {
    const params = new URLSearchParams({ topic, ...(query ? { search: query } : {}) });
    const data = await api(`/community?${params}`);
    setPosts(data.posts);
    setTopics([...new Set([...defaultTopics, ...data.topics])]);
  };

  const loadKnowledge = async (topic = 'All', query = search) => {
    const params = new URLSearchParams({ topic, ...(query ? { search: query } : {}) });
    const data = await api(`/knowledge?${params}`);
    setKnowledge(data.articles);
    setKnowledgeTopics(data.topics);
  };

  useEffect(() => {
    Promise.all([loadPosts(), loadKnowledge()]).catch((nextError) => setPageError(nextError.message)).finally(() => setLoading(false));
  }, []);

  const submitPost = async (event) => {
    event.preventDefault();
    const validationError = validateCommunityPost(form);
    if (validationError) return setError(validationError);
    try {
      await api('/community', { method: 'POST', body: JSON.stringify(form) });
      setForm((current) => ({ ...current, body: '' }));
      await loadPosts();
      onNotify(form.anonymous ? 'Posted anonymously to the circle.' : 'Shared with the HerHealth circle.');
    } catch (nextError) {
      setError(nextError.message);
    }
  };

  const chooseTopic = async (topic) => {
    setActiveTopic(topic);
    try { await loadPosts(topic); setPageError(''); } catch (nextError) { setPageError(nextError.message); }
  };

  const doSearch = async (event) => {
    event.preventDefault();
    try {
      if (section === 'community') await loadPosts(activeTopic, search);
      else await loadKnowledge(activeTopic, search);
      setPageError('');
    } catch (nextError) { setPageError(nextError.message); }
  };

  const like = async (post) => {
    try {
      const result = await api(`/community/${post.id}/like`, { method: 'POST', body: '{}' });
      setPosts((current) => current.map((item) => item.id === post.id ? { ...item, liked: result.liked, likes: result.likes } : item));
    } catch (nextError) { setError(nextError.message); }
  };

  const canModerate = ['moderator', 'platform_admin'].includes(user.role);

  if (loading) return <div className="page-wrap"><LoadingState label="Opening the HerHealth circle" /></div>;
  if (pageError && !posts.length && !knowledge.length) return <div className="page-wrap"><ErrorState title="We couldn't open the community right now" copy={pageError} action={<button className="secondary-button" onClick={() => { setLoading(true); Promise.all([loadPosts(), loadKnowledge()]).catch((nextError) => setPageError(nextError.message)).finally(() => setLoading(false)); }}>Try again</button>} /></div>;

  return <div className="page-wrap inner-page community-page">
    <PageIntro eyebrow="Community & knowledge" title={<>No one should navigate<br /><em>their health alone.</em></>} copy="A thoughtfully moderated circle for lived experience, plus a source-linked library for reliable starting points." icon={<Users size={31} />} actions={canModerate && <button className="secondary-button" onClick={() => setModerationOpen(true)}><ShieldCheck size={15} />Moderation queue</button>} />

    <div className="page-switch"><button className={section === 'community' ? 'active' : ''} onClick={() => { setSection('community'); setActiveTopic('All'); }}><Users size={16} />Community circle</button><button className={section === 'knowledge' ? 'active' : ''} onClick={() => { setSection('knowledge'); setActiveTopic('All'); }}><BookOpen size={16} />Knowledge garden</button></div>
    <form className="search-bar" onSubmit={doSearch}><Search size={17} /><label className="sr-only" htmlFor="community-search">Search</label><input id="community-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={section === 'community' ? 'Search conversations...' : 'Search trusted health topics...'} /><button>Search</button></form>
    {(pageError || error) && <div className="page-error" role="alert"><CircleAlert size={17} />{pageError || error}<button onClick={() => { setPageError(''); setError(''); }}>Dismiss</button></div>}

    {section === 'community' ? <section className="community-layout">
      <div className="feed-column">
        <form className="composer" onSubmit={submitPost}>
          <span className="avatar large">{user.name[0].toUpperCase()}</span>
          <div className="composer-main"><textarea value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} maxLength={3000} placeholder="Share a question, pattern, or gentle win..." /><div className="composer-options"><select value={form.topic} onChange={(event) => setForm({ ...form, topic: event.target.value })}>{topics.map((topic) => <option key={topic}>{topic}</option>)}</select><label className="mini-check"><input type="checkbox" checked={form.anonymous} onChange={(event) => setForm({ ...form, anonymous: event.target.checked })} />Post anonymously</label><button className="primary-button" disabled={!form.body.trim()}>Share<Send size={15} /></button></div></div>
        </form>
        <div className="topic-row">{['All', ...topics].map((topic) => <button className={activeTopic === topic ? 'topic active' : 'topic'} onClick={() => chooseTopic(topic)} key={topic}>{topic}</button>)}</div>
        <div className="feed">{posts.length ? posts.map((post) => <PostCard post={post} onLike={() => like(post)} onReply={() => setReplying(post)} onReport={() => setReporting(post)} key={post.id} />) : <EmptyState icon="✿" title="A quiet corner" copy="No conversations match this filter yet. You can be the first to begin one." />}</div>
      </div>
      <aside className="community-aside">
        <div className="aside-card question-card"><Flower2 size={24} /><p className="eyebrow">Today’s gentle question</p><h3>What is one thing your body is asking for this week?</h3><button className="text-button" onClick={() => setForm((current) => ({ ...current, body: 'One thing my body is asking for this week is ' }))}>Write a response<ArrowRight size={14} /></button></div>
        <div className="aside-card circle-rules"><div className="panel-title"><span>How we care for this space</span><ShieldCheck size={18} /></div><p>Share lived experience, not diagnosis. Respect privacy. Report unsafe or harmful content so moderators can review it.</p><span><Sparkles size={14} />Anonymous posts remain attributable to moderators for safety.</span></div>
      </aside>
    </section> : <KnowledgeGarden articles={knowledge} topics={knowledgeTopics} activeTopic={activeTopic} onTopic={async (topic) => { setActiveTopic(topic); const data = await api(`/knowledge?topic=${encodeURIComponent(topic)}`); setKnowledge(data.articles); }} onExpand={setExpandedArticle} />}

    {replying && <ReplyModal post={replying} profile={profile} onClose={() => setReplying(null)} onSaved={async () => { setReplying(null); await loadPosts(); onNotify('Your reply has joined the conversation.'); }} />}
    {reporting && <ReportModal post={reporting} onClose={() => setReporting(null)} onSaved={() => { setReporting(null); onNotify('Thank you. A moderator can now review that post.'); }} />}
    {expandedArticle && <ArticleModal article={expandedArticle} onClose={() => setExpandedArticle(null)} />}
    {moderationOpen && <ModerationModal onClose={() => setModerationOpen(false)} onUpdated={loadPosts} />}
  </div>;
}

function validateCommunityPost(form) {
  const body = String(form.body || '').trim();
  if (body.length < 3 || body.length > 3000) return 'Posts must be between 3 and 3,000 characters.';
  if (String(form.topic || '').trim().length < 2) return 'Choose a topic for your post.';
  return '';
}

function PostCard({ post, onLike, onReply, onReport }) {
  return <article className="post-card"><header><span className={`avatar ${post.anonymous ? 'anonymous' : ''}`}>{post.anonymous ? '✿' : post.author[0]}</span><div><strong>{post.author}</strong>{post.internalAuthor && post.anonymous && <em>Visible to moderators: {post.internalAuthor}</em>}<small>{post.topic} · {new Date(post.createdAt).toLocaleDateString()}</small></div><button className="flag-button" onClick={onReport} aria-label="Report post"><Flag size={14} /></button></header><p>{post.body}</p><div className="post-actions"><button className={post.liked ? 'liked' : ''} onClick={onLike}><Heart size={16} fill={post.liked ? 'currentColor' : 'none'} />{post.likes}</button><button onClick={onReply}><MessageCircle size={16} />{post.comments.length} {post.comments.length === 1 ? 'reply' : 'replies'}</button></div>{post.comments.length > 0 && <div className="comments">{post.comments.map((comment) => <div key={comment.id}><span className="avatar tiny">{comment.anonymous ? '✿' : comment.author[0]}</span><p><strong>{comment.author}</strong>{comment.body}<small>{new Date(comment.createdAt).toLocaleString()}</small></p></div>)}</div>}</article>;
}

function KnowledgeGarden({ articles, topics, activeTopic, onTopic, onExpand }) {
  return <section className="knowledge-layout"><aside className="knowledge-topics"><p className="eyebrow">Browse by topic</p>{['All', ...topics].map((topic) => <button className={activeTopic === topic ? 'active' : ''} onClick={() => onTopic(topic)} key={topic}>{topic}<ArrowRight size={13} /></button>)}</aside><div className="article-grid">{articles.length ? articles.map((article, index) => <article className={`knowledge-card tone-${index % 4}`} key={article.id}><span>{article.topic}</span><h2>{article.title}</h2><p>{article.summary}</p><button onClick={() => onExpand(article)}>Read the guide<ArrowRight size={14} /></button><i aria-hidden="true">{index % 2 ? '❀' : '✿'}</i></article>) : <EmptyState icon="❀" title="No guides found" copy="Try another topic or search phrase." />}</div></section>;
}

function ReplyModal({ post, profile, onClose, onSaved }) {
  const [body, setBody] = useState('');
  const [anonymous, setAnonymous] = useState(profile.anonymousByDefault);
  const [error, setError] = useState('');
  const submit = async (event) => {
    event.preventDefault();
    if (body.trim().length < 1 || body.trim().length > 1500) return setError('Comments must be between 1 and 1,500 characters.');
    try {
      await api(`/community/${post.id}/comments`, { method: 'POST', body: JSON.stringify({ body, anonymous }) });
      onSaved();
    } catch (nextError) {
      setError(nextError.message);
    }
  };
  return <Modal title="Add a supportive reply" onClose={onClose}><form className="stack-form" onSubmit={submit}><div className="quoted-post">“{post.body.slice(0, 180)}{post.body.length > 180 ? '…' : ''}”</div><label>Your reply<textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={1500} required autoFocus /></label><label className="mini-check"><input type="checkbox" checked={anonymous} onChange={(event) => setAnonymous(event.target.checked)} />Reply anonymously</label>{error && <div className="form-error">{error}</div>}<button className="primary-button">Post reply<Send size={15} /></button></form></Modal>;
}

function ReportModal({ post, onClose, onSaved }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const submit = async (event) => {
    event.preventDefault();
    if (reason.trim().length < 3 || reason.trim().length > 500) return setError('Please provide a brief reason.');
    try {
      await api(`/community/${post.id}/report`, { method: 'POST', body: JSON.stringify({ reason }) });
      onSaved();
    } catch (nextError) {
      setError(nextError.message);
    }
  };
  return <Modal title="Report this post" onClose={onClose}><form className="stack-form" onSubmit={submit}><p className="modal-copy">Reports are private. A moderator will review the post and your reason.</p><label>What concerns you?<textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={500} required placeholder="Unsafe advice, harassment, spam..." /></label>{error && <div className="form-error">{error}</div>}<button className="primary-button">Send to moderation<Flag size={15} /></button></form></Modal>;
}

function ArticleModal({ article, onClose }) {
  return <Modal title={article.title} onClose={onClose} wide><article className="article-detail"><span>{article.topic}</span><p>{article.content}</p><div className="source-box"><BookOpen size={18} /><div><small>Approved source</small><a href={article.source.url} target="_blank" rel="noreferrer">{article.source.title}<ExternalLink size={12} /></a></div></div><p className="medical-disclaimer">Educational information only. It does not replace personal medical advice.</p></article></Modal>;
}

function ModerationModal({ onClose, onUpdated }) {
  const [reports, setReports] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api('/moderation/reports').then((data) => setReports(data.reports)).catch((nextError) => setError(nextError.message)); }, []);
  const review = async (report, status) => { try { await api(`/moderation/reports/${report.id}`, { method: 'PATCH', body: JSON.stringify({ status, note: status === 'actioned' ? 'Post hidden after moderator review.' : 'Reviewed by moderator.' }) }); setReports((current) => current.map((item) => item.id === report.id ? { ...item, status } : item)); await onUpdated(); } catch (nextError) { setError(nextError.message); } };
  return <Modal title="Community moderation queue" onClose={onClose} wide>{error && <div className="form-error">{error}</div>}{reports === null ? <LoadingState /> : reports.length ? <div className="moderation-list">{reports.map((report) => <article key={report.id}><header><span className={`status-chip ${report.status}`}>{report.status}</span><small>{new Date(report.created_at).toLocaleString()}</small></header><p><b>Reported:</b> {report.post_body}</p><p><b>Reason:</b> {report.reason}</p>{report.status === 'open' && <div><button className="secondary-button" onClick={() => review(report, 'dismissed')}>Dismiss</button><button className="primary-button" onClick={() => review(report, 'actioned')}>Hide content</button></div>}</article>)}</div> : <EmptyState title="Queue is clear" copy="There are no reports waiting for review." />}</Modal>;
}
