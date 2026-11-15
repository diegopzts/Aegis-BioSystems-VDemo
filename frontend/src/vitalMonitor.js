// Canvas engine adapted from the user's datossensor.html; all access is scoped to one monitor.
export function mountVitalMonitor(root, onSample) {
  const el = id => root.getElementById(id);

  // ============================================================================
  // 1. ESTADO GLOBAL DEL SISTEMA, CREADOR CUSTOM, NIRS Y TELEMETRÍA USB
  // ============================================================================
  const state = {
    fuente: 'SIM',               // 'SIM' | 'USB'
    modoECG: 'normal',           // 'normal' | 'stemi' | 'fv' | 'paro' | 'custom'
    spo2: 98,                    // 60 a 100 (%) - Oxímetro de pulso arterial
    sto2: 84,                    // 30 a 100 (%) - NIRS periférico antebrazo
    rso2: 68,                    // 25 a 95 (%)  - NIRS cerebral frontal
    modoQuimio: 'basal',         // 'basal' | 'radiacion'
    nivelRadiacion: 'saludable', // 'saludable' | 'ligero' | 'preocupante' | 'peligro'
    customECG: {
      bpm: 75,
      stMv: 0.00,
      pAmp: 0.12,
      prMs: 150,
      qrsMs: 88,
      tAmp: 0.22
    },
    usbBuffer: [],
    usbStats: {
      minVal: 1023,
      maxVal: 0,
      lastRaw: 0,
      filterWindow: [],
      samplesCount: 0,
      sampleRateHz: 185,
      lastRateTime: Date.now(),
      history: [],
      lastPeakTime: 0,
      beatsAnalyzed: 0,
      liveMetrics: {
        bpm: 0,
        ritmo: 'CALIBRATING SIGNAL...',
        colorBpm: '#38bdf8',
        ondaP: 'Analyzing...',
        subP: 'Waiting for heartbeat',
        pr: '--- ms',
        subPr: 'In progress',
        qrs: '--- ms',
        subQrs: 'In progress',
        qtc: '--- ms',
        subQtc: 'In progress',
        st: '0.00 mV',
        subSt: 'Calibrating',
        esAlerta: false,
        severidad: 0,
        colorAlerta: '#10b981',
      }
    },
    port: null,
    reader: null
  };

  // ============================================================================
  // 2. EVALUADOR DINÁMICO DEL CREADOR PERSONALIZADO DE ONDA ECG (SLIDERS)
  // ============================================================================
  function actualizarCustomECG() {
    const c = state.customECG;
    c.bpm = parseInt(el('cust-slider-bpm').value, 10);
    c.stMv = parseFloat(el('cust-slider-st').value);
    c.pAmp = parseFloat(el('cust-slider-p').value);
    c.prMs = parseInt(el('cust-slider-pr').value, 10);
    c.qrsMs = parseInt(el('cust-slider-qrs').value, 10);
    c.tAmp = parseFloat(el('cust-slider-t').value);

    el('cust-lbl-bpm').textContent = `${c.bpm} BPM`;
    el('cust-lbl-st').textContent = `${c.stMv >= 0 ? '+' : ''}${c.stMv.toFixed(2)} mV`;
    el('cust-lbl-p').textContent = `${c.pAmp.toFixed(2)} mV`;
    el('cust-lbl-pr').textContent = `${c.prMs} ms`;
    el('cust-lbl-qrs').textContent = `${c.qrsMs} ms`;
    el('cust-lbl-t').textContent = `${c.tAmp >= 0 ? '+' : ''}${c.tAmp.toFixed(2)} mV`;

    actualizarInterfazCompleta();
  }

  function restablecerCustomECG() {
    el('cust-slider-bpm').value = 75;
    el('cust-slider-st').value = 0.00;
    el('cust-slider-p').value = 0.12;
    el('cust-slider-pr').value = 150;
    el('cust-slider-qrs').value = 88;
    el('cust-slider-t').value = 0.22;
    actualizarCustomECG();
  }

  function obtenerPerfilCustomECG() {
    const c = state.customECG;
    const rrSec = 60 / c.bpm;
    const qtBaseMs = 260 + c.qrsMs + (c.tAmp < 0 ? 45 : 25);
    const qtcMs = Math.round(qtBaseMs / Math.sqrt(rrSec));

    let severidad = 0;
    let colorBpm = '#10b981';
    let ritmo = 'NORMAL CUSTOM RHYTHM';

    if (c.bpm < 50) {
      ritmo = 'MARKED BRADYCARDIA';
      colorBpm = '#f59e0b';
      severidad = Math.max(severidad, 2);
    } else if (c.bpm < 60) {
      ritmo = 'SINUS BRADYCARDIA';
      colorBpm = '#38bdf8';
      severidad = Math.max(severidad, 1);
    } else if (c.bpm > 150) {
      ritmo = 'SEVERE TACHYCARDIA';
      colorBpm = '#ef4444';
      severidad = Math.max(severidad, 3);
    } else if (c.bpm > 100) {
      ritmo = 'SINUS TACHYCARDIA';
      colorBpm = '#f59e0b';
      severidad = Math.max(severidad, 1);
    }

    const hayP = c.pAmp >= 0.04;
    let subPr = 'Normal (120-200)';
    if (!hayP) {
      subPr = 'No P wave';
      severidad = Math.max(severidad, 2);
    } else if (c.prMs > 200) {
      subPr = '⚠️ Prolonged PR (>200)';
      severidad = Math.max(severidad, 1);
    } else if (c.prMs < 120) {
      subPr = '⚠️ Short PR (<120)';
      severidad = Math.max(severidad, 1);
    }

    const qrsAncho = c.qrsMs >= 120;
    if (qrsAncho) {
      severidad = Math.max(severidad, 2);
    }

    let subSt = 'Isoelectric';
    let esAlertaST = false;
    if (c.stMv >= 0.15) {
      ritmo = '⚠️ ST ELEVATION (STEMI)';
      colorBpm = '#ef4444';
      subSt = '🚨 ST ELEVATION';
      esAlertaST = true;
      severidad = 3;
    } else if (c.stMv <= -0.10) {
      ritmo = '⚠️ ST DEPRESSION (ISCHEMIA)';
      colorBpm = '#f59e0b';
      subSt = '⚠️ ST DEPRESSION';
      esAlertaST = true;
      severidad = Math.max(severidad, 2);
    }

    if (c.tAmp <= -0.10) {
      severidad = Math.max(severidad, 2);
    } else if (c.tAmp >= 0.45) {
      severidad = Math.max(severidad, 1);
    }

    return {
      bpm: c.bpm,
      ritmo,
      colorBpm,
      ondaP: hayP ? 'Present' : 'Absent',
      subP: hayP ? `Amplitude (+${c.pAmp.toFixed(2)} mV)` : '0.00 mV (No P wave)',
      pr: hayP ? `${c.prMs} ms` : '---',
      subPr,
      qrs: `${c.qrsMs} ms`,
      subQrs: qrsAncho ? '⚠️ Wide QRS (≥120)' : 'Narrow (<120)',
      qtc: `${qtcMs} ms`,
      subQtc: qtcMs <= 450 ? 'Normal (<450)' : '⚠️ Prolonged QTc',
      st: `${c.stMv >= 0 ? '+' : ''}${c.stMv.toFixed(2)} mV`,
      subSt,
      esAlerta: esAlertaST,
      severidad,
    };
  }

  // ============================================================================
  // 3. EVALUADOR CLÍNICO DE OXIMETRÍA DUAL: ARTERIAL (SpO2) + NIRS (StO2 / rSO2)
  // ============================================================================
  function obtenerEstadoOximetro(valor) {
    const spo2 = parseInt(valor, 10);
    if (spo2 >= 95) {
      return {
        categoria: 'sano',
        badge: 'NORMAL (95–100%)',
        color: '#10b981',
        bgBadge: 'rgba(16, 185, 129, 0.15)',
        borderBadge: 'rgba(16, 185, 129, 0.4)',
        textColorBadge: '#6ee7b7',
        severidad: 0
      };
    } else if (spo2 >= 90) {
      return {
        categoria: 'leve',
        badge: 'MILD HYPOXIA (90–94%)',
        color: '#38bdf8',
        bgBadge: 'rgba(56, 189, 248, 0.15)',
        borderBadge: 'rgba(56, 189, 248, 0.45)',
        textColorBadge: '#7dd3fc',
        severidad: 1
      };
    } else if (spo2 >= 85) {
      return {
        categoria: 'moderada',
        badge: 'MODERATE HYPOXIA (85–89%)',
        color: '#f59e0b',
        bgBadge: 'rgba(245, 158, 11, 0.2)',
        borderBadge: 'rgba(245, 158, 11, 0.5)',
        textColorBadge: '#fcd34d',
        severidad: 2
      };
    } else {
      return {
        categoria: 'grave',
        badge: '🚨 SEVERE HYPOXEMIA (≤ 84%)',
        color: '#ef4444',
        bgBadge: 'rgba(239, 68, 68, 0.25)',
        borderBadge: '#ef4444',
        textColorBadge: '#fca5a5',
        severidad: 3
      };
    }
  }

  function obtenerEstadoNIRS(sto2Val, rso2Val, spo2Val) {
    const sto2 = parseInt(sto2Val, 10);
    const rso2 = parseInt(rso2Val, 10);
    const spo2 = parseInt(spo2Val, 10);

    // Evaluar StO2 periférica (antebrazo / tenar — umbral shock < 75%, crítico < 60%)
    let sevSto2 = 0;
    let colorSto2 = '#10b981';
    let catSto2 = 'ok';
    if (sto2 < 60) {
      sevSto2 = 3; colorSto2 = '#ef4444'; catSto2 = 'crit';
    } else if (sto2 < 75) {
      sevSto2 = 2; colorSto2 = '#f59e0b'; catSto2 = 'warn';
    }

    // Evaluar rSO2 cerebral (frontal — umbral intervención < 50%, crítico < 45%)
    let sevRso2 = 0;
    let colorRso2 = '#10b981';
    let catRso2 = 'ok';
    if (rso2 < 45) {
      sevRso2 = 3; colorRso2 = '#ef4444'; catRso2 = 'crit';
    } else if (rso2 < 50) {
      sevRso2 = 2; colorRso2 = '#f59e0b'; catRso2 = 'warn';
    } else if (rso2 < 55) {
      sevRso2 = 1; colorRso2 = '#38bdf8'; catRso2 = 'warn';
    }

    const sevMaxNirs = Math.max(sevSto2, sevRso2);
    const colorBorde = sevMaxNirs === 3 ? '#ef4444' : (sevMaxNirs === 2 ? '#f59e0b' : (sevMaxNirs === 1 ? '#38bdf8' : '#38bdf8'));

    if (sevMaxNirs === 0) {
    } else if (spo2 >= 95 && sevSto2 >= 2 && sevRso2 === 0) {
    } else if (sevRso2 >= 2 && sevSto2 === 0) {
    } else {
    }

    return {
      sevSto2, colorSto2, catSto2,
      sevRso2, colorRso2, catRso2,
      sevMaxNirs, colorBorde
    };
  }

  function cambiarSpo2(valor) {
    if (state.fuente === 'USB') return;
    state.spo2 = parseInt(valor, 10);
    el('ox-slider').value = state.spo2;
    actualizarInterfazCompleta();
  }

  function seleccionarPresetOximetro(valor) {
    if (state.fuente === 'USB') return;
    cambiarSpo2(valor);
  }

  function cambiarNIRS(canal, valor) {
    if (state.fuente === 'USB') return;
    const val = parseInt(valor, 10);
    if (canal === 'sto2') {
      state.sto2 = val;
      el('sto2-slider').value = val;
    } else {
      state.rso2 = val;
      el('rso2-slider').value = val;
    }
    actualizarInterfazCompleta();
  }

  // ============================================================================
  // 4. BASE DE DATOS DE LOS 4 RANGOS DE RADIACIÓN / RONSS (MANFUL ET AL., 2025)
  // ============================================================================
  const RANGOS_RADIACION = {
    saludable: {
      etiqueta: 'Normal baseline',
      color: '#10b981',
      severidad: 0,
      h2o2: 1.20, pH2o2: 15, cH2o2: '#10b981',
      o2: 0.15,   pO2: 18,   cO2: '#10b981',
      onoo: 12,   pOnoo: 14, cOnoo: '#10b981',
      no: 35,     pNo: 35,   cNo: '#10b981',
      gsh: 4.80,  pGsh: 80,  cGsh: '#10b981',
      mda: 0.85,  pMda: 20,  cMda: '#10b981',
    },
    ligero: {
      etiqueta: 'Mild exposure',
      color: '#38bdf8',
      severidad: 1,
      h2o2: 4.80, pH2o2: 38, cH2o2: '#38bdf8',
      o2: 0.65,   pO2: 36,   cO2: '#38bdf8',
      onoo: 30,   pOnoo: 30, cOnoo: '#38bdf8',
      no: 40,     pNo: 40,   cNo: '#10b981',
      gsh: 3.60,  pGsh: 62,  cGsh: '#38bdf8',
      mda: 1.55,  pMda: 36,  cMda: '#38bdf8',
    },
    preocupante: {
      etiqueta: 'Moderate exposure',
      color: '#f59e0b',
      severidad: 2,
      h2o2: 11.50, pH2o2: 68, cH2o2: '#f59e0b',
      o2: 1.55,    pO2: 65,   cO2: '#f59e0b',
      onoo: 68,    pOnoo: 60, cOnoo: '#f59e0b',
      no: 55,      pNo: 55,   cNo: '#f59e0b',
      gsh: 2.35,   pGsh: 40,  cGsh: '#f59e0b',
      mda: 2.85,   pMda: 64,  cMda: '#f59e0b',
    },
    peligro: {
      etiqueta: 'Severe acute exposure',
      color: '#ef4444',
      severidad: 3,
      h2o2: 21.80, pH2o2: 96, cH2o2: '#ef4444',
      o2: 2.95,    pO2: 94,   cO2: '#ef4444',
      onoo: 135,   pOnoo: 90, cOnoo: '#ef4444',
      no: 88,      pNo: 82,   cNo: '#ef4444',
      gsh: 1.25,   pGsh: 18,  cGsh: '#ef4444',
      mda: 4.50,   pMda: 90,  cMda: '#ef4444',
    }
  };

  // ============================================================================
  // 5. PERFILES ECG PREDEFINIDOS
  // ============================================================================
  const PERFILES_ECG = {
    normal: {
      bpm: 77, ritmo: 'SINUS RHYTHM', colorBpm: '#10b981',
      ondaP: 'Present', subP: 'Sinus (+)',
      pr: '150 ms', subPr: 'Normal (120-200)',
      qrs: '88 ms', subQrs: 'Narrow (<120)',
      qtc: '395 ms', subQtc: 'Normal (<440)',
      st: '+0.01 mV', subSt: 'Isoelectric', esAlerta: false, severidad: 0,
    },
    stemi: {
      bpm: 98, ritmo: 'TACHYCARDIA • STEMI', colorBpm: '#ef4444',
      ondaP: 'Present', subP: 'Sinus (+)',
      pr: '162 ms', subPr: 'Normal (120-200)',
      qrs: '98 ms', subQrs: 'Normal (<120)',
      qtc: '415 ms', subQtc: 'Normal (<440)',
      st: '+0.28 mV', subSt: '🚨 ST ELEVATION', esAlerta: true, severidad: 3,
    },
    fv: {
      bpm: 245, ritmo: 'VENTRICULAR FIBRILLATION', colorBpm: '#ef4444',
      ondaP: 'Absent', subP: 'Chaotic',
      pr: '---', subPr: 'Unmeasurable',
      qrs: '165 ms', subQrs: 'Disorganized',
      qtc: '---', subQtc: 'Unmeasurable',
      st: 'Indeterminate', subSt: 'VF waves', esAlerta: true, severidad: 3,
    },
    paro: {
      bpm: 0, ritmo: 'ASYSTOLE / ARREST', colorBpm: '#ef4444',
      ondaP: 'Absent', subP: 'No activity',
      pr: '---', subPr: 'No activity',
      qrs: '0 ms', subQrs: 'Absent',
      qtc: '---', subQtc: 'No activity',
      st: '0.00 mV', subSt: 'Isoelectric line', esAlerta: true, severidad: 3,
    }
  };

  // ============================================================================
  // 6. ANALIZADOR MORFOLÓGICO Y DIAGNÓSTICO EN TIEMPO REAL PARA ARDUINO (USB)
  // ============================================================================
  function procesarLatidoUSB(peakIndex) {
    const stats = state.usbStats;
    if (stats.history.length < 120) return;
    const time = stats.history[peakIndex].t;
    stats.lastPeakTime = time;
    stats.beatsAnalyzed++;
    el('usb-beats-val').textContent = stats.beatsAnalyzed;
  }

  // ============================================================================
  // 7. LÓGICA DE SELECCIÓN Y ACOPLAMIENTO BIDIRECCIONAL
  // ============================================================================
  function seleccionarModoECG(nuevoModo) {
    if (state.fuente === 'USB') return;
    state.modoECG = nuevoModo;

    const customBuilder = el('custom-ecg-builder');
    customBuilder.style.display = (nuevoModo === 'custom') ? 'flex' : 'none';

    const regla = el('select-ecg-to-quimio').value;
    if (regla === 'saludable' || nuevoModo === 'normal' || nuevoModo === 'custom') {
      state.modoQuimio = 'basal';
      state.nivelRadiacion = 'saludable';
    } else {
      state.modoQuimio = 'radiacion';
      state.nivelRadiacion = (nuevoModo === 'stemi') ? 'preocupante' : 'peligro';
    }
    actualizarInterfazCompleta();
  }

  function seleccionarModoPrincipalQuimio(modo) {
    if (state.fuente === 'USB') return;
    state.modoQuimio = modo;

    if (modo === 'basal') {
      state.nivelRadiacion = 'saludable';
    } else if (modo === 'radiacion' && state.nivelRadiacion === 'saludable') {
      state.nivelRadiacion = 'ligero';
    }
    aplicarAcoplamientoHaciaECG();
    actualizarInterfazCompleta();
  }

  function seleccionarNivelRadiacion(nivel) {
    if (state.fuente === 'USB') return;
    state.nivelRadiacion = nivel;
    state.modoQuimio = (nivel === 'saludable') ? 'basal' : 'radiacion';

    aplicarAcoplamientoHaciaECG();
    actualizarInterfazCompleta();
  }

  function aplicarAcoplamientoHaciaECG() {
    if (state.modoECG === 'custom') return;
    const regla = el('select-quimio-to-ecg').value;
    if (regla === 'normal' || state.nivelRadiacion === 'saludable') {
      state.modoECG = 'normal';
    } else {
      state.modoECG = (state.nivelRadiacion === 'peligro') ? 'stemi' : 'normal';
    }
  }

  function onCambioAcoplamientoECG() {
    if (state.fuente === 'SIM') seleccionarModoECG(state.modoECG);
  }

  function onCambioAcoplamientoQuimio() {
    if (state.fuente === 'SIM') {
      aplicarAcoplamientoHaciaECG();
      actualizarInterfazCompleta();
    }
  }

  function configurarModoFuente(fuente) {
    state.fuente = fuente;
    const mainGrid = el('main-grid');
    const rightSimPanel = el('right-sim-panel');
    const simEcgButtons = el('sim-ecg-buttons');
    const customBuilder = el('custom-ecg-builder');
    const syncBar = el('sync-bar');
    const diagSectionOx = el('diag-section-ox');
    const diagSectionQuimio = el('diag-section-quimio');
    const liveMon = el('usb-live-monitor');

    if (fuente === 'USB') {
      state.usbBuffer = [];
      state.usbStats.filterWindow = [];
      state.usbStats.history = [];
      state.usbStats.lastPeakTime = 0;
      state.usbStats.beatsAnalyzed = 0;
      state.usbStats.minVal = 1023;
      state.usbStats.maxVal = 0;

      rightSimPanel.style.display = 'none';
      mainGrid.classList.add('usb-single-mode');
      simEcgButtons.style.display = 'none';
      customBuilder.style.display = 'none';
      syncBar.style.display = 'none';
      diagSectionOx.style.display = 'none';
      diagSectionQuimio.style.display = 'none';

      liveMon.style.display = 'block';
    } else {
      rightSimPanel.style.display = 'flex';
      mainGrid.classList.remove('usb-single-mode');
      simEcgButtons.style.display = 'flex';
      customBuilder.style.display = (state.modoECG === 'custom') ? 'flex' : 'none';
      syncBar.style.display = 'flex';
      diagSectionOx.style.display = 'block';
      diagSectionQuimio.style.display = 'block';

      liveMon.style.display = 'none';
    }

    draw = true;
    resizeCanvas();
    actualizarInterfazCompleta();
  }

  // ============================================================================
  // 8. ACTUALIZACIÓN DE UI COMPLETA
  // ============================================================================
  function actualizarInterfazCompleta() {
    let mEcg;
    if (state.fuente === 'USB') {
      mEcg = {...usbStatsEmpty.liveMetrics, ritmo: 'ADC SIGNAL ONLY', ondaP: '—', subP: '', pr: '—', subPr: '', qrs: '—', subQrs: '', qtc: '—', subQtc: '', st: '—', subSt: ''};
    } else if (state.modoECG === 'custom') {
      mEcg = obtenerPerfilCustomECG();
    } else {
      mEcg = PERFILES_ECG[state.modoECG];
    }

    el('val-bpm').textContent = (state.fuente === 'USB' && mEcg.bpm === 0) ? '--' : mEcg.bpm;
    el('val-bpm').style.color = mEcg.colorBpm;
    el('lbl-ritmo').textContent = (state.fuente === 'USB')
      ? `AD8232 USB • ${mEcg.ritmo}`
      : `${mEcg.bpm} BPM • ${mEcg.ritmo}`;

    el('val-p').textContent = mEcg.ondaP;
    el('sub-p').textContent = mEcg.subP;
    el('val-pr').textContent = mEcg.pr;
    el('sub-pr').textContent = mEcg.subPr;
    el('val-qrs').textContent = mEcg.qrs;
    el('sub-qrs').textContent = mEcg.subQrs;
    el('val-qtc').textContent = mEcg.qtc;
    el('sub-qtc').textContent = mEcg.subQtc;
    el('val-st').textContent = mEcg.st;
    el('sub-st').textContent = mEcg.subSt;

    const boxSt = el('box-st');
    const subSt = el('sub-st');
    if (mEcg.esAlerta && (mEcg.subSt.includes('ST ELEVATION') || mEcg.subSt.includes('ST elevation'))) {
      boxSt.style.borderColor = '#ef4444';
      boxSt.style.background = 'rgba(239, 68, 68, 0.15)';
      subSt.style.color = '#fca5a5';
    } else if (mEcg.esAlerta && mEcg.subSt.includes('ST DEPRESSION')) {
      boxSt.style.borderColor = '#f59e0b';
      boxSt.style.background = 'rgba(245, 158, 11, 0.15)';
      subSt.style.color = '#fcd34d';
    } else {
      boxSt.style.borderColor = '#1e2f4a';
      boxSt.style.background = '#121e31';
      subSt.style.color = '#10b981';
    }

    const diagBox = el('diag-box');
    const badgeGlobal = el('badge-alerta-global');
    if (state.fuente === 'USB') {
      el('diag-panel-title').textContent = 'Local USB signal';
      el('diag-ecg-text').textContent = 'Serial ADC samples with normalized amplitude.';
      badgeGlobal.textContent = 'LOCAL USB';
      badgeGlobal.classList.remove('badge-critical');
      badgeGlobal.style.color = '#38bdf8';
      badgeGlobal.style.borderColor = '#38bdf8';
      return;
    }
    el('diag-panel-title').textContent = 'Training signal interpretation';
    ['normal', 'stemi', 'fv', 'paro', 'custom'].forEach(m => {
      const btn = el(`ecg-btn-${m}`);
      btn.classList.toggle('btn-active', state.modoECG === m && m !== 'custom');
      if (m !== 'normal') btn.classList.toggle('active', state.modoECG === m);
    });

    // Actualizar Oxímetro Dual (SpO2 + NIRS)
    const oxInfo = obtenerEstadoOximetro(state.spo2);
    const nirsInfo = obtenerEstadoNIRS(state.sto2, state.rso2, state.spo2);

    const oxCard = el('oximeter-card');
    const oxValEl = el('val-spo2');
    const oxBadge = el('ox-status-badge');

    oxValEl.textContent = `${state.spo2}%`;
    oxValEl.style.color = oxInfo.color;
    oxCard.style.borderLeftColor = oxInfo.color;

    oxBadge.textContent = oxInfo.badge;
    oxBadge.style.background = oxInfo.bgBadge;
    oxBadge.style.borderColor = oxInfo.borderBadge;
    oxBadge.style.color = oxInfo.textColorBadge;
    el('ox-action-box').textContent = 'Simulated training value.';

    ['sano', 'leve', 'moderada', 'grave'].forEach(cat => {
      const btn = el(`ox-btn-${cat}`);
      btn.className = 'btn-ox';
      if (oxInfo.categoria === cat) btn.classList.add(`active-${cat}`);
    });

    // Actualizar UI NIRS
    el('nirs-card').style.borderLeftColor = nirsInfo.colorBorde;
    const sto2El = el('val-sto2');
    sto2El.textContent = `${state.sto2}%`;
    sto2El.style.color = nirsInfo.colorSto2;

    const rso2El = el('val-rso2');
    rso2El.textContent = `${state.rso2}%`;
    rso2El.style.color = nirsInfo.colorRso2;

    ['ok', 'warn', 'crit'].forEach(c => {
      const bSto = el(`sto2-btn-${c}`);
      bSto.className = 'btn-nirs-mini';
      if (nirsInfo.catSto2 === c) bSto.classList.add(`active-${c}`);

      const bRso = el(`rso2-btn-${c}`);
      bRso.className = 'btn-nirs-mini';
      if (nirsInfo.catRso2 === c) bRso.classList.add(`active-${c}`);
    });
    el('nirs-action-box').textContent = 'Simulated training values.';

    // Actualizar Quimiosensores RONSS
    el('q-btn-basal').classList.toggle('btn-active', state.modoQuimio === 'basal');
    el('q-btn-radiacion').classList.toggle('btn-active', state.modoQuimio === 'radiacion');

    ['saludable', 'ligero', 'preocupante', 'peligro'].forEach(lvl => {
      const btn = el(`lvl-${lvl}`);
      btn.className = 'btn-nivel';
      if (state.nivelRadiacion === lvl) btn.classList.add(`active-${lvl}`);
    });

    const rData = RANGOS_RADIACION[state.nivelRadiacion];
    el('val-h2o2').textContent = `${rData.h2o2.toFixed(2)} µM`;
    el('bar-h2o2').style.width = `${rData.pH2o2}%`;
    el('bar-h2o2').style.backgroundColor = rData.cH2o2;

    el('val-o2').textContent = `${rData.o2.toFixed(2)} nM`;
    el('bar-o2').style.width = `${rData.pO2}%`;
    el('bar-o2').style.backgroundColor = rData.cO2;

    el('val-onoo').textContent = `${rData.onoo} nM`;
    el('bar-onoo').style.width = `${rData.pOnoo}%`;
    el('bar-onoo').style.backgroundColor = rData.cOnoo;

    el('val-no').textContent = `${rData.no} nM`;
    el('bar-no').style.width = `${rData.pNo}%`;
    el('bar-no').style.backgroundColor = rData.cNo;

    el('val-gsh').textContent = `${rData.gsh.toFixed(2)} mM`;
    el('bar-gsh').style.width = `${rData.pGsh}%`;
    el('bar-gsh').style.backgroundColor = rData.cGsh;

    el('val-mda').textContent = `${rData.mda.toFixed(2)} µM`;
    el('bar-mda').style.width = `${rData.pMda}%`;
    el('bar-mda').style.backgroundColor = rData.cMda;

    el('diag-ecg-text').textContent = `Simulated ECG profile ${mEcg.ritmo} · ${mEcg.bpm} BPM displayed.`;
    el('diag-ox-text').textContent = `SpO₂ ${state.spo2}% · StO₂ ${state.sto2}% · rSO₂ ${state.rso2}% (simulated).`;
    el('diag-quimio-text').textContent = `Simulated redox profile ${rData.etiqueta}.`;
    const severity = Math.max(mEcg.severidad, oxInfo.severidad, nirsInfo.sevMaxNirs, rData.severidad);
    const color = ['#10b981', '#38bdf8', '#f59e0b', '#ef4444'][severity];
    diagBox.style.borderLeftColor = color;
    badgeGlobal.textContent = ['NOMINAL PROFILE', 'MILD VARIATION', 'MODERATE VARIATION', 'HIGH VARIATION'][severity];
    badgeGlobal.style.color = color;
    badgeGlobal.style.borderColor = color;
    badgeGlobal.classList.toggle('badge-critical', severity === 3);
  }

  // ============================================================================
  // 9. MOTOR GRÁFICO DE ONDA ECG (USB + PERFILES + CREADOR PARAMÉTRICO CUSTOM)
  // ============================================================================
  const canvas = el('ecgCanvas');
  const ctx = canvas.getContext('2d');
  let phase = 0;
  let dataPoints = [];
  let frame = 0, last = 0, sampleBudget = 0, lastPublish = -Infinity, draw = true, controlsChanged = false;
  let paused = false, disposed = false, epoch = 0;
  let port, reader, connecting = false, serialTicket = 0, lastUsbSample = 0;
  const usbStatsEmpty = {...state.usbStats, liveMetrics: {...state.usbStats.liveMetrics}};
  const controller = new AbortController();
  const {signal} = controller;
  function publish() {
    const mode = state.fuente === 'USB' ? 'usb' : paused ? 'paused' : 'simulation';
    const ecg = state.modoECG === 'custom' ? obtenerPerfilCustomECG() : PERFILES_ECG[state.modoECG];
    const chem = RANGOS_RADIACION[state.nivelRadiacion];
    onSample({mode, epoch, sample: mode !== 'simulation' ? null : {
      profile: state.modoECG, ecgBpm: ecg.bpm, spo2: state.spo2, sto2: state.sto2, rso2: state.rso2,
      radiationProfile: state.nivelRadiacion, h2o2: chem.h2o2, o2: chem.o2, onoo: chem.onoo,
      no: chem.no, gsh: chem.gsh, mda: chem.mda,
    }});
  }
  function snapshotAfterControls() {
    lastPublish = performance.now();
    publish();
  }

  function resizeCanvas() {
    const width = canvas.parentElement.clientWidth, height = canvas.parentElement.clientHeight;
    if (!width || !height || (width === canvas.width && height === canvas.height && dataPoints.length)) return;
    canvas.width = width;
    canvas.height = height;
    dataPoints = new Array(width).fill(height * .55);
    draw = true;
  }
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resizeCanvas) : undefined;
  if (observer) observer.observe(canvas.parentElement);
  else window.addEventListener('resize', resizeCanvas, {signal});
  resizeCanvas();

  function mapearMuestraUSB(rawVal) {
    const fw = state.usbStats.filterWindow;
    fw.push(rawVal);
    if (fw.length > 5) fw.shift();
    const filteredVal = fw.reduce((a, b) => a + b, 0) / fw.length;

    const now = performance.now();
    state.usbStats.history.push({ v: filteredVal, t: now });
    if (state.usbStats.history.length > 450) state.usbStats.history.shift();

    if (filteredVal < state.usbStats.minVal) state.usbStats.minVal = filteredVal;
    if (filteredVal > state.usbStats.maxVal) state.usbStats.maxVal = filteredVal;

    state.usbStats.minVal += (filteredVal - state.usbStats.minVal) * 0.003;
    state.usbStats.maxVal -= (state.usbStats.maxVal - filteredVal) * 0.003;

    const span = Math.max(state.usbStats.maxVal - state.usbStats.minVal, 15);
    const norm = (filteredVal - state.usbStats.minVal) / span;

    const h = state.usbStats.history;
    if (h.length >= 25) {
      const checkIdx = h.length - 12;
      const candidate = h[checkIdx];
      const candNorm = (candidate.v - state.usbStats.minVal) / span;

      if (candNorm > 0.72 && (candidate.t - state.usbStats.lastPeakTime) > 440) {
        let isLocalMax = true;
        for (let k = checkIdx - 8; k <= checkIdx + 8; k++) {
          if (h[k].v > candidate.v) {
            isLocalMax = false;
            break;
          }
        }
        if (isLocalMax) procesarLatidoUSB(checkIdx);
      }
    }

    return canvas.height * (0.85 - norm * 0.70);
  }

  function generarMuestraSimulada(t) {
    const base = canvas.height * 0.58;
    const modo = state.modoECG;

    if (modo === 'paro') return base + (Math.random() - 0.5) * 1.5;
    if (modo === 'fv') return base + Math.sin(t * 28) * 28 + Math.cos(t * 43) * 18 + (Math.random() - 0.5) * 10;

    if (modo === 'custom') {
      const cfg = state.customECG;
      const freqHz = cfg.bpm / 60.0;
      const cycleMs = 1000.0 / freqHz;
      const c = (t * freqHz) % 1.0;

      const rCenter = 0.34;
      const pDuration = Math.min(0.11, 85 / cycleMs);
      const prNorm = Math.min(0.28, cfg.prMs / cycleMs);
      const pStart = Math.max(0.02, rCenter - prNorm);
      const pEnd = pStart + pDuration;

      const qrsHalf = Math.min(0.09, (cfg.qrsMs / 2) / cycleMs);
      const qStart = rCenter - qrsHalf;
      const jPoint = rCenter + qrsHalf;

      const tStart = jPoint + 0.03;
      const tEnd = Math.min(0.95, tStart + Math.min(0.26, 220 / cycleMs));

      const pxPerMv = 105;
      const stOffsetPx = cfg.stMv * pxPerMv;
      const pHeightPx = cfg.pAmp * pxPerMv;
      const tHeightPx = cfg.tAmp * pxPerMv;

      let v = 0;
      if (c >= pStart && c <= pEnd && cfg.pAmp > 0) {
        const p = (c - pStart) / (pEnd - pStart);
        v -= Math.sin(p * Math.PI) * pHeightPx;
      } else if (c >= qStart && c < rCenter) {
        const p = (c - qStart) / (rCenter - qStart);
        if (p < 0.28) {
          v += (p / 0.28) * 10;
        } else {
          const rp = (p - 0.28) / 0.72;
          v += 10 - Math.sin(rp * (Math.PI / 2)) * 115;
        }
      } else if (c >= rCenter && c <= jPoint) {
        const p = (c - rCenter) / (jPoint - rCenter);
        if (p < 0.65) {
          const sp = p / 0.65;
          v += -105 + sp * 123;
        } else {
          const jp = (p - 0.65) / 0.35;
          v += (1 - jp) * 18 - jp * stOffsetPx;
        }
      } else if (c > jPoint && c < tStart) {
        v -= stOffsetPx;
      } else if (c >= tStart && c <= tEnd) {
        const p = (c - tStart) / (tEnd - tStart);
        v -= stOffsetPx + Math.sin(p * Math.PI) * tHeightPx;
      }

      return base + v + (Math.random() - 0.5) * 1.4;
    }

    const freq = PERFILES_ECG[modo].bpm / 60;
    const c = (t * freq) % 1.0;

    let v = 0;
    if (c > 0.10 && c < 0.18) {
      v -= Math.sin(((c - 0.10) / 0.08) * Math.PI) * 12;
    } else if (c >= 0.22 && c < 0.24) {
      v += ((c - 0.22) / 0.02) * 10;
    } else if (c >= 0.24 && c < 0.27) {
      const p = (c - 0.24) / 0.03;
      v += 10 - Math.sin(p * Math.PI) * 105;
    } else if (c >= 0.27 && c < 0.30) {
      const p = (c - 0.27) / 0.03;
      if (modo === 'stemi') v += (1 - p) * 12 - p * 34;
      else v += Math.sin(p * Math.PI) * 18;
    } else if (c >= 0.30 && c < 0.52) {
      const p = (c - 0.30) / 0.22;
      if (modo === 'stemi') v -= 34 + Math.sin(p * Math.PI) * 22;
      else if (p > 0.25 && p < 0.85) v -= Math.sin(((p - 0.25) / 0.60) * Math.PI) * 22;
    }

    return base + v + (Math.random() - 0.5) * 1.8;
  }

  function dibujarCuadricula() {
    ctx.strokeStyle = 'rgba(30, 47, 74, 0.35)';
    ctx.lineWidth = 1;
    const step = 20;
    for (let x = 0; x < canvas.width; x += step) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += step) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
    }
  }

  function loopAnimacion(time) {
    if (disposed) return;
    frame = requestAnimationFrame(loopAnimacion);
    if (time - lastPublish >= (controlsChanged ? 125 : 1000)) {
      controlsChanged = false;
      lastPublish = time;
      publish();
    }
    const elapsed = last ? Math.min(50, time - last) : 16.67;
    last = time;
    if (paused && !draw) return;
    draw = false;
    if (!ctx) return;
    ctx.fillStyle = '#050911';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    dibujarCuadricula();

    if (state.fuente === 'USB') {
      if (lastUsbSample && time - lastUsbSample > 2500) el('usb-status-text').textContent = 'No recent USB samples';
      while (state.usbBuffer.length > 0) {
        const raw = state.usbBuffer.shift();
        dataPoints.push(mapearMuestraUSB(raw));
        if (dataPoints.length > canvas.width) dataPoints.shift();
      }
      const ahora = Date.now();
      if (ahora - state.usbStats.lastRateTime >= 1000) {
        state.usbStats.sampleRateHz = state.usbStats.samplesCount || 185;
        el('usb-rate-val').textContent = state.usbStats.samplesCount;
        el('usb-raw-val').textContent = state.usbStats.lastRaw;
        state.usbStats.samplesCount = 0;
        state.usbStats.lastRateTime = ahora;
      }
    } else if (!paused) {
      sampleBudget += elapsed * .12;
      const count = Math.floor(sampleBudget);
      sampleBudget -= count;
      for (let i = 0; i < count; i++) {
        phase += 1 / 120;
        dataPoints.push(generarMuestraSimulada(phase));
        if (dataPoints.length > canvas.width) dataPoints.shift();
      }
    }

    ctx.beginPath();
    ctx.lineWidth = 2.2;
    if (state.fuente === 'USB') {
      ctx.strokeStyle = '#38bdf8';
    } else if (state.modoECG === 'custom') {
      ctx.strokeStyle = (state.customECG.stMv >= 0.15 || state.customECG.bpm > 150) ? '#ef4444' : '#c084fc';
    } else {
      ctx.strokeStyle = (state.modoECG === 'normal') ? '#10b981' : '#ef4444';
    }

    for (let x = 0; x < dataPoints.length; x++) {
      if (x === 0) ctx.moveTo(x, dataPoints[x]);
      else ctx.lineTo(x, dataPoints[x]);
    }
    ctx.stroke();

  }

  // ============================================================================
  // 10. CONEXIÓN SERIAL CON ARDUINO (WEB SERIAL API)
  // ============================================================================
  async function conectarArduinoUSB() {
    if (connecting || port || disposed) return;
    if (!navigator.serial) {
      el('usb-status-text').textContent = 'Web Serial is unavailable. Use a supported browser over HTTPS or localhost.';
      return;
    }
    const ticket = ++serialTicket;
    connecting = true;
    el('btn-connect-usb').disabled = true;
    let selected, connected = false, problem = '';
    try {
      selected = await navigator.serial.requestPort();
      if (disposed || ticket !== serialTicket) return;
      const baudRate = Number(el('baud-rate-select').value);
      await selected.open({baudRate});
      if (disposed || ticket !== serialTicket) { await selected.close(); return; }
      connected = true;
      port = selected;
      paused = false;
      updatePause();
      lastUsbSample = 0;
      state.usbStats.samplesCount = 0;
      state.usbStats.lastRateTime = Date.now();
      configurarModoFuente('USB');
      el('btn-connect-usb').style.display = 'none';
      el('btn-disconnect-usb').style.display = 'inline-block';
      el('monitor-pause').disabled = true;
      el('monitor-reset').disabled = true;
      el('usb-status-text').textContent = `USB connected (${baudRate} bps) · waiting for samples`;
      snapshotAfterControls();
      const decoder = new TextDecoder();
      const activeReader = selected.readable.getReader();
      reader = activeReader;
      let pending = '';
      try {
        while (!disposed && ticket === serialTicket) {
          const {value, done} = await activeReader.read();
          if (done) break;
          pending += decoder.decode(value, {stream:true});
          const lines = pending.split(/\r?\n/);
          pending = lines.pop().slice(-128);
          for (const line of lines) {
            const match = line.match(/[-+]?\d*\.?\d+/);
            if (!match) continue;
            const num = Number(match[0]);
            if (!Number.isFinite(num)) continue;
            if (!lastUsbSample || performance.now() - lastUsbSample > 2500) {
              el('usb-status-text').textContent = `USB connected (${baudRate} bps) · local data`;
            }
            lastUsbSample = performance.now();
            state.usbBuffer.push(num);
            state.usbStats.lastRaw = num;
            state.usbStats.samplesCount++;
            if (state.usbBuffer.length > 1600) state.usbBuffer.splice(0, state.usbBuffer.length - 1600);
          }
        }
      } finally {
        activeReader.releaseLock();
        if (reader === activeReader) reader = undefined;
      }
      if (ticket === serialTicket) problem = 'Serial port disconnected.';
    } catch (error) {
      if (!disposed && ticket === serialTicket) problem = error?.name === 'NotFoundError' ? 'No port selected.' : 'Could not open or read the USB port.';
    } finally {
      if (connected) await selected.close().catch(() => {});
      if (port === selected) port = undefined;
      connecting = false;
      if (!disposed) {
        configurarModoFuente('SIM');
        el('btn-connect-usb').disabled = false;
        el('btn-connect-usb').style.display = 'inline-block';
        el('btn-disconnect-usb').style.display = 'none';
        el('monitor-pause').disabled = false;
        el('monitor-reset').disabled = false;
        el('usb-status-text').textContent = 'LIVE SIMULATION — SYNTHETIC DATA';
        if (problem) el('monitor-sync').textContent = problem;
        snapshotAfterControls();
      }
    }
  }
  async function desconectarArduinoUSB() {
    serialTicket++;
    if (reader) await reader.cancel().catch(() => {});
  }
  function updatePause() {
    const button = el('monitor-pause');
    button.textContent = paused ? 'Resume' : 'Pause';
    button.setAttribute('aria-pressed', String(paused));
    for (const control of root.querySelectorAll('#sync-bar select, #sim-ecg-buttons button, #custom-ecg-builder input, #custom-ecg-builder button, #right-sim-panel input, #right-sim-panel button')) {
      control.disabled = paused;
    }
  }
  el('monitor-pause').addEventListener('click', () => {
    paused = !paused;
    updatePause();
    snapshotAfterControls();
  }, {signal});
  el('monitor-reset').addEventListener('click', () => {
    paused = false;
    updatePause();
    el('select-ecg-to-quimio').value = 'saludable';
    el('select-quimio-to-ecg').value = 'normal';
    restablecerCustomECG();
    seleccionarModoECG('normal');
    seleccionarModoPrincipalQuimio('basal');
    cambiarSpo2(98);
    cambiarNIRS('sto2', 84);
    cambiarNIRS('rso2', 68);
    phase = sampleBudget = 0;
    dataPoints.fill(canvas.height * .55);
    draw = true;
    epoch++;
    snapshotAfterControls();
  }, {signal});
  root.querySelector('[data-control-0]').addEventListener('click', event => { conectarArduinoUSB(); controlsChanged = true; }, {signal})
  root.querySelector('[data-control-1]').addEventListener('click', event => { desconectarArduinoUSB(); controlsChanged = true; }, {signal})
  root.querySelector('[data-control-2]').addEventListener('change', event => { onCambioAcoplamientoECG(); controlsChanged = true; }, {signal})
  root.querySelector('[data-control-3]').addEventListener('change', event => { onCambioAcoplamientoQuimio(); controlsChanged = true; }, {signal})
  root.querySelector('[data-control-4]').addEventListener('click', event => { seleccionarModoECG('normal'); controlsChanged = true; }, {signal})
  root.querySelector('[data-control-5]').addEventListener('click', event => { seleccionarModoECG('stemi'); controlsChanged = true; }, {signal})
  root.querySelector('[data-control-6]').addEventListener('click', event => { seleccionarModoECG('fv'); controlsChanged = true; }, {signal})
  root.querySelector('[data-control-7]').addEventListener('click', event => { seleccionarModoECG('paro'); controlsChanged = true; }, {signal})
  root.querySelector('[data-control-8]').addEventListener('click', event => { seleccionarModoECG('custom'); controlsChanged = true; }, {signal})
  root.querySelector('[data-control-9]').addEventListener('click', event => { restablecerCustomECG(); controlsChanged = true; }, {signal})
  root.querySelector('[data-control-10]').addEventListener('input', event => { actualizarCustomECG(); controlsChanged = true; }, {signal})
  root.querySelector('[data-control-11]').addEventListener('input', event => { actualizarCustomECG(); controlsChanged = true; }, {signal})
  root.querySelector('[data-control-12]').addEventListener('input', event => { actualizarCustomECG(); controlsChanged = true; }, {signal})
  root.querySelector('[data-control-13]').addEventListener('input', event => { actualizarCustomECG(); controlsChanged = true; }, {signal})
  root.querySelector('[data-control-14]').addEventListener('input', event => { actualizarCustomECG(); controlsChanged = true; }, {signal})
  root.querySelector('[data-control-15]').addEventListener('input', event => { actualizarCustomECG(); controlsChanged = true; }, {signal})
  root.querySelector('[data-control-16]').addEventListener('click', event => { seleccionarPresetOximetro(98); controlsChanged = true; }, {signal})
  root.querySelector('[data-control-17]').addEventListener('click', event => { seleccionarPresetOximetro(92); controlsChanged = true; }, {signal})
  root.querySelector('[data-control-18]').addEventListener('click', event => { seleccionarPresetOximetro(87); controlsChanged = true; }, {signal})
  root.querySelector('[data-control-19]').addEventListener('click', event => { seleccionarPresetOximetro(81); controlsChanged = true; }, {signal})
  root.querySelector('[data-control-20]').addEventListener('input', event => { cambiarSpo2(event.currentTarget.value); controlsChanged = true; }, {signal})
  root.querySelector('[data-control-21]').addEventListener('input', event => { cambiarNIRS('sto2', event.currentTarget.value); controlsChanged = true; }, {signal})
  root.querySelector('[data-control-22]').addEventListener('click', event => { cambiarNIRS('sto2', 84); controlsChanged = true; }, {signal})
  root.querySelector('[data-control-23]').addEventListener('click', event => { cambiarNIRS('sto2', 68); controlsChanged = true; }, {signal})
  root.querySelector('[data-control-24]').addEventListener('click', event => { cambiarNIRS('sto2', 48); controlsChanged = true; }, {signal})
  root.querySelector('[data-control-25]').addEventListener('input', event => { cambiarNIRS('rso2', event.currentTarget.value); controlsChanged = true; }, {signal})
  root.querySelector('[data-control-26]').addEventListener('click', event => { cambiarNIRS('rso2', 68); controlsChanged = true; }, {signal})
  root.querySelector('[data-control-27]').addEventListener('click', event => { cambiarNIRS('rso2', 48); controlsChanged = true; }, {signal})
  root.querySelector('[data-control-28]').addEventListener('click', event => { cambiarNIRS('rso2', 40); controlsChanged = true; }, {signal})
  root.querySelector('[data-control-29]').addEventListener('click', event => { seleccionarModoPrincipalQuimio('basal'); controlsChanged = true; }, {signal})
  root.querySelector('[data-control-30]').addEventListener('click', event => { seleccionarModoPrincipalQuimio('radiacion'); controlsChanged = true; }, {signal})
  root.querySelector('[data-control-31]').addEventListener('click', event => { seleccionarNivelRadiacion('saludable'); controlsChanged = true; }, {signal})
  root.querySelector('[data-control-32]').addEventListener('click', event => { seleccionarNivelRadiacion('ligero'); controlsChanged = true; }, {signal})
  root.querySelector('[data-control-33]').addEventListener('click', event => { seleccionarNivelRadiacion('preocupante'); controlsChanged = true; }, {signal})
  root.querySelector('[data-control-34]').addEventListener('click', event => { seleccionarNivelRadiacion('peligro'); controlsChanged = true; }, {signal})
  actualizarInterfazCompleta();
  frame = requestAnimationFrame(loopAnimacion);
  return () => {
    disposed = true;
    controller.abort();
    observer?.disconnect();
    cancelAnimationFrame(frame);
    void desconectarArduinoUSB();
  };
}
