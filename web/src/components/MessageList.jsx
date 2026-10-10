import { useEffect, useRef } from 'react';
import { tr } from '../lib/i18n';
import { renderMarkdown, enhanceRendered } from '../lib/markdown';
import { shortModel } from './ModelPicker';
import { IconCopy, IconRefresh, IconLogo, IconUser, IconArrowDown } from './icons';

function AgentSteps({ steps, streaming }) {
  if (!steps || !steps.length) return null;
  return (
    <details className="agent-steps" open={streaming}>
      <summary>{tr('agent_steps')} · {steps.length}</summary>
      <div className="steps">
        {steps.map((s, i) => (
          <div key={i} className={'astep ' + s.kind}>
            {s.kind === 'thought' && (<><span className="ak">{tr('agent_thought')}</span><p>{s.text}</p></>)}
            {s.kind === 'action' && (<><span className="ak">{tr('agent_action')}: <b>{s.tool}</b></span>{s.input ? <code>{s.input}</code> : null}</>)}
            {s.kind === 'observation' && (<><span className="ak">{tr('agent_observation')}</span><p>{s.text}</p></>)}
          </div>
        ))}
      </div>
    </details>
  );
}

function AssistantMsg({ msg, streaming, modelLabel, isLast, onRegenerate, onCopy }) {
  const bodyRef = useRef(null);
  useEffect(() => { enhanceRendered(bodyRef.current, msg.content); });

  if (msg.errorNote) {
    return (
      <div className="msg assistant">
        <div className="avatar"><IconLogo width={20} height={20} /></div>
        <div className="body">
          <div className="who">{modelLabel}</div>
          <div className="note-card err"><b>{tr('err_prefix')}</b>{msg.content}</div>
          <div className="meta">
            {isLast && (
              <button className="chip-btn" onClick={onRegenerate}><IconRefresh />{tr('try_again')}</button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (msg.limitNote) {
    return (
      <div className="msg assistant">
        <div className="avatar"><IconLogo width={20} height={20} /></div>
        <div className="body">
          <div className="who">{modelLabel}</div>
          <div className="note-card limit"><b>{tr('limit_title')}</b>{msg.content}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="msg assistant">
      <div className="avatar"><IconLogo width={20} height={20} /></div>
      <div className="body">
        <div className="who">{modelLabel}{msg.agent ? ' · ' + tr('agent_mode') : ''}</div>
        <AgentSteps steps={msg.steps} streaming={streaming} />
        <div className="bubble md" ref={bodyRef}>
          {msg.content
            ? <span dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
            : <span className="typing-dots"><i /><i /><i /></span>}
          {streaming && msg.content ? <span className="typing-cursor" /> : null}
        </div>
        {!streaming && msg.content && (
          <div className="meta">
            <button className="chip-btn" onClick={() => onCopy(msg.content)}><IconCopy />{tr('copy')}</button>
            {isLast && (
              <button className="chip-btn" onClick={onRegenerate}><IconRefresh />{tr('regenerate')}</button>
            )}
            {msg.usage && msg.usage.total_tokens ? (
              <span className="tokens">{msg.usage.total_tokens.toLocaleString()} {tr('tokens')}</span>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function UserMsg({ msg }) {
  return (
    <div className="msg user">
      <div className="avatar"><IconUser /></div>
      <div className="body">
        <div className="bubble">{msg.content}</div>
      </div>
    </div>
  );
}

function Welcome({ onPick }) {
  const cards = [
    { t: tr('sug_learn_t'), s: tr('sug_learn_s'), q: tr('sug_learn_q') },
    { t: tr('sug_code_t'), s: tr('sug_code_s'), q: tr('sug_code_q') },
    { t: tr('sug_study_t'), s: tr('sug_study_s'), q: tr('sug_study_q') },
    { t: tr('sug_msg_t'), s: tr('sug_msg_s'), q: tr('sug_msg_q') },
  ];
  return (
    <div className="welcome">
      <div className="wlogo"><IconLogo width={68} height={68} /></div>
      <h2>{tr('welcome_title')}</h2>
      <p>{tr('welcome_sub')}</p>
      <div className="suggest">
        {cards.map((g) => (
          <button key={g.t} onClick={() => onPick(g.q)}>
            <b>{g.t}</b><span>{g.s}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function MessageList({ convo, streamingId, onRegenerate, onCopy, onSuggestion }) {
  const scrollRef = useRef(null);
  const stickRef = useRef(true);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    const btn = document.getElementById('toBottomBtn');
    if (btn) btn.classList.toggle('show', !stickRef.current);
  };

  useEffect(() => {
    if (stickRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  });

  useEffect(() => { stickRef.current = true; }, [convo && convo.id]);

  const scrollDown = () => {
    stickRef.current = true;
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  };

  const msgs = (convo && convo.messages) || [];

  return (
    <>
      <div className="msg-scroll" ref={scrollRef} onScroll={handleScroll}>
        <div className="msg-inner">
          {msgs.length === 0 && <Welcome onPick={onSuggestion} />}
          {msgs.map((m, i) => {
            const isLast = i === msgs.length - 1;
            const streaming = m.id === streamingId;
            if (m.role === 'user') return <UserMsg key={m.id} msg={m} />;
            return (
              <AssistantMsg
                key={m.id}
                msg={m}
                streaming={streaming}
                modelLabel={shortModel(m.model || convo.model)}
                isLast={isLast}
                onRegenerate={onRegenerate}
                onCopy={onCopy}
              />
            );
          })}
        </div>
      </div>
      <button id="toBottomBtn" className="to-bottom" onClick={scrollDown} title={tr('scroll_bottom')}>
        <IconArrowDown />
      </button>
    </>
  );
}
