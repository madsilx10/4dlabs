const { ethers } = require('ethers');
const fs = require('fs');

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const INVITATION_CODE = 'HDSQ8N19';
const PRIVY_APP_ID    = 'cmrw7x5ja02n20bifmgb02yw0';
const PRIVY_CA_ID     = 'a38091be-9f46-4628-bca7-941d7677d087';
const CHAIN_ID        = 'eip155:56';
const BASE_URL        = 'https://dapp.4dlabs.space';
const PRIVY_URL       = 'https://auth.privy.io';

// ─── HELPER FETCH ─────────────────────────────────────────────────────────────
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

const appHeaders = {
  ...baseHeaders,
  'Sec-Fetch-Site': 'same-origin',
};

// ─── BUILD SIWE MESSAGE ───────────────────────────────────────────────────────
function buildSiweMessage(address, nonce, expiresAt) {
  return [
    `dapp.4dlabs.space wants you to sign in with your Ethereum account:`,
    address,
    '',
    '',
    `URI: https://dapp.4dlabs.space/`,
    'Version: 1',
    `Chain ID: ${CHAIN_ID.split(':')[1]}`,
    `Nonce: ${nonce}`,
    `Issued At: ${new Date().toISOString()}`,
    `Expiration Time: ${expiresAt}`,
  ].join('\n');
}

// ─── STEPS ────────────────────────────────────────────────────────────────────
async function siweInit(address) {
  return post(`${PRIVY_URL}/api/v1/siwe/init`, { address }, privyHeaders);
}

async function siweAuthenticate(address, message, signature) {
  return post(`${PRIVY_URL}/api/v1/siwe/authenticate`, {
    chainId:          CHAIN_ID,
    connectorType:    'injected',
    message,
    mode:             'login-or-sign-up',
    signature,
    walletClientType: 'metamask',
  }, privyHeaders);
}

async function privyAuth(privyUserToken) {
  return post(`${BASE_URL}/api/auth/privy-auth`, {
    invitation_code:  INVITATION_CODE,
    privy_user_token: privyUserToken,
  }, appHeaders);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function connectWallet(privateKey, index) {
  const wallet  = new ethers.Wallet(privateKey);
  const address = wallet.address;
  const label   = `[${index + 1}] ${address.slice(0, 10)}...`;

  try {
    process.stdout.write(`${label} → init... `);
    const { nonce, expires_at } = await siweInit(address);

    const message   = buildSiweMessage(address, nonce, expires_at);
    const signature = await wallet.signMessage(message);

    process.stdout.write(`auth... `);
    const authData   = await siweAuthenticate(address, message, signature);
    const privyToken = authData.token || authData.privy_access_token;
    if (!privyToken) throw new Error('token tidak ditemukan di response privy');

    process.stdout.write(`privy-auth... `);
    const appData = await privyAuth(privyToken);
    console.log(`✓ user_id: ${appData.user_id}`);

    return { address, success: true, user_id: appData.user_id };
  } catch (err) {
    const msg = err.data ? JSON.stringify(err.data) : err.message;
    console.log(`✗ ${msg}`);
    return { address, success: false, error: msg };
  }
}

async function main() {
  const keys = fs.readFileSync('wallet.txt', 'utf-8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));

  console.log(`${keys.length} wallet ditemukan\n`);

  const results = [];
  for (let i = 0; i < keys.length; i++) {
    const r = await connectWallet(keys[i], i);
    results.push(r);
    if (i < keys.length - 1) await new Promise(r => setTimeout(r, 2000));
  }

  const ok  = results.filter(r => r.success).length;
  const fail = results.length - ok;
  console.log(`\n─── SUMMARY: ${ok} berhasil, ${fail} gagal ───`);
}

main();
