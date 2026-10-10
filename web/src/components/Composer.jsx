import { useEffect, useRef } from 'react';
import { tr } from '../lib/i18n';
import { IconSend, IconStop } from './icons';

export default function Composer({ onSend, streaming, onStop }) {
  const taRef = useRef(null);

  const grow = () => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 170) + 'px';
  };

  useEffect(() => { grow(); }, []);

  const submit = () => {
    if (streaming) return;
    const v = taRef.current.value.trim();
    if (!v) return;
    taRef.current.value = '';
    grow();
    onSend(v);
  };

  return (
    <div className="composer-zone">
      <div className="composer">
        <textarea
          ref={taRef}
          rows={1}
          placeholder={tr('composer_ph')}
          onInput={grow}
          disabled={streaming}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
          }}
        />
        <button
          className={'send-btn' + (streaming ? ' stop' : '')}
          onClick={streaming ? onStop : submit}
          title={streaming ? tr('stop_gen') : tr('send_msg')}
          aria-label={streaming ? tr('stop_gen') : tr('send_msg')}
        >
          {streaming ? <IconStop /> : <IconSend />}
        </button>
      </div>
      <div className="composer-hint">{tr('composer_hint')}</div>
    </div>
  );
}
