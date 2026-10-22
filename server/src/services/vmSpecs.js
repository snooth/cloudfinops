// Guess vCPU/RAM from SKU string — catalog meters don't ship memory, so we use MS naming rules.

// Known RAM overrides where the formula lies
const EXACT_RAM_GB = {
  Standard_B1ls: 0.5,
  Standard_B1s: 1,
  Standard_B1ms: 2,
  Standard_B2s: 4,
  Standard_B2ms: 8,
  Standard_B4ms: 16,
  Standard_B8ms: 32,
  Standard_B12ms: 48,
  Standard_B16ms: 64,
  Standard_B20ms: 80,
  Standard_A0: 0.75,
  Standard_A1: 1.75,
  Standard_A2: 3.5,
  Standard_A3: 7,
  Standard_A4: 14,
  Standard_A5: 14,
  Standard_A6: 28,
  Standard_A7: 56,
  // Popular D / E v5
  Standard_D2s_v5: 8,
  Standard_D4s_v5: 16,
  Standard_D8s_v5: 32,
  Standard_D16s_v5: 64,
  Standard_D32s_v5: 128,
  Standard_D48s_v5: 192,
  Standard_D64s_v5: 256,
  Standard_D96s_v5: 384,
  Standard_E2s_v5: 16,
  Standard_E4s_v5: 32,
  Standard_E8s_v5: 64,
  Standard_E16s_v5: 128,
  Standard_E20s_v5: 160,
  Standard_E32s_v5: 256,
  Standard_E48s_v5: 384,
  Standard_E64s_v5: 512,
  'Standard_E64-16s_v5': 512,
  'Standard_E64-32s_v5': 512,
  Standard_E96s_v5: 672,
  Standard_E104is_v5: 672,
};

// Parse constrained sizes like Standard_E64-16s_v5
function parseVmSku(armSkuName) {
  const name = String(armSkuName || '').trim();
  if (!name) return null;

  // Constrained cores: Standard_E64-16s_v5
  let m = name.match(/^Standard_([A-Za-z]+?)(\d+)-(\d+)([a-z]*)(?:_v(\d+))?$/i);
  if (m) {
    return {
      armSkuName: name,
      family: m[1],
      fullCores: Number(m[2]),
      cores: Number(m[3]),
      suffix: (m[4] || '').toLowerCase(),
      version: m[5] ? Number(m[5]) : null,
      constrained: true,
    };
  }

  // Standard_D16s_v5 / Standard_B4ms / Standard_NC6s_v3
  m = name.match(/^Standard_([A-Za-z]+?)(\d+)([a-z]*)(?:_v(\d+))?$/i);
  if (m) {
    const cores = Number(m[2]);
    return {
      armSkuName: name,
      family: m[1],
      fullCores: cores,
      cores,
      suffix: (m[3] || '').toLowerCase(),
      version: m[4] ? Number(m[4]) : null,
      constrained: false,
    };
  }

  // Fallback: first number after underscore letters
  m = name.match(/Standard_([A-Za-z]*)(\d+)/i);
  if (m) {
    const cores = Number(m[2]);
    return {
      armSkuName: name,
      family: m[1] || 'X',
      fullCores: cores,
      cores,
      suffix: '',
      version: null,
      constrained: false,
    };
  }

  return null;
}

function coresFromSku(armSkuName) {
  const p = parseVmSku(armSkuName);
  return p ? p.cores : null;
}

// GiB per vCPU by family letter (D≈4, E≈8, F≈2, etc.)
function giBPerCore(family, suffix = '') {
  const f = String(family || '').toUpperCase();
  const s = String(suffix || '').toLowerCase();

  // B-series handled separately
  if (f === 'B' || f.startsWith('B')) return null;

  // Memory optimised E* (not EC confidential)
  if (/^E/i.test(f) && !/^EC/i.test(f)) return 8;

  // Compute optimised F*
  if (/^F/i.test(f)) return 2;

  // Storage optimised L*
  if (/^L/i.test(f)) return 8;

  // GPU / HPC — approximate common ratios
  if (/^NC/i.test(f)) return 6;
  if (/^ND/i.test(f)) return 28;
  if (/^NV/i.test(f)) return 7;
  if (/^H/i.test(f)) return 7;

  // High memory M*
  if (/^M/i.test(f)) {
    if (s.includes('ts') || s.includes('ls')) return 28;
    return 20;
  }

  // General purpose D*, Das*, Dds*, A* modern, etc.
  if (/^D/i.test(f) || /^A/i.test(f)) return 4;

  // Default general-purpose-like
  return 4;
}

function bSeriesRamGb(parsed) {
  const map = {
    '1ls': 0.5,
    '1s': 1,
    '1ms': 2,
    '2s': 4,
    '2ms': 8,
    '2als': 4,
    '2as': 8,
    '4ms': 16,
    '4ls': 8,
    '4als': 8,
    '4as': 16,
    '8ms': 32,
    '8als': 16,
    '8as': 32,
    '12ms': 48,
    '16ms': 64,
    '16als': 32,
    '16as': 64,
    '20ms': 80,
    '32ms': 128,
    '32als': 64,
    '32as': 128,
  };
  const key = `${parsed.fullCores}${parsed.suffix}`;
  if (map[key] != null) return map[key];
  // rough B memory-optimised (ms/as) vs standard (s)
  if (parsed.suffix.includes('m') || parsed.suffix.includes('a')) {
    return parsed.fullCores * 4;
  }
  return parsed.fullCores * 2;
}

// Total RAM GiB for a Standard_* SKU
function ramGbFromSku(armSkuName) {
  const name = String(armSkuName || '').trim();
  if (EXACT_RAM_GB[name] != null) return EXACT_RAM_GB[name];

  const p = parseVmSku(name);
  if (!p) return null;

  if (/^B/i.test(p.family)) {
    return bSeriesRamGb(p);
  }

  const per = giBPerCore(p.family, p.suffix);
  if (per == null) return null;

  // Constrained-core SKUs keep the full size's memory (e.g. E64-16s_v5 → 512 GiB)
  const coresForRam = p.fullCores;
  const gb = coresForRam * per;
  // Round half-GB to 1 decimal for tiny SKUs, else whole GiB
  if (gb < 1) return Math.round(gb * 100) / 100;
  if (gb < 10 && gb % 1 !== 0) return Math.round(gb * 10) / 10;
  return Math.round(gb);
}

function formatRamGb(ramGb) {
  if (ramGb == null || Number.isNaN(Number(ramGb))) return null;
  const n = Number(ramGb);
  if (n < 1) return `${n} GB`;
  if (n % 1 !== 0) return `${n} GB`;
  return `${n} GB`;
}

// UI-friendly { cores, ramGb, label }
function vmSpecs(armSkuName) {
  const cores = coresFromSku(armSkuName);
  const ramGb = ramGbFromSku(armSkuName);
  const parts = [];
  if (cores != null) parts.push(`${cores} vCPU`);
  const ramLabel = formatRamGb(ramGb);
  if (ramLabel) parts.push(ramLabel);
  return {
    cores,
    ramGb,
    label: parts.length ? parts.join(' · ') : null,
  };
}

module.exports = {
  parseVmSku,
  coresFromSku,
  ramGbFromSku,
  formatRamGb,
  vmSpecs,
  EXACT_RAM_GB,
};
