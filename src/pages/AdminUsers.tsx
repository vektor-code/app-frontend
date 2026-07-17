import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api/client';
import type { PermissionTemplate, UserPermission } from '../entities';
import { useTranslation } from '../utils/i18n';

const ALL_NS = '*';

function AccessSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label?: string;
}) {
  return (
    <label className="admin-switch">
      {label && <span>{label}</span>}
      <input type="checkbox" checked={checked} onChange={onChange} />
      <i />
    </label>
  );
}

function NamespacePicker({ selected, options, onChange }: {
  selected: string[];
  options: string[];
  onChange: (ns: string[]) => void;
}) {
  const allSelected = selected.includes(ALL_NS);
  const toggle = (ns: string) => {
    if (ns === ALL_NS) {
      onChange(allSelected ? [] : [ALL_NS]);
      return;
    }
    const withoutAll = selected.filter(n => n !== ALL_NS);
    if (withoutAll.includes(ns)) {
      onChange(withoutAll.filter(n => n !== ns));
    } else {
      onChange([...withoutAll, ns]);
    }
  };

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
      <button
        type="button"
        onClick={() => toggle(ALL_NS)}
        className="ns-chip"
        style={{
          background: allSelected ? 'rgba(99, 102, 241, 0.18)' : 'var(--bg-tertiary)',
          borderColor: allSelected ? 'var(--accent-indigo)' : 'var(--border-primary)',
          color: allSelected ? 'var(--accent-indigo-light)' : 'var(--text-secondary)',
          fontWeight: 700,
        }}
      >
        ✳ All namespaces
      </button>
      {options.map(ns => {
        const active = !allSelected && selected.includes(ns);
        return (
          <button
            key={ns}
            type="button"
            onClick={() => toggle(ns)}
            className="ns-chip"
            disabled={allSelected}
            style={{
              background: active ? 'rgba(16, 185, 129, 0.15)' : 'var(--bg-tertiary)',
              borderColor: active ? 'var(--accent-emerald, #10b981)' : 'var(--border-primary)',
              color: active ? 'var(--accent-emerald, #10b981)' : 'var(--text-secondary)',
              opacity: allSelected ? 0.45 : 1,
            }}
          >
            {ns}
          </button>
        );
      })}
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  const isAdmin = role === 'admin';
  return (
    <span style={{
      fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '4px', textTransform: 'uppercase',
      background: isAdmin ? 'rgba(244, 63, 94, 0.12)' : 'rgba(14, 165, 233, 0.12)',
      color: isAdmin ? 'var(--accent-rose, #f43f5e)' : 'var(--accent-cyan, #0ea5e9)',
      border: `1px solid ${isAdmin ? 'rgba(244, 63, 94, 0.3)' : 'rgba(14, 165, 233, 0.3)'}`,
    }}>{role}</span>
  );
}

function nsSummary(namespaces: string[]): string {
  if (namespaces && namespaces.includes(ALL_NS)) return 'All namespaces';
  if (!namespaces || namespaces.length === 0) return 'No access';
  return namespaces.join(', ');
}

export default function AdminUsers() {
  const { t } = useTranslation();
  const [users, setUsers] = useState<UserPermission[]>([]);
  const [templates, setTemplates] = useState<PermissionTemplate[]>([]);
  const [namespaceOptions, setNamespaceOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const [editUser, setEditUser] = useState<UserPermission | null>(null);
  const [editTemplate, setEditTemplate] = useState<PermissionTemplate | null>(null);

  const notify = (kind: 'ok' | 'err', text: string) => {
    setMessage({ kind, text });
    setTimeout(() => setMessage(null), 3500);
  };

  const load = useCallback(async () => {
    try {
      const [usersRes, tplRes, nsRes] = await Promise.all([
        api.getUsers(),
        api.getPermissionTemplates(),
        api.getNamespaces(),
      ]);
      setUsers(usersRes.users || []);
      setTemplates(tplRes.templates || []);
      setNamespaceOptions(nsRes.namespaces || []);
    } catch (e: any) {
      notify('err', `Failed to load users: ${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveUser = async (u: UserPermission) => {
    const payload = u.role === 'admin' ? { ...u, namespaces: [ALL_NS] } : u;
    try {
      await api.saveUser(payload);
      notify('ok', `Permissions updated for ${u.username}`);
      setEditUser(null);
      load();
    } catch (e: any) {
      notify('err', `Save failed: ${e?.message || e}`);
    }
  };

  const removeUser = async (username: string) => {
    if (!window.confirm(`Remove "${username}"? Default template applies on next login.`)) return;
    try {
      await api.deleteUser(username);
      notify('ok', `Removed ${username}`);
      load();
    } catch (e: any) {
      notify('err', `Delete failed: ${e?.message || e}`);
    }
  };

  const saveTemplate = async (t: PermissionTemplate) => {
    if (!t.name.trim()) { notify('err', 'Template name is required'); return; }
    const payload = t.role === 'admin' ? { ...t, namespaces: [ALL_NS] } : t;
    try {
      await api.savePermissionTemplate(payload);
      notify('ok', `Template "${t.name}" saved`);
      setEditTemplate(null);
      load();
    } catch (e: any) {
      notify('err', `Save failed: ${e?.message || e}`);
    }
  };

  const removeTemplate = async (name: string) => {
    if (!window.confirm(`Delete template "${name}"? Existing users keep their current permissions.`)) return;
    try {
      await api.deletePermissionTemplate(name);
      notify('ok', `Template "${name}" deleted`);
      load();
    } catch (e: any) {
      notify('err', `Delete failed: ${e?.message || e}`);
    }
  };

  const applyTemplateToUser = (u: UserPermission, tplName: string) => {
    const tpl = templates.find(t => t.name === tplName);
    if (!tpl) return u;
    return { ...u, role: tpl.role, namespaces: tpl.role === 'admin' ? [ALL_NS] : [...tpl.namespaces], template: tpl.name };
  };

  if (loading) {
    return <div className="empty-state"><div className="empty-state-title">{t('Loading users & permissions…')}</div></div>;
  }

  return (
    <div className="admin-users-page">
      {message && (
        <div className={`admin-users-message ${message.kind}`}>{message.text}</div>
      )}

      <div>
        <div className="admin-section-heading action">
          <div>
            <span>{t('Access presets')}</span>
            <h2>{t('Permission Templates')}</h2>
            <p>{t('The default template is applied to new users on first login.')}</p>
          </div>
          <button className="admin-new-template-btn" onClick={() => setEditTemplate({ name: '', description: '', role: 'viewer', namespaces: [ALL_NS], isDefault: templates.length === 0 })}>
            {t('New Template')}
          </button>
        </div>

        {templates.length === 0 ? (
          <div className="admin-empty-card">
            {t('No templates. New users start with no access — mark a template as default to grant a baseline automatically.')}
          </div>
        ) : (
          <div className="admin-access-grid">
            {templates.map(tpl => (
              <div key={tpl.name} className={`admin-access-card ${tpl.role === 'admin' ? 'admin-role' : ''}`}>
                <div className="admin-access-card-top">
                  <div className="admin-access-avatar">{tpl.role === 'admin' ? 'A' : 'V'}</div>
                  <div className="admin-access-title">
                    <strong>{tpl.name}</strong>
                    <span>{tpl.description || (tpl.role === 'admin' ? t('Full platform access') : t('Namespace access preset'))}</span>
                  </div>
                  <RoleBadge role={tpl.role} />
                </div>

                <div className="admin-access-meta">
                  <span>{t('Access')}</span>
                  <code>{tpl.role === 'admin' ? t('Full platform access') : nsSummary(tpl.namespaces)}</code>
                </div>
                <div className="admin-access-flags">
                  {tpl.isDefault && <span>{t('Default')}</span>}
                  <span>{tpl.role === 'admin' ? t('No namespace filter') : t('Namespace scoped')}</span>
                </div>
                <div className="admin-access-actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditTemplate({ ...tpl, namespaces: [...tpl.namespaces] })}>{t('Edit')}</button>
                  <button className="btn btn-ghost btn-sm" style={{ color: 'var(--accent-rose, #f43f5e)' }} onClick={() => removeTemplate(tpl.name)}>{t('Delete')}</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="admin-section-heading compact">
          <div>
            <span>{t('LDAP identities')}</span>
            <h2>{t('Users')}</h2>
            <p>{t('Users appear after first login. Namespace changes apply in seconds.')}</p>
          </div>
        </div>

        {users.length === 0 ? (
          <div className="admin-empty-card">
            {t('No LDAP logins yet.')}
          </div>
        ) : (
          <div className="admin-users-table-card">
            <table className="admin-users-table">
              <thead>
                <tr>
                  <th>{t('User')}</th>
                  <th>{t('Role')}</th>
                  <th>{t('Namespace visibility')}</th>
                  <th>{t('Template')}</th>
                  <th>{t('Last login')}</th>
                  <th style={{ textAlign: 'right' }}>{t('Actions')}</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.username} className="hover-row">
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontWeight: 700, fontSize: '13px', color: 'var(--text-primary)' }}>{u.displayName || u.username}</span>
                        <span className="mono" style={{ fontSize: '10.5px', color: 'var(--text-tertiary)' }}>{u.username}{u.email ? ` · ${u.email}` : ''}</span>
                      </div>
                    </td>
                    <td><RoleBadge role={u.role} /></td>
                    <td style={{ maxWidth: '340px' }}>
                      <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                        {u.role === 'admin' ? t('Full platform access') : nsSummary(u.namespaces)}
                      </span>
                    </td>
                    <td>
                      <span className="mono" style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{u.template || '—'}</span>
                    </td>
                    <td>
                      <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                        {u.lastLogin && !u.lastLogin.startsWith('1970') ? new Date(u.lastLogin).toLocaleString() : '—'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditUser({ ...u, namespaces: [...(u.namespaces || [ALL_NS])] })}>Edit</button>
                      <button className="btn btn-ghost btn-sm" style={{ color: 'var(--accent-rose, #f43f5e)' }} onClick={() => removeUser(u.username)}>Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editUser && createPortal(
        <div className="admin-modal-backdrop">
          <div className="admin-modal-panel admin-access-modal">
            <div className="admin-modal-header">
              <h3 style={{ fontSize: '17px', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                Permissions — {editUser.displayName || editUser.username}
              </h3>
              <button className="btn btn-ghost" onClick={() => setEditUser(null)} style={{ fontSize: '18px', padding: '4px 8px' }}>✕</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div className="admin-setting-row" style={{ margin: 0 }}>
                <div>
                  <strong>{t('Admin access')}</strong>
                  <span>{editUser.role === 'admin' ? t('Full access') : t('Namespace-scoped viewer')}</span>
                </div>
                <AccessSwitch
                  checked={editUser.role === 'admin'}
                  onChange={() => setEditUser({
                    ...editUser,
                    role: editUser.role === 'admin' ? 'viewer' : 'admin',
                    namespaces: [ALL_NS],
                  })}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Apply template</label>
                <div className="admin-template-picker">
                  {templates.map(template => (
                    <button
                      key={template.name}
                      type="button"
                      onClick={() => setEditUser(applyTemplateToUser(editUser, template.name))}
                    >
                      <span>{template.name}</span>
                      {template.isDefault && <em>Default</em>}
                    </button>
                  ))}
                  {templates.length === 0 && <span>No templates</span>}
                </div>
              </div>
            </div>

            {editUser.role === 'admin' ? (
              <div className="admin-access-full-card">
                <strong>{t('Full platform access')}</strong>
                <span>{t('Namespace filters are not needed for administrators.')}</span>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                  Namespace visibility
                </label>
                <NamespacePicker
                  selected={editUser.namespaces || []}
                  options={namespaceOptions}
                  onChange={ns => setEditUser({ ...editUser, namespaces: ns })}
                />
                {(editUser.namespaces || []).length === 0 && (
                  <span style={{ fontSize: '11px', color: 'var(--accent-rose, #f43f5e)' }}>No namespaces selected — user sees nothing.</span>
                )}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', borderTop: '1px solid var(--border-primary)', paddingTop: '16px' }}>
              <button className="btn btn-ghost" onClick={() => setEditUser(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => saveUser(editUser)}>Save Permissions</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {editTemplate && createPortal(
        <div className="admin-modal-backdrop">
          <div className="admin-modal-panel admin-access-modal">
            <div className="admin-modal-header">
              <h3 style={{ fontSize: '17px', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                {templates.some(t => t.name === editTemplate.name) ? `Edit Template — ${editTemplate.name}` : 'New Permission Template'}
              </h3>
              <button className="btn btn-ghost" onClick={() => setEditTemplate(null)} style={{ fontSize: '18px', padding: '4px 8px' }}>✕</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Template name</label>
                <input type="text" className="form-input" value={editTemplate.name} placeholder="e.g. econtract-team"
                  disabled={templates.some(t => t.name === editTemplate.name)}
                  onChange={e => setEditTemplate({ ...editTemplate, name: e.target.value })} />
              </div>
              <div className="admin-setting-row" style={{ margin: 0 }}>
                <div>
                  <strong>{t('Admin template')}</strong>
                  <span>{editTemplate.role === 'admin' ? t('Full access') : t('Viewer access')}</span>
                </div>
                <AccessSwitch
                  checked={editTemplate.role === 'admin'}
                  onChange={() => setEditTemplate({
                    ...editTemplate,
                    role: editTemplate.role === 'admin' ? 'viewer' : 'admin',
                    namespaces: [ALL_NS],
                  })}
                />
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Description</label>
              <input type="text" className="form-input" value={editTemplate.description} placeholder="Who is this template for?"
                onChange={e => setEditTemplate({ ...editTemplate, description: e.target.value })} />
            </div>

            {editTemplate.role === 'admin' ? (
              <div className="admin-access-full-card">
                <strong>{t('Full platform access')}</strong>
                <span>{t('Admin templates apply to the whole platform, so namespace selection is hidden.')}</span>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Namespace visibility</label>
                <NamespacePicker
                  selected={editTemplate.namespaces || []}
                  options={namespaceOptions}
                  onChange={ns => setEditTemplate({ ...editTemplate, namespaces: ns })}
                />
              </div>
            )}

            <div className="admin-setting-row">
              <div>
                <strong>{t('Default template')}</strong>
                <span>{t('Applied to new LDAP users on first login.')}</span>
              </div>
              <AccessSwitch
                checked={editTemplate.isDefault}
                onChange={() => setEditTemplate({ ...editTemplate, isDefault: !editTemplate.isDefault })}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', borderTop: '1px solid var(--border-primary)', paddingTop: '16px' }}>
              <button className="btn btn-ghost" onClick={() => setEditTemplate(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => saveTemplate(editTemplate)}>Save Template</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      <style>{`
        .ns-chip {
          font-size: 11px;
          font-weight: 600;
          padding: 4px 10px;
          border-radius: 6px;
          border: 1px solid var(--border-primary);
          cursor: pointer;
          transition: all 0.15s;
          font-family: var(--font-mono);
        }
        .ns-chip:hover:not(:disabled) { transform: translateY(-1px); }
      `}</style>
    </div>
  );
}
