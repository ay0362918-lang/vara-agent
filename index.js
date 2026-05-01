import { GearApi } from "@gear-js/api";
import { Keyring } from "@polkadot/keyring";
import { hexToU8a, u8aToHex } from "@polkadot/util";
import { setTimeout as wait } from "timers/promises";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

if (!process.env.PRIVATE_KEY) { console.error("💥 PRIVATE_KEY not set"); process.exit(1); }

console.log("⚡ HY4 RAW SCALE - MAXIMUM SPEED");

const RPC = "wss://rpc.vara.network";
const BASKET_MARKET = "0xe5dd153b813c768b109094a9e2eb496c38216b1dbe868391f1d20ac927b7d2c2";
const BET_TOKEN = "0x186f6cda18fea13d9fc5969eec5a379220d6726f64c1d5f4b346e89271f917bc";
const BET_LANE = "0x35848dea0ab64f283497deaff93b12fe4d17649624b2cd5149f253ef372b29dc";
const VOUCHER_URL = "https://voucher-backend-production-5a1b.up.railway.app/voucher";
const hexAddress = "0x2a3d796f3e8401782789ebf3f92d12c8d9f0addb39643dbea01b96d230207a3f";

const PAYLOAD_PREFIX = hexToU8a("0x426574546f6b656e1c417070726f766535848dea0ab64f283497deaff93b12fe4d17649624b2cd5149f253ef372b29dc");

let api, account, voucherId;
let approveCounter = 0;

function log(...args) {
    console.log(`[${new Date().toLocaleTimeString()}]`, ...args);
}

function encodeU64LE(n) {
    const buf = Buffer.alloc(8);
    const big = BigInt(n);
    buf.writeUInt32LE(Number(big & 0xFFFFFFFFn), 0);
    buf.writeUInt32LE(Number((big >> 32n) & 0xFFFFFFFFn), 4);
    return buf;
}

function encodeU128LE(n) {
    const buf = Buffer.alloc(16);
    const big = BigInt(n);
    buf.writeUInt32LE(Number(big & 0xFFFFFFFFn), 0);
    buf.writeUInt32LE(Number((big >> 32n) & 0xFFFFFFFFn), 4);
    buf.writeUInt32LE(Number((big >> 64n) & 0xFFFFFFFFn), 8);
    buf.writeUInt32LE(Number((big >> 96n) & 0xFFFFFFFFn), 12);
    return buf;
}

function compactEncode(n) {
    if (n < 64) return Buffer.from([n << 2]);
    if (n < 16384) {
        const v = (n << 2) | 1;
        return Buffer.from([v & 0xff, v >> 8]);
    }
    throw new Error("compact encode too large");
}

function buildRawCall(voucherHex, amount) {
    const amountHex = BigInt(amount).toString(16).padStart(64, '0');
    const amountLE = hexToU8a("0x" + amountHex.match(/.{2}/g).reverse().join(''));

    const payload = Buffer.concat([
        Buffer.from([0x20]),
        PAYLOAD_PREFIX,
        amountLE
    ]);

    const voucherBytes = hexToU8a(voucherHex);
    const destinationBytes = hexToU8a(BET_TOKEN);

    return Buffer.concat([
        Buffer.from([0x6b, 0x01]),
        Buffer.from(voucherBytes),
        Buffer.from([0x00]),
        Buffer.from(destinationBytes),
        compactEncode(payload.length),
        payload,
        encodeU64LE(25000000000n),
        encodeU128LE(0n),
        Buffer.from([0x00]),
    ]);
}

async function init() {
    log("🔌 Connecting...");
    api = await GearApi.create({ providerAddress: RPC });
    const keyring = new Keyring({ type: "sr25519" });
    account = keyring.addFromUri(process.env.PRIVATE_KEY);
    log("✅ Wallet:", account.address);
}

async function ensureVoucher() {
    try {
        const res = await fetch(`${VOUCHER_URL}/${hexAddress}`);
        const data = await res.json();
        if (data.voucherId) {
            voucherId = data.voucherId;
            if (data.canTopUpNow === false) return;
        }
        const postRes = await fetch(VOUCHER_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ account: hexAddress, programs: [BASKET_MARKET, BET_TOKEN, BET_LANE] })
        });
        const postData = await postRes.json();
        if (postData.voucherId) voucherId = postData.voucherId;
        log("🎫 Voucher:", voucherId);
    } catch (err) {
        log("⚠️ Voucher error:", err.message);
    }
}

async function approve() {
    if (!voucherId) return false;
    try {
        const amount = 20000000000000 + Math.floor(Math.random() * 99999);
        const rawCall = buildRawCall(voucherId, amount);
        const hexCall = u8aToHex(rawCall);

        // Create the call object from raw bytes
        const call = api.registry.createType('Call', hexCall);
        const tx = api.registry.createType('Extrinsic', call);

        log("📤 Call:", hexCall.slice(0, 80));

        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("timeout")), 15000);
            tx.signAndSend(account, { nonce: -1 }, ({ status }) => {
                log("📡", status.type);
                if (status.isInBlock) {
                    clearTimeout(timer);
                    approveCounter++;
                    log(`✅ #${approveCounter}`);
                    resolve(true);
                }
                if (status.isDropped || status.isInvalid || status.isError) {
                    clearTimeout(timer);
                    reject(new Error("failed: " + status.type));
                }
            }).catch(e => { clearTimeout(timer); reject(e); });
        });

        return true;
    } catch (err) {
        log("❌", String(err.message || err).slice(0, 100));
        return false;
    }
}

async function main() {
    await init();
    await ensureVoucher();
    if (!voucherId) { log("💥 No voucher"); process.exit(1); }

    log("🚀 LOOP STARTED");
    let errors = 0;

    while (true) {
        try {
            if (approveCounter > 0 && approveCounter % 50 === 0) await ensureVoucher();
            const ok = await approve();
            if (ok) {
                errors = 0;
            } else {
                errors++;
                if (errors >= 5) {
                    await wait(2000);
                    await ensureVoucher();
                    errors = 0;
                }
            }
        } catch (err) {
            log("💥", err.message?.slice(0, 60));
            await wait(500);
        }
    }
}

main().catch(err => { console.error("💥 Fatal:", err); process.exit(1); });
