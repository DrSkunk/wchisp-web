import { WchIspFlasher, WebUsbTransport, WebSerialTransport } from '/dist/index.js';

const statusEl = document.querySelector('#status');
const logEl = document.querySelector('#log');
const firmwareEl = document.querySelector('#firmware');
const baudEl = document.querySelector('#baud');

const connectUsbBtn = document.querySelector('#connect-usb');
const connectSerialBtn = document.querySelector('#connect-serial');
const disconnectBtn = document.querySelector('#disconnect');
const readConfigBtn = document.querySelector('#read-config');
const flashBtn = document.querySelector('#flash');

const eraseEl = document.querySelector('#erase');
const verifyEl = document.querySelector('#verify');
const resetEl = document.querySelector('#reset');
const unprotectEl = document.querySelector('#unprotect');

/** @type {WchIspFlasher | null} */
let flasher = null;

function setStatus(message) {
  statusEl.textContent = message;
}

function appendLog(line, isError = false) {
  const row = document.createElement('div');
  row.textContent = `[${new Date().toLocaleTimeString()}] ${line}`;
  if (isError) row.className = 'error';
  logEl.appendChild(row);
  logEl.scrollTop = logEl.scrollHeight;
}

function progressLogger(event) {
  const total = event.total || 0;
  const done = event.done || 0;
  const pct = total > 0 ? ((done / total) * 100).toFixed(1) : '0.0';
  const where = typeof event.address === 'number' ? ` @0x${event.address.toString(16)}` : '';
  appendLog(`${event.phase} ${done}/${total} (${pct}%)${where}${event.message ? ` ${event.message}` : ''}`);
}

async function connect(type) {
  await disconnect();
  setStatus(`Connecting via ${type}...`);
  appendLog(`Requesting ${type} device`);

  const transport =
    type === 'WebUSB'
      ? await WebUsbTransport.request()
      : await WebSerialTransport.request({ baudRate: Number(baudEl.value) || 115200 });

  flasher = new WchIspFlasher(transport);
  const info = await flasher.connect(progressLogger);

  setStatus(`Connected: ${info.name}`);
  appendLog(`Connected chip: ${info.name} (chipId=0x${info.chipId.toString(16)}, deviceType=0x${info.deviceType.toString(16)})`);
  appendLog(`UID: ${Array.from(info.uid).map(v => v.toString(16).padStart(2, '0')).join(' ')}`);
  appendLog(`Code flash protected: ${info.codeFlashProtected}`);
}

async function disconnect() {
  if (!flasher) {
    setStatus('Idle');
    return;
  }

  try {
    await flasher.close();
    appendLog('Disconnected');
  } catch (error) {
    appendLog(`Disconnect failed: ${String(error)}`, true);
  } finally {
    flasher = null;
    setStatus('Idle');
  }
}

async function readConfig() {
  if (!flasher) throw new Error('Connect first');
  setStatus('Reading config...');
  const config = await flasher.readConfig(undefined, progressLogger);
  appendLog(`Config bytes (${config.length}): ${Array.from(config).map(v => v.toString(16).padStart(2, '0')).join(' ')}`);
  setStatus('Connected');
}

async function flash() {
  if (!flasher) throw new Error('Connect first');
  const file = firmwareEl.files && firmwareEl.files[0];
  if (!file) throw new Error('Choose a firmware file first');

  setStatus(`Flashing ${file.name}...`);
  appendLog(`Flashing ${file.name} (${file.size} bytes)`);

  const info = await flasher.flash(file, {
    erase: eraseEl.checked,
    verify: verifyEl.checked,
    reset: resetEl.checked,
    unprotect: unprotectEl.checked,
    progress: progressLogger,
  });

  appendLog(`Flash completed for ${info.name}`);
  setStatus(`Flash complete: ${info.name}`);
}

async function run(action, label) {
  try {
    await action();
  } catch (error) {
    setStatus('Error');
    const message = error instanceof Error ? error.message : String(error);
    appendLog(`${label} failed: ${message}`, true);
  }
}

connectUsbBtn.addEventListener('click', () => run(() => connect('WebUSB'), 'WebUSB connect'));
connectSerialBtn.addEventListener('click', () => run(() => connect('Web Serial'), 'WebSerial connect'));
disconnectBtn.addEventListener('click', () => run(disconnect, 'Disconnect'));
readConfigBtn.addEventListener('click', () => run(readConfig, 'Read config'));
flashBtn.addEventListener('click', () => run(flash, 'Flash'));

setStatus('Idle');
appendLog('Ready. Use Connect to begin.');
