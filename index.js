import { GearApi } from "@gear-js/api";
import { Keyring } from "@polkadot/keyring";
import { setTimeout as wait } from "timers/promises";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

if (!process.env.PRIVATE_KEY) { console.error("💥 PRIVATE_KEY not set"); process.exit(1); }

console.log("⚡ HY4 RAW PAYLOAD - MAXIMUM SPEED");

const RPC = "wss://rpc.vara.network";
const BASKET_MARKET = "0xe5dd153b813c768b109094a9e2eb496c38216b1dbe868391f1d20ac927b7d2c2";
const BET_TOKEN = "0x186f6cda18fea13d9fc5969eec5a379220d6726f64c1d5f4b346e89271f917bc";
const BET_LANE = "0x35848dea0ab64f283497deaff93b12fe4d17649624b2cd5149f253ef372b29dc";
const VOUCHER_URL = "https://voucher-backend-production-5a1b.up.railway.app/voucher";
const hexAddress = "0x2a3d796f3e8401782789ebf3f92d12c8d9f0addb39643dbea01b96d230207a3f";

// Pre-built fixed part of payload — never changes
// "BetToken" + "Approve" + BET_LANE_bytes
const PAYLOAD_PREFIX = "20426574546f6b656e1c417070726f766535848dea0ab64f283497deaff93b12fe4d17649624b2cd5149f253ef372b29dc";

let api, account, voucherId;
let approveCounter = 0;

function log(...args) {
    console.log(`[${new Date().toLocaleTimeString()}]`, ...args);
}

function buildPayload(amount) {
    // Encode amount as u256 little-endian 32 bytes
    const hex = BigInt(amount).toString(16).padStart(64, '0');
    const le = hex.match(/.{2}/g).reverse().join('');
    return "0x" + PAYLOAD_PREFIX + le;
}

async function init() {
    log("🔌 Connecting...");
    api = await GearApi.create({ providerAddress: RPC });
    const keyring = new Keyring({ type: "sr25519" });
    account = keyring.addFromUri(process.env.PRIVATE_KEY);
    log("✅ Wallet:", account.address);
}

async function ensureVoucher() {
    // Use the voucher with the latest expiry
    voucherId = "0xe48bcc939a5e688786c1f10984279854d0d707668f90af641817155807a113ad";
    log("🎫 Using voucher:", voucherId);
}

async function approve() {
    if (!voucherId) return false;
    try {
        const amount = 20000000000000 + Math.floor(Math.random() * 99999);
        const payload = buildPayload(amount);

        const voucherCall = api.tx.gearVoucher.call(
            voucherId,
            {
                SendMessage: {
                    destination: BET_TOKEN,
                    payload: payload,
                    gasLimit: 25000000000n,
                    value: 0,
                    keepAlive: false
                }
            }
        );

        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("timeout")), 15000);
            voucherCall.signAndSend(account, ({ status }) => {
                if (status.isInBlock) {
                    clearTimeout(timer);
                    approveCounter++;
                    log(`✅ #${approveCounter}`);
                    resolve(true);
                }
                if (status.isDropped || status.isInvalid || status.isError) {
                    clearTimeout(timer);
                    reject(new Error("tx failed: " + status.type));
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

    log("🚀 LOOP STARTED - raw payload, no Sails, no CLI");
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
