import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { motion, AnimatePresence } from "framer-motion";

/**
 * FreePBX 17 Frontend (React) — Admin UI
 * --------------------------------------
 * Adds for FBX 17:
 * - Edit Extension (advanced PJSIP/voicemail fields)
 * - Realtime Trunk/Queue status via ARI (WebSocket) *with mock fallback*
 * - Role-based access (Admin vs Helpdesk)
 * - Audit log with optimistic UI + rollback
 * - CDR pagination + CSV export
 *
 * NOTE: FreePBX 17 consolidates on PJSIP; CHANSIP/SIP options shown are for mixed/historical setups.
 * Adjust the API layer below to your exact FreePBX 17 REST paths & ARI config.
 */

// ===============
// Minimal UI (Tailwind)
// ===============
const TWButton = ({ className = "", disabled, ...props }) => (
  <button
    disabled={disabled}
    className={`px-3 py-2 rounded-2xl shadow hover:shadow-md transition text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    {...props}
  />
);

const TWCard = ({ children, className = "" }) => (
  <div className={`bg-white rounded-2xl shadow p-4 ${className}`}>{children}</div>
);

const TWInput = ({ className = "", ...props }) => (
  <input className={`border rounded-xl px-3 py-2 w-full ${className}`} {...props} />
);

const TWSelect = ({ className = "", children, ...props }) => (
  <select className={`border rounded-xl px-3 py-2 w-full bg-white ${className}`} {...props}>{children}</select>
);

const TWTextarea = ({ className = "", ...props }) => (
  <textarea className={`border rounded-xl px-3 py-2 w-full ${className}`} {...props} />
);

const TWLabel = ({ children }) => (
  <label className="block text-sm font-medium mb-1 text-gray-700">{children}</label>
);

const TWBadge = ({ children, tone = "default" }) => {
  const map = {
    default: "bg-gray-100 border text-gray-800",
    ok: "bg-green-50 border-green-200 text-green-800",
    warn: "bg-amber-50 border-amber-200 text-amber-900",
    err: "bg-rose-50 border-rose-200 text-rose-800",
  };
  return (
    <span className={`inline-block text-xs px-2 py-0.5 rounded-full border ${map[tone]}`}>{children}</span>
  );
};

// ===============
// Mock data
// ===============
const MOCK_EXTENSIONS = [
  { id: 1001, tech: "PJSIP", name: "Reception", callerid: "Reception <1001>", voicemail: true, vm_email: "reception@example.com" },
  { id: 1002, tech: "PJSIP", name: "Sales", callerid: "Sales <1002>", voicemail: true, vm_email: "sales@example.com" },
  { id: 1003, tech: "PJSIP", name: "Support", callerid: "Support <1003>", voicemail: false, vm_email: "" },
];

const MOCK_CALLS = Array.from({ length: 137 }).map((_, i) => ({
  id: `c${i + 1}`,
  src: i % 3 === 0 ? "0400123456" : String(1001 + (i % 5)),
  dst: String(1001 + (i % 7)),
  disposition: i % 4 === 0 ? "NO ANSWER" : "ANSWERED",
  duration: (i % 5) * 47,
  calldate: `2025-08-${String(1 + (i % 28)).padStart(2, "0")} ${String(8 + (i % 10)).padStart(2, "0")}:0${i % 6}:1${i % 9}`,
}));

const MOCK_STATUS = {
  trunks: [
    { name: "SIP Trunk AU-East", state: "Registered", latency_ms: 38 },
    { name: "SIP Trunk AU-West", state: "Reachable", latency_ms: 182 },
  ],
  queues: [
    { name: "600 Support", agents: 4, logged_in: 3, waiting: 0 },
    { name: "700 Sales", agents: 6, logged_in: 5, waiting: 1 },
  ],
};

// ===============
// API layer (adjust for FreePBX 17)
// ===============
async function apiFetchExtensions({ baseURL, apiKey, useMock }) {
  if (useMock) return structuredClone(MOCK_EXTENSIONS);
  const res = await axios.get(`${baseURL}/extensions`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  return res.data; // Expect: [{id, tech, name, callerid, voicemail, vm_email}]
}

async function apiCreateExtension(cfg, payload) {
  if (cfg.useMock) {
    const nextId = Math.max(...MOCK_EXTENSIONS.map(e => e.id)) + 1;
    const row = { id: nextId, tech: payload.tech || "PJSIP", ...payload };
    MOCK_EXTENSIONS.push(row);
    return row;
  }
  const res = await axios.post(`${cfg.baseURL}/extensions`, payload, {
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
  });
  return res.data;
}

async function apiUpdateExtension(cfg, id, payload) {
  if (cfg.useMock) {
    const i = MOCK_EXTENSIONS.findIndex(e => e.id === id);
    if (i >= 0) MOCK_EXTENSIONS[i] = { ...MOCK_EXTENSIONS[i], ...payload };
    return MOCK_EXTENSIONS[i];
  }
  const res = await axios.put(`${cfg.baseURL}/extensions/${id}`, payload, {
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
  });
  return res.data;
}

async function apiDeleteExtension(cfg, id) {
  if (cfg.useMock) {
    const idx = MOCK_EXTENSIONS.findIndex(e => e.id === id);
    if (idx >= 0) MOCK_EXTENSIONS.splice(idx, 1);
    return { ok: true };
  }
  const res = await axios.delete(`${cfg.baseURL}/extensions/${id}`, {
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
  });
  return res.data;
}

async function apiFetchCalls(cfg, { from, to, ext, page, pageSize }) {
  if (cfg.useMock) {
    let rows = MOCK_CALLS.filter(c =>
      (!ext || c.src === String(ext) || c.dst === String(ext)) &&
      (!from || new Date(c.calldate) >= new Date(from)) &&
      (!to || new Date(c.calldate) <= new Date(to))
    );
    const total = rows.length;
    const start = (page - 1) * pageSize;
    rows = rows.slice(start, start + pageSize);
    return { rows, total };
  }
  const params = { page, pageSize };
  if (from) params.from = from;
  if (to) params.to = to;
  if (ext) params.ext = ext;
  const res = await axios.get(`${cfg.baseURL}/cdr`, {
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
    params,
  });
  return res.data; // Expect: { rows: [...], total }
}

// ARI (Asterisk Realtime Interface) status via WebSocket
function useAriStatus({ ariWS, useMock }) {
  const [status, setStatus] = useState(MOCK_STATUS);
  const wsRef = useRef(null);

  useEffect(() => {
    if (useMock || !ariWS) { setStatus(MOCK_STATUS); return; }
    try {
      const ws = new WebSocket(ariWS);
      wsRef.current = ws;
      ws.onopen = () => {
        // Optionally authenticate if your ARI proxy expects a token via query/header
      };
      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          // Expect a normalized payload { trunks: [...], queues: [...] }
          if (msg.trunks || msg.queues) setStatus(msg);
        } catch { /* ignore */ }
      };
      ws.onerror = () => { /* show error badge maybe */ };
      ws.onclose = () => { /* retry/backoff if desired */ };
      return () => ws.close();
    } catch {
      // Fallback silently to mock
      setStatus(MOCK_STATUS);
    }
  }, [ariWS, useMock]);

  return status;
}

// ===============
// Helpers
// ===============
function secondsToHMS(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map(v => String(v).padStart(2, "0")).join(":");
}

function downloadCsv(filename, rows) {
  const headers = Object.keys(rows[0] || {});
  const escape = (v) => (`${v ?? ""}`.includes(",") || `${v ?? ""}`.includes("\n")) ? `"${(`${v ?? ""}`).replace(/"/g, '""')}"` : `${v ?? ""}`;
  const csv = [headers.join(","), ...rows.map(r => headers.map(h => escape(r[h])).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ===============
// Create/Edit Extension Modal
// ===============
function ExtensionModal({ open, onClose, onSubmit, initial }) {
  const [form, setForm] = useState(() => initial || { tech: "PJSIP", name: "", callerid: "", voicemail: false, vm_email: "" });
  useEffect(() => { setForm(initial || { tech: "PJSIP", name: "", callerid: "", voicemail: false, vm_email: "" }); }, [initial, open]);
  const isEdit = Boolean(initial && initial.id);

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 24, opacity: 0 }} className="bg-white w-full max-w-xl rounded-2xl shadow-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">{isEdit ? "Edit" : "Create"} Extension</h3>
              <TWButton className="bg-gray-100" onClick={onClose}>✕</TWButton>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <TWLabel>Technology</TWLabel>
                <TWSelect value={form.tech} onChange={e => setForm({ ...form, tech: e.target.value })}>
                  <option value="PJSIP">PJSIP</option>
                  <option value="SIP">SIP (legacy)</option>
                  <option value="CHANSIP">CHANSIP (legacy)</option>
                </TWSelect>
              </div>
              <div>
                <TWLabel>Name</TWLabel>
                <TWInput value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="md:col-span-2">
                <TWLabel>Caller ID</TWLabel>
                <TWInput placeholder="Display <1001>" value={form.callerid} onChange={e => setForm({ ...form, callerid: e.target.value })} />
              </div>

              <div className="md:col-span-2 border rounded-2xl p-3">
                <div className="flex items-center justify-between">
                  <div className="font-medium">Voicemail</div>
                  <div className="flex items-center gap-2">
                    <input id="vm" type="checkbox" checked={form.voicemail} onChange={e => setForm({ ...form, voicemail: e.target.checked })} />
                    <label htmlFor="vm" className="text-sm">Enable</label>
                  </div>
                </div>
                {form.voicemail && (
                  <div className="grid md:grid-cols-2 gap-3 mt-3">
                    <div>
                      <TWLabel>VM Email</TWLabel>
                      <TWInput type="email" value={form.vm_email} onChange={e => setForm({ ...form, vm_email: e.target.value })} />
                    </div>
                    <div>
                      <TWLabel>Options</TWLabel>
                      <TWTextarea placeholder="key=value\nautodelete=yes" rows={3} />
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <TWButton className="bg-gray-100" onClick={onClose}>Cancel</TWButton>
              <TWButton className="bg-black text-white" onClick={() => { onSubmit(form); onClose(); }}>{isEdit ? "Save" : "Create"}</TWButton>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ===============
// Extensions Panel (with RBAC, optimistic + audit)
// ===============
function ExtensionsPanel({ cfg, role, pushAudit }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editRow, setEditRow] = useState(null);

  async function load() {
    setLoading(true);
    try { setData(await apiFetchExtensions(cfg)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [cfg.baseURL, cfg.apiKey, cfg.useMock]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return data;
    return data.filter(r => [r.id, r.name, r.callerid, r.tech].join(" ").toLowerCase().includes(term));
  }, [data, q]);

  async function createExt(form) {
    const optimistic = { id: Math.floor(Math.random() * 1e9), ...form, __optimistic: true };
    setData(d => [optimistic, ...d]);
    pushAudit({ action: "create_extension", detail: `${form.name} (${form.callerid})` });
    try {
      const saved = await apiCreateExtension(cfg, form);
      setData(d => d.map(r => (r === optimistic ? saved : r)));
    } catch (e) {
      setData(d => d.filter(r => r !== optimistic));
      pushAudit({ action: "rollback_create_extension", detail: `${form.name}` });
      alert("Failed to create extension");
    }
  }

  async function saveEdit(row, form) {
    const prev = row;
    const updated = { ...row, ...form };
    setData(d => d.map(r => (r.id === row.id ? updated : r)));
    pushAudit({ action: "update_extension", detail: `${row.id}` });
    try {
      const saved = await apiUpdateExtension(cfg, row.id, form);
      setData(d => d.map(r => (r.id === row.id ? saved : r)));
    } catch (e) {
      setData(d => d.map(r => (r.id === row.id ? prev : r)));
      pushAudit({ action: "rollback_update_extension", detail: `${row.id}` });
      alert("Failed to save changes");
    }
  }

  async function deleteExt(id) {
    const yes = confirm(`Delete extension ${id}?`);
    if (!yes) return;
    const prev = data;
    setData(d => d.filter(r => r.id !== id));
    pushAudit({ action: "delete_extension", detail: `${id}` });
    try { await apiDeleteExtension(cfg, id); }
    catch (e) {
      setData(prev);
      pushAudit({ action: "rollback_delete_extension", detail: `${id}` });
      alert("Failed to delete extension");
    }
  }

  const canEdit = role === "admin";

  return (
    <TWCard>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xl font-semibold">Extensions</h2>
        <div className="flex items-center gap-2">
          <TWInput placeholder="Search…" value={q} onChange={e => setQ(e.target.value)} className="w-48" />
          <TWButton className={`text-white ${canEdit ? "bg-black" : "bg-gray-300"}`} disabled={!canEdit} onClick={() => setModalOpen(true)}>New</TWButton>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b">
              <th className="py-2">Ext</th>
              <th>Tech</th>
              <th>Name</th>
              <th>Caller ID</th>
              <th>Voicemail</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="py-8 text-center text-gray-500">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className="py-8 text-center text-gray-500">No results</td></tr>
            ) : (
              filtered.map(r => (
                <tr key={r.id} className="border-b hover:bg-gray-50">
                  <td className="py-2 font-mono">{r.id}{r.__optimistic && <span title="pending">*</span>}</td>
                  <td>{r.tech}</td>
                  <td>{r.name}</td>
                  <td className="text-gray-600">{r.callerid}</td>
                  <td>{r.voicemail ? <TWBadge tone="ok">on</TWBadge> : <TWBadge>off</TWBadge>}</td>
                  <td className="text-right">
                    <TWButton className="bg-gray-100 mr-2" disabled={!canEdit} onClick={() => { setEditRow(r); setModalOpen(true); }}>Edit</TWButton>
                    <TWButton className={`text-white ${canEdit ? "bg-rose-600" : "bg-gray-300"}`} disabled={!canEdit} onClick={() => deleteExt(r.id)}>Delete</TWButton>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ExtensionModal open={modalOpen} onClose={() => { setModalOpen(false); setEditRow(null); }} onSubmit={(f) => editRow ? saveEdit(editRow, f) : createExt(f)} initial={editRow} />
    </TWCard>
  );
}


// ===============
// Call Logs Panel (pagination + CSV export)
// ===============
function CallLogsPanel({ cfg }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [ext, setExt] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const { rows, total } = await apiFetchCalls(cfg, { from, to, ext, page, pageSize });
      setRows(rows); setTotal(total);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [cfg.baseURL, cfg.apiKey, cfg.useMock, page, pageSize]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <TWCard>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xl font-semibold">Call Logs</h2>
        <div className="flex items-center gap-2">
          <TWInput type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-40" />
          <TWInput type="date" value={to} onChange={e => setTo(e.target.value)} className="w-40" />
          <TWInput placeholder="Filter by ext" value={ext} onChange={e => setExt(e.target.value)} className="w-32" />
          <TWSelect value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }} className="w-28">
            {[10,20,50,100].map(n => <option key={n} value={n}>{n}/page</option>)}
          </TWSelect>
          <TWButton className="bg-black text-white" onClick={() => { setPage(1); load(); }}>Apply</TWButton>
          <TWButton className="bg-gray-100" onClick={() => downloadCsv(`cdr-export.csv`, rows)}>Export CSV</TWButton>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b">
              <th className="py-2">Date/Time</th>
              <th>From</th>
              <th>To</th>
              <th>Disposition</th>
              <th className="text-right">Duration</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="py-8 text-center text-gray-500">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} className="py-8 text-center text-gray-500">No calls found</td></tr>
            ) : (
              rows.map(c => (
                <tr key={c.id} className="border-b hover:bg-gray-50">
                  <td className="py-2 whitespace-nowrap">{new Date(c.calldate).toLocaleString()}</td>
                  <td className="font-mono">{c.src}</td>
                  <td className="font-mono">{c.dst}</td>
                  <td>
                    <TWBadge tone={c.disposition === 'ANSWERED' ? 'ok' : 'warn'}>{c.disposition}</TWBadge>
                  </td>
                  <td className="text-right">{secondsToHMS(Number(c.duration || 0))}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <div className="text-sm text-gray-600">Total: {total} • Page {page} / {totalPages}</div>
        <div className="flex items-center gap-2">
          <TWButton className="bg-gray-100" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Prev</TWButton>
          <TWButton className="bg-gray-100" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>Next</TWButton>
        </div>
      </div>
    </TWCard>
  );
}


// ===============
// Status Panel (Realtime via ARI)
// ===============
function StatusPanel({ cfg }) {
  const status = useAriStatus({ ariWS: cfg.ariWS, useMock: cfg.useMock });
  return (
    <TWCard>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xl font-semibold">Queues & Trunks</h2>
        <TWBadge tone={cfg.useMock ? 'warn' : 'default'}>{cfg.useMock ? 'mock' : 'live'}</TWBadge>
      </div>
      <div className="grid md:grid-cols-3 gap-3">
        {status.trunks.map((t, idx) => (
          <div key={`t${idx}`} className="border rounded-2xl p-3">
            <div className="flex items-center justify-between">
              <div className="font-medium">{t.name}</div>
              <TWBadge tone={t.latency_ms > 150 ? 'warn' : 'ok'}>{t.state}</TWBadge>
            </div>
            <div className="text-sm text-gray-600 mt-1">Latency {t.latency_ms} ms</div>
          </div>
        ))}
        {status.queues.map((q, idx) => (
          <div key={`q${idx}`} className="border rounded-2xl p-3">
            <div className="flex items-center justify-between">
              <div className="font-medium">{q.name}</div>
              <TWBadge tone={q.waiting > 0 ? 'warn' : 'ok'}>{q.logged_in}/{q.agents} agents</TWBadge>
            </div>
            <div className="text-sm text-gray-600 mt-1">Waiting callers: {q.waiting}</div>
          </div>
        ))}
      </div>
    </TWCard>
  );
}


// ===============
// Audit Log Panel
// ===============
function AuditPanel({ entries }) {
  return (
    <TWCard>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xl font-semibold">Audit Log</h2>
        <TWBadge>{entries.length} events</TWBadge>
      </div>
      <div className="space-y-2 max-h-64 overflow-auto pr-1">
        {entries.length === 0 ? (
          <div className="text-sm text-gray-500">No activity yet.</div>
        ) : (
          entries.map((e, i) => (
            <div key={i} className="text-sm flex items-center justify-between border rounded-xl p-2">
              <div>
                <span className="font-mono text-xs mr-2">{new Date(e.ts).toLocaleTimeString()}</span>
                <span className="font-medium">{e.action}</span>
                {e.detail && <span className="text-gray-600"> — {e.detail}</span>}
              </div>
              <TWBadge tone={e.action.startsWith('rollback') ? 'err' : 'default'}>{e.user}</TWBadge>
            </div>
          ))
        )}
      </div>
    </TWCard>
  );
}

// ===============
// Root App with RBAC & Config
// ===============
export default function App() {
  const [cfg, setCfg] = useState({
    baseURL: "https://your-freepbx17/api", // e.g., https://pbx.example.com/admin/api
    apiKey: "",
    useMock: true,
    ariWS: "", // e.g., wss://pbx.example.com/ari/ws?api_key=... (behind a proxy)
  });
  const [role, setRole] = useState("admin"); // "admin" | "helpdesk"
  const [audit, setAudit] = useState([]);

  function pushAudit(entry) {
    setAudit(a => [{ ...entry, ts: Date.now(), user: role }, ...a].slice(0, 200));
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 p-4 md:p-8">
      <header className="max-w-6xl mx-auto mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">FreePBX 17 — Friendly Admin</h1>
            <p className="text-gray-600 mt-1">Manage extensions, inspect CDRs, and watch realtime status.</p>
          </div>
          <div className="flex items-center gap-2">
            <TWSelect value={role} onChange={e => setRole(e.target.value)} className="w-36">
              <option value="admin">Admin</option>
              <option value="helpdesk">Helpdesk</option>
            </TWSelect>
            <TWBadge>{role}</TWBadge>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto grid gap-4 md:gap-6 grid-cols-1">
        {/* Config */}
        <TWCard>
          <div className="grid md:grid-cols-5 gap-3 items-end">
            <div className="md:col-span-2">
              <TWLabel>API Base URL</TWLabel>
              <TWInput value={cfg.baseURL} onChange={e => setCfg({ ...cfg, baseURL: e.target.value })} placeholder="https://pbx.example.com/admin/api" />
            </div>
            <div className="md:col-span-2">
              <TWLabel>API Key / Token</TWLabel>
              <TWInput value={cfg.apiKey} onChange={e => setCfg({ ...cfg, apiKey: e.target.value })} placeholder="paste token" />
            </div>
            <div className="md:col-span-1">
              <TWLabel>Use mock data</TWLabel>
              <div className="flex items-center gap-2">
                <input id="mock" type="checkbox" checked={cfg.useMock} onChange={e => setCfg({ ...cfg, useMock: e.target.checked })} />
                <label htmlFor="mock" className="text-sm">Mock</label>
              </div>
            </div>
            <div className="md:col-span-3">
              <TWLabel>ARI WebSocket URL (optional)</TWLabel>
              <TWInput value={cfg.ariWS} onChange={e => setCfg({ ...cfg, ariWS: e.target.value })} placeholder="wss://pbx.example.com/ari/ws?api_key=..." />
            </div>
            <div className="md:col-span-2 text-right">
              <TWButton className="bg-black text-white" onClick={() => alert("Saved locally for this session.")}>Save</TWButton>
            </div>
          </div>
        </TWCard>

        {/* Panels */}
        <div className="grid md:grid-cols-2 gap-4 md:gap-6">
          <ExtensionsPanel cfg={cfg} role={role} pushAudit={pushAudit} />
          <CallLogsPanel cfg={cfg} />
        </div>

        <StatusPanel cfg={cfg} />
        <AuditPanel entries={audit} />
      </main>

      <footer className="max-w-6xl mx-auto mt-8 text-xs text-gray-500">
        <p>
          Security tip: expose the FreePBX API only on a trusted network or behind a reverse proxy with
          mTLS/IP allowlists. Use least-privilege tokens. For ARI, put it behind an auth
          gateway and normalize events to the payload shape consumed here.
        </p>
      </footer>
    </div>
  );
}

