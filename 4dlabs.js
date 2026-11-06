const { ethers } = require('ethers');
const fs = require('fs');
const readline = require('readline');

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const INVITATION_CODE    = 'HDSQ8N19';
const PRIVY_APP_ID       = 'cmrw7x5ja02n20bifmgb02yw0';
const PRIVY_CA_ID        = 'a38091be-9f46-4628-bca7-941d7677d087';
const CHAIN_ID           = 'eip155:56';
const BASE_URL           = 'https://dapp.4dlabs.space';
const PRIVY_URL          = 'https://auth.privy.io';
const RPC_URL            = 'https://56.rpc.thirdweb.com/';
const CHECKIN_CONTRACT   = '0x654612a216517bdbbA8356Ff9462944AC5165fDc';
const CHECKIN_ABI        = ['function checkIn(string memory _location) public'];
const LOCATIONS          = ['ASN', 'EUR', 'AFR', 'NAM', 'SAM', 'OCE'];
const DELAY_MS           = 3000;

// ─── HELPER ───────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

function ask(rl, q) {
  return new Promise(res => rl.question(q, res));
}

async function post(url, body, headers) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : null,
  });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { data });
  return data;
}

// ─── HEADERS ──────────────────────────────────────────────────────────────────
const baseHeaders = {
  'Accept':             'application/json',
  'Accept-Encoding':    'gzip, deflate, br, zstd',
  'Accept-Language':    'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
  'Origin':             'https://dapp.4dlabs.space',
  'Referer':            'https://dapp.4dlabs.space/',
  'Sec-Ch-Ua':          '"Mises";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
  'Sec-Ch-Ua-Mobile':   '?1',
  'Sec-Ch-Ua-Platform': '"Android"',
  'Sec-Fetch-Dest':     'empty',
  'Sec-Fetch-Mode':     'cors',
  'User-Agent':         'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
};

const privyHeaders = {
  ...baseHeaders,
  'Privy-App-Id':             PRIVY_APP_ID,
  'Privy-Ca-Id':              PRIVY_CA_ID,
  'Privy-Client':             'react-auth:3.38.0',
  'Sec-Fetch-Site':           'cross-site',
  'Sec-Fetch-Storage-Access': 'active',
};

const appHeaders = { ...baseHeaders, 'Sec-Fetch-Site': 'same-origin' };

// ─── AUTH ─────────────────────────────────────────────────────────────────────
function buildSiweMessage(address, nonce, expiresAt) {
  return [
    `dapp.4dlabs.space wants you to sign in with your Ethereum account:`,
    address, '', '',
    `URI: https://dapp.4dlabs.space/`,
    'Version: 1',
    `Chain ID: ${CHAIN_ID.split(':')[1]}`,
    `Nonce: ${nonce}`,
    `Issued At: ${new Date().toISOString()}`,
    `Expiration Time: ${expiresAt}`,
  ].join('\n');
}

async function connectWallet(privateKey, index) {
  const wallet  = new ethers.Wallet(privateKey);
  const address = wallet.address;
  const label   = `[${index + 1}] ${address.slice(0, 10)}...`;

  process.stdout.write(`${label} → init... `);
  const { nonce, expires_at } = await post(`${PRIVY_URL}/api/v1/siwe/init`, { address }, privyHeaders);

  const message   = buildSiweMessage(address, nonce, expires_at);
  const signature = await wallet.signMessage(message);

  process.stdout.write(`auth... `);
  const authData   = await post(`${PRIVY_URL}/api/v1/siwe/authenticate`, {
    chainId: CHAIN_ID, connectorType: 'injected',
    message, mode: 'login-or-sign-up', signature, walletClientType: 'metamask',
  }, privyHeaders);

  const privyToken = authData.token || authData.privy_access_token;
  if (!privyToken) throw new Error('token tidak ditemukan');

  process.stdout.write(`privy-auth... `);
  await post(`${BASE_URL}/api/auth/privy-auth`, {
    invitation_code: INVITATION_CODE, privy_user_token: privyToken,
  }, appHeaders);

  console.log(`✓`);
  return { wallet, address, label };
}

// ─── CHECKIN ──────────────────────────────────────────────────────────────────
async function doCheckin(wallet, address, label, location) {
  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const signer   = wallet.connect(provider);
    const contract = new ethers.Contract(CHECKIN_CONTRACT, CHECKIN_ABI, signer);

    process.stdout.write(`${label} → checkIn(${location})... `);
    const tx = await contract.checkIn(location);
    process.stdout.write(`tx sent... `);
    await tx.wait();
    console.log(`✓ ${tx.hash}`);
    return { address, success: true, tx: tx.hash };
  } catch (err) {
    const msg = err.reason || err.message;
    console.log(`✗ ${msg}`);
    return { address, success: false, error: msg };
  }
}

// ─── INTERACTIVE PROMPT ───────────────────────────────────────────────────────
async function main() {
  const keys = fs.readFileSync('wallet.txt', 'utf-8')
    .split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  // Pilih lokasi
  console.log('\nPilih lokasi checkin:');
  LOCATIONS.forEach((l, i) => console.log(`  ${i + 1}. ${l}`));
  const locInput = await ask(rl, 'Pilihan (1-6): ');
  const locIdx   = parseInt(locInput) - 1;
  if (locIdx < 0 || locIdx >= LOCATIONS.length) {
    console.log('Pilihan tidak valid'); rl.close(); return;
  }
  const location = LOCATIONS[locIdx];

  // Pilih mode
  console.log('\nMode:');
  console.log('  1. 1 akun');
  console.log('  2. Semua akun');
  console.log('  3. Dari akun X sampai akhir');
  const modeInput = await ask(rl, 'Pilihan (1-3): ');

  let startIdx = 0;
  let selectedKeys = [];

  if (modeInput === '1') {
    const idxInput = await ask(rl, `Nomor akun (1-${keys.length}): `);
    const idx = parseInt(idxInput) - 1;
    if (idx < 0 || idx >= keys.length) { console.log('Tidak valid'); rl.close(); return; }
    selectedKeys = [{ key: keys[idx], idx }];
  } else if (modeInput === '2') {
    selectedKeys = keys.map((key, idx) => ({ key, idx }));
  } else if (modeInput === '3') {
    const fromInput = await ask(rl, `Dari akun nomor (1-${keys.length}): `);
    startIdx = parseInt(fromInput) - 1;
    if (startIdx < 0 || startIdx >= keys.length) { console.log('Tidak valid'); rl.close(); return; }
    selectedKeys = keys.slice(startIdx).map((key, i) => ({ key, idx: startIdx + i }));
  } else {
    console.log('Pilihan tidak valid'); rl.close(); return;
  }

  rl.close();

  console.log(`\n${selectedKeys.length} akun dipilih, lokasi: ${location}\n`);

  // Connect + checkin
  const results = [];
  for (let i = 0; i < selectedKeys.length; i++) {
    const { key, idx } = selectedKeys[i];
    try {
      const { wallet, address, label } = await connectWallet(key, idx);
      const r = await doCheckin(wallet, address, label, location);
      results.push(r);
    } catch (err) {
      const msg = err.data ? JSON.stringify(err.data) : err.message;
      console.log(`[${idx + 1}] ✗ ${msg}`);
      results.push({ success: false, error: msg });
    }
    if (i < selectedKeys.length - 1) await sleep(DELAY_MS);
  }

  const ok   = results.filter(r => r.success).length;
  const fail = results.length - ok;
  console.log(`\n─── SUMMARY: ${ok} berhasil, ${fail} gagal ───`);
}

main();
