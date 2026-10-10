import { useState } from 'react';
import { tr } from '../lib/i18n';
import { UsageDetail } from './Sidebar';
import { IconTrash } from './icons';

export default function SettingsModal({ settings, onSave, onClose, usage, onClearAll }) {
  const [temperature, setTemperature] = useState(settings.temperature);
  const [maxTokens, setMaxTokens] = useState(settings.maxTokens);
  const [systemPrompt, setSystemPrompt] = useState(settings.systemPrompt);

  return (
    <div className="modal-bg" onClick={(e) => { if (e.target.className === 'modal-bg') onClose(); }}>
      <div className="modal">
        <h3>{tr('settings')}</h3>
        <div className="sub">{tr('settings_sub')}</div>

        <div className="field">
          <label>{tr('usage_title')} <span className="val">{tr('usage_resets')}</span></label>
          <UsageDetail usage={usage} />
        </div>

        <div className="field">
          <label>{tr('temp')} <span className="val">{Number(temperature).toFixed(1)}</span></label>
          <input type="range" min="0" max="2" step="0.1" value={temperature}
            onChange={(e) => setTemperature(parseFloat(e.target.value))} />
        </div>

        <div className="field">
          <label>{tr('max_tokens')} <span className="val">{maxTokens.toLocaleString()}</span></label>
          <input type="range" min="256" max="32000" step="256" value={maxTokens}
            onChange={(e) => setMaxTokens(parseInt(e.target.value, 10))} />
        </div>

        <div className="field">
          <label>{tr('sys_prompt')}</label>
          <textarea rows={3} value={systemPrompt}
            placeholder={tr('sys_prompt_ph')}
            onChange={(e) => setSystemPrompt(e.target.value)} />
        </div>

        <div className="modal-btns">
          <button className="btn-primary" onClick={() => onSave({ temperature, maxTokens, systemPrompt })}>{tr('save')}</button>
          <button className="btn-ghost" onClick={onClose}>{tr('close')}</button>
        </div>

        <div className="danger-zone">
          <button onClick={onClearAll}><IconTrash />{tr('delete_all')}</button>
        </div>
      </div>
    </div>
  );
}
