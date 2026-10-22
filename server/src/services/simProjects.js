// Saved Simulate tab projects — per tenant, plain JSON.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ensureTenant, tenantFile } = require('./tenantStore');

function storeFile(tenantId) {
  ensureTenant(tenantId);
  return tenantFile(tenantId, 'simProjects');
}

function ensureStore(tenantId) {
  const file = storeFile(tenantId);
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify({ projects: [] }, null, 2));
  }
  return file;
}

function readRaw(tenantId) {
  ensureStore(tenantId);
  try {
    const data = JSON.parse(fs.readFileSync(storeFile(tenantId), 'utf8'));
    return Array.isArray(data.projects) ? data.projects : [];
  } catch {
    return [];
  }
}

function writeRaw(tenantId, projects) {
  ensureStore(tenantId);
  fs.writeFileSync(storeFile(tenantId), JSON.stringify({ projects }, null, 2));
}

function slugify(name) {
  return String(name || 'project')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'project';
}

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function lineMonthly(line) {
  return money((Number(line.unitMonthly) || 0) * (Number(line.quantity) || 0));
}

function summarizeProject(project) {
  const lines = project.lines || [];
  const byApp = {};
  let total = 0;
  for (const line of lines) {
    const app = (line.applicationName || 'Ungrouped').trim() || 'Ungrouped';
    const m = lineMonthly(line);
    total += m;
    if (!byApp[app]) byApp[app] = { applicationName: app, monthly: 0, lineCount: 0 };
    byApp[app].monthly = money(byApp[app].monthly + m);
    byApp[app].lineCount += 1;
  }
  return {
    totalMonthly: money(total),
    totalAnnual: money(total * 12),
    lineCount: lines.length,
    applicationCount: Object.keys(byApp).length,
    applications: Object.values(byApp).sort((a, b) => b.monthly - a.monthly),
  };
}

function toSummary(project) {
  const summary = summarizeProject(project);
  return {
    id: project.id,
    name: project.name,
    region: project.region,
    notes: project.notes || '',
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    ...summary,
  };
}

function listProjects(tenantId) {
  return readRaw(tenantId)
    .map(toSummary)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

function getProject(tenantId, id) {
  const project = readRaw(tenantId).find((p) => p.id === id);
  if (!project) return null;
  return { ...project, ...summarizeProject(project) };
}

function saveProject(tenantId, input = {}) {
  const projects = readRaw(tenantId);
  const now = new Date().toISOString();
  const name = String(input.name || '').trim();
  if (!name) throw new Error('Project name is required');
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new Error('Add at least one component before saving');
  }

  const lines = input.lines.map((l, i) => ({
    id: l.id || `line_${i}_${Date.now()}`,
    type: l.type || 'vm',
    label: l.label || l.armSkuName || l.optionId || 'Component',
    blurb: l.blurb || '',
    optionId: l.optionId,
    armSkuName: l.armSkuName,
    storageSku: l.storageSku,
    gb: l.gb,
    quantity: Math.max(0, Number(l.quantity) || 0),
    unitMonthly: money(l.unitMonthly),
    applicationName: String(l.applicationName || 'Ungrouped').trim() || 'Ungrouped',
    sku: l.sku,
    locked: Boolean(l.locked),
    resourceId: l.resourceId,
  }));

  let project;
  if (input.id) {
    const idx = projects.findIndex((p) => p.id === input.id);
    if (idx === -1) throw new Error('Project not found');
    project = {
      ...projects[idx],
      name,
      region: input.region || projects[idx].region || 'australiaeast',
      notes: input.notes != null ? String(input.notes) : projects[idx].notes || '',
      lines,
      updatedAt: now,
    };
    projects[idx] = project;
  } else {
    const base = slugify(name);
    let id = base;
    let n = 1;
    while (projects.some((p) => p.id === id)) {
      id = `${base}-${n++}`;
    }
    if (projects.some((p) => p.id === id)) {
      id = `${base}-${crypto.randomBytes(3).toString('hex')}`;
    }
    project = {
      id,
      name,
      region: input.region || 'australiaeast',
      notes: String(input.notes || ''),
      lines,
      createdAt: now,
      updatedAt: now,
    };
    projects.unshift(project);
  }

  writeRaw(tenantId, projects);
  return getProject(tenantId, project.id);
}

function deleteProject(tenantId, id) {
  const projects = readRaw(tenantId);
  const idx = projects.findIndex((p) => p.id === id);
  if (idx === -1) throw new Error('Project not found');
  projects.splice(idx, 1);
  writeRaw(tenantId, projects);
  return { ok: true, id };
}

module.exports = {
  listProjects,
  getProject,
  saveProject,
  deleteProject,
};
