import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api/client';
import type { PermissionTemplate, UserPermission } from '../entities';
import { useTranslation } from '../utils/i18n';

const ALL_NS = '*';

type AccessIconName = 'check' | 'clock' | 'edit' | 'eye' | 'grid' | 'key' | 'shield' | 'trash' | 'users';

function AccessIcon({ name }: { name: AccessIconName }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  switch (name) {
    case 'check':
      return <svg {...common}><path d="m5 12 4 4L19 6" /></svg>;
    case 'clock':
      return <svg {...common}><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></svg>;
    case 'edit':
      return <svg {...common}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>;
    case 'eye':
      return <svg {...common}><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>;
    case 'grid':
      return <svg {...common}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>;
    case 'key':
      return <svg {...common}><circle cx="7.5" cy="14.5" r="3.5" /><path d="m10 12 9-9" /><path d="m15 3 3 3" /><path d="m13 5 3 3" /></svg>;
    case 'shield':
      return <svg {...common}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-5" /></svg>;
    case 'trash':
      return <svg {...common}><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v5" /><path d="M14 11v5" /></svg>;
    case 'users':
      return <svg {...common}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>;
  }
}

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
    <label className="admin-switch admin-access-switch">
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
    <div className="admin-ns-picker">
      <button
        type="button"
        onClick={() => toggle(ALL_NS)}
        className={`ns-chip ${allSelected ? 'active all' : ''}`}
      >
        All namespaces
      </button>
      {options.map(ns => {
        const active = !allSelected && selected.includes(ns);
        return (
          <button
            key={ns}
            type="button"
            onClick={() => toggle(ns)}
            className={`ns-chip ${active ? 'active' : ''}`}
            disabled={allSelected}
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
    <span className={`admin-role-badge ${isAdmin ? 'admin' : 'viewer'}`}>
      <AccessIcon name={isAdmin ? 'shield' : 'eye'} />
      {role}
    </span>
  );
}

function nsSummary(namespaces: string[]): string {
  if (namespaces && namespaces.includes(ALL_NS)) return 'All namespaces';
  if (!namespaces || namespaces.length === 0) return 'No access';
  return namespaces.join(', ');
}

function nsCount(namespaces: string[]): string {
  if (namespaces && namespaces.includes(ALL_NS)) return 'All';
  if (!namespaces || namespaces.length === 0) return '0';
  return namespaces.length.toString();
}

function initials(user: Pick<UserPermission, 'displayName' | 'username'>): string {
  const base = (user.displayName || user.username || '').trim();
  if (!base) return 'U';
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return base.slice(0, 2).toUpperCase();
}

function formatLastLogin(value?: string): string {
  if (!value || value.startsWith('1970')) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Never';
  return date.toLocaleString();
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
          </div>
          <button className="admin-new-template-btn" onClick={() => setEditTemplate({ name: '', description: '', role: 'viewer', namespaces: [ALL_NS], isDefault: templates.length === 0 })}>
            <AccessIcon name="key" />
            {t('New Template')}
          </button>
        </div>

        {templates.length === 0 ? (
          <div className="admin-empty-card">
            {t('No templates.')}
          </div>
        ) : (
          <div className="admin-access-grid">
            {templates.map(tpl => (
              <div key={tpl.name} className={`admin-access-card ${tpl.role === 'admin' ? 'admin-role' : ''}`}>
                <div className="admin-access-card-top">
                  <div className="admin-access-avatar">
                    <AccessIcon name={tpl.role === 'admin' ? 'shield' : 'eye'} />
                  </div>
                  <div className="admin-access-title">
                    <strong>{tpl.name}</strong>
                    <span>{tpl.description || (tpl.role === 'admin' ? t('Platform access') : t('Namespace preset'))}</span>
                  </div>
                  <RoleBadge role={tpl.role} />
                </div>

                <div className="admin-template-scope-grid">
                  <div className="admin-template-scope-card">
                    <span><AccessIcon name="grid" />{t('Scope')}</span>
                    <strong>{tpl.role === 'admin' ? t('Platform') : nsCount(tpl.namespaces)}</strong>
                    <em>{tpl.role === 'admin' ? t('All areas') : t('namespaces')}</em>
                  </div>
                  <div className="admin-template-scope-card">
                    <span><AccessIcon name="users" />{t('Default')}</span>
                    <strong>{tpl.isDefault ? t('Yes') : t('No')}</strong>
                    <em>{tpl.isDefault ? t('New users') : t('Manual')}</em>
                  </div>
                </div>

                <div className="admin-access-meta">
                  <span>{t('Access')}</span>
                  <code>{tpl.role === 'admin' ? t('Full platform') : nsSummary(tpl.namespaces)}</code>
                </div>

                <div className="admin-access-flags">
                  {tpl.isDefault && <span>{t('Default')}</span>}
                  <span>{tpl.role === 'admin' ? t('Platform') : t('Namespace scoped')}</span>
                </div>
                <div className="admin-access-actions">
                  <button className="admin-icon-action" onClick={() => setEditTemplate({ ...tpl, namespaces: [...tpl.namespaces] })} title={t('Edit')}>
                    <AccessIcon name="edit" />
                    {t('Edit')}
                  </button>
                  <button className="admin-icon-action danger" onClick={() => removeTemplate(tpl.name)} title={t('Delete')}>
                    <AccessIcon name="trash" />
                    {t('Delete')}
                  </button>
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
                  <th>{t('Scope')}</th>
                  <th>{t('Template')}</th>
                  <th>{t('Last login')}</th>
                  <th className="admin-actions-head">{t('Actions')}</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.username}>
                    <td>
                      <div className="admin-user-cell">
                        <span className={`admin-user-avatar ${u.role === 'admin' ? 'admin' : ''}`}>{initials(u)}</span>
                        <span className="admin-user-copy">
                          <strong>{u.displayName || u.username}</strong>
                          <em>{u.username}</em>
                          {u.email && <small>{u.email}</small>}
                        </span>
                      </div>
                    </td>
                    <td><RoleBadge role={u.role} /></td>
                    <td>
                      <span className={`admin-scope-cell ${u.role === 'admin' ? 'admin' : ''}`}>
                        <AccessIcon name={u.role === 'admin' ? 'shield' : 'grid'} />
                        <strong>{u.role === 'admin' ? t('Platform') : nsCount(u.namespaces)}</strong>
                        <em>{u.role === 'admin' ? t('Full access') : nsSummary(u.namespaces)}</em>
                      </span>
                    </td>
                    <td>
                      <span className={`admin-template-tag ${u.template ? '' : 'empty'}`}>
                        {u.template || t('Manual')}
                      </span>
                    </td>
                    <td>
                      <span className="admin-last-login">
                        <AccessIcon name="clock" />
                        {formatLastLogin(u.lastLogin)}
                      </span>
                    </td>
                    <td>
                      <div className="admin-user-actions">
                        <button className="admin-icon-action" onClick={() => setEditUser({ ...u, namespaces: [...(u.namespaces || [ALL_NS])] })}>
                          <AccessIcon name="edit" />
                          {t('Edit')}
                        </button>
                        <button className="admin-icon-action danger" onClick={() => removeUser(u.username)}>
                          <AccessIcon name="trash" />
                          {t('Remove')}
                        </button>
                      </div>
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
          <div className="admin-modal-panel admin-access-modal admin-permission-modal">
            <div className="admin-permission-modal-head">
              <div className="admin-modal-user-summary">
                <span className={`admin-user-avatar large ${editUser.role === 'admin' ? 'admin' : ''}`}>{initials(editUser)}</span>
                <div>
                  <span>{t('Edit Permissions')}</span>
                  <h3>{editUser.displayName || editUser.username}</h3>
                  <p>{editUser.username}{editUser.email ? ` / ${editUser.email}` : ''}</p>
                </div>
              </div>
              <button className="admin-modal-close-btn" onClick={() => setEditUser(null)}>x</button>
            </div>

            <div className="admin-permission-grid">
              <section className="admin-permission-card">
                <span className="admin-field-label">{t('Role')}</span>
                <div className="admin-role-choice-grid">
                  <button
                    type="button"
                    className={`admin-role-choice ${editUser.role === 'viewer' ? 'active' : ''}`}
                    onClick={() => setEditUser({ ...editUser, role: 'viewer', namespaces: editUser.namespaces?.length ? editUser.namespaces : [ALL_NS] })}
                  >
                    <AccessIcon name="eye" />
                    <strong>{t('Viewer')}</strong>
                    <span>{t('Namespace scoped')}</span>
                  </button>
                  <button
                    type="button"
                    className={`admin-role-choice admin ${editUser.role === 'admin' ? 'active' : ''}`}
                    onClick={() => setEditUser({ ...editUser, role: 'admin', namespaces: [ALL_NS] })}
                  >
                    <AccessIcon name="shield" />
                    <strong>{t('Admin')}</strong>
                    <span>{t('Platform access')}</span>
                  </button>
                </div>
              </section>

              <section className="admin-permission-card">
                <span className="admin-field-label">{t('Apply Template')}</span>
                <div className="admin-template-picker admin-template-choice-list">
                  {templates.map(template => (
                    <button
                      key={template.name}
                      type="button"
                      className={editUser.template === template.name ? 'active' : ''}
                      onClick={() => setEditUser(applyTemplateToUser(editUser, template.name))}
                    >
                      <span>
                        <strong>{template.name}</strong>
                        <small>{template.role === 'admin' ? t('Admin') : nsSummary(template.namespaces)}</small>
                      </span>
                      {template.isDefault && <em>{t('Default')}</em>}
                    </button>
                  ))}
                  {templates.length === 0 && <span>{t('No templates')}</span>}
                </div>
              </section>
            </div>

            {editUser.role === 'admin' ? (
              <div className="admin-access-full-card admin-access-full-card-lg">
                <AccessIcon name="shield" />
                <strong>{t('Full platform access')}</strong>
                <span>{t('All namespaces and admin pages')}</span>
              </div>
            ) : (
              <section className="admin-permission-card">
                <span className="admin-field-label">{t('Namespace Visibility')}</span>
                <NamespacePicker
                  selected={editUser.namespaces || []}
                  options={namespaceOptions}
                  onChange={ns => setEditUser({ ...editUser, namespaces: ns })}
                />
                {(editUser.namespaces || []).length === 0 && (
                  <span className="admin-inline-warning">{t('No namespaces selected.')}</span>
                )}
              </section>
            )}

            <div className="admin-modal-actions">
              <button className="btn btn-ghost" onClick={() => setEditUser(null)}>{t('Cancel')}</button>
              <button className="btn btn-primary" onClick={() => saveUser(editUser)}>{t('Save Permissions')}</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {editTemplate && createPortal(
        <div className="admin-modal-backdrop">
          <div className="admin-modal-panel admin-access-modal admin-permission-modal">
            <div className="admin-permission-modal-head">
              <div className="admin-modal-user-summary">
                <span className={`admin-user-avatar large ${editTemplate.role === 'admin' ? 'admin' : ''}`}>
                  <AccessIcon name={editTemplate.role === 'admin' ? 'shield' : 'key'} />
                </span>
                <div>
                  <span>{templates.some(t => t.name === editTemplate.name) ? t('Edit Template') : t('New Template')}</span>
                  <h3>{editTemplate.name || t('Permission Template')}</h3>
                  <p>{editTemplate.role === 'admin' ? t('Platform access') : t('Namespace scoped')}</p>
                </div>
              </div>
              <button className="admin-modal-close-btn" onClick={() => setEditTemplate(null)}>x</button>
            </div>

            <div className="admin-template-form-grid">
              <label className="admin-form-field">
                <span className="admin-field-label">{t('Template Name')}</span>
                <input type="text" className="form-input" value={editTemplate.name} placeholder="econtract-team"
                  disabled={templates.some(t => t.name === editTemplate.name)}
                  onChange={e => setEditTemplate({ ...editTemplate, name: e.target.value })} />
              </label>

              <div className="admin-template-default-card">
                <span>
                  <strong>{t('Default Template')}</strong>
                  <em>{editTemplate.isDefault ? t('Enabled') : t('Disabled')}</em>
                </span>
                <AccessSwitch
                  checked={editTemplate.isDefault}
                  onChange={() => setEditTemplate({ ...editTemplate, isDefault: !editTemplate.isDefault })}
                />
              </div>
            </div>

            <label className="admin-form-field">
              <span className="admin-field-label">{t('Description')}</span>
              <input type="text" className="form-input" value={editTemplate.description} placeholder="Who is this template for?"
                onChange={e => setEditTemplate({ ...editTemplate, description: e.target.value })} />
            </label>

            <section className="admin-permission-card">
              <span className="admin-field-label">{t('Role')}</span>
              <div className="admin-role-choice-grid">
                <button
                  type="button"
                  className={`admin-role-choice ${editTemplate.role === 'viewer' ? 'active' : ''}`}
                  onClick={() => setEditTemplate({ ...editTemplate, role: 'viewer', namespaces: editTemplate.namespaces?.length ? editTemplate.namespaces : [ALL_NS] })}
                >
                  <AccessIcon name="eye" />
                  <strong>{t('Viewer')}</strong>
                  <span>{t('Namespace scoped')}</span>
                </button>
                <button
                  type="button"
                  className={`admin-role-choice admin ${editTemplate.role === 'admin' ? 'active' : ''}`}
                  onClick={() => setEditTemplate({ ...editTemplate, role: 'admin', namespaces: [ALL_NS] })}
                >
                  <AccessIcon name="shield" />
                  <strong>{t('Admin')}</strong>
                  <span>{t('Platform access')}</span>
                </button>
              </div>
            </section>

            {editTemplate.role === 'admin' ? (
              <div className="admin-access-full-card admin-access-full-card-lg">
                <AccessIcon name="shield" />
                <strong>{t('Full platform access')}</strong>
                <span>{t('All namespaces and admin pages')}</span>
              </div>
            ) : (
              <section className="admin-permission-card">
                <span className="admin-field-label">{t('Namespace Visibility')}</span>
                <NamespacePicker
                  selected={editTemplate.namespaces || []}
                  options={namespaceOptions}
                  onChange={ns => setEditTemplate({ ...editTemplate, namespaces: ns })}
                />
              </section>
            )}

            <div className="admin-modal-actions">
              <button className="btn btn-ghost" onClick={() => setEditTemplate(null)}>{t('Cancel')}</button>
              <button className="btn btn-primary" onClick={() => saveTemplate(editTemplate)}>{t('Save Template')}</button>
            </div>
          </div>
        </div>,
        document.body
      )}

    </div>
  );
}
